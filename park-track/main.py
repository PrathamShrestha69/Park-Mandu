"""Park Mandu AI detector.

Reads one video source (file, webcam, CCTV RTSP stream or a phone camera stream), tracks vehicles with
YOLO + ByteTrack, and reports vehicles that stay parked to the Park Mandu backend as illegal-parking
alerts. Run `python main.py --help` for every option; README.md has setup recipes.
"""

import argparse
import asyncio
import base64
import csv
import importlib.util
import json
import logging
import os
import queue
import socket
import threading
import time
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import cv2
import requests
import torch
import websockets
from ultralytics import YOLO

folder = Path(__file__).parent
FIXED_FPS = 25.0
VIOLATION_TYPES = [
    "no_parking_zone",
    "restricted_lane",
    "near_intersection",
    "footpath_obstruction",
    "double_parking",
    "bus_stop_obstruction",
    "overtime_parking",
    "loading_zone_obstruction",
]

log = logging.getLogger("park-track")

# Load the hyphenated file (Python imports cannot use hyphens).
spec = importlib.util.spec_from_file_location("parking_detector", folder / "detect-parking.py")
parking_detector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parking_detector)
detect_parking = parking_detector.detect_parking


# --------------------------------------------------------------------------- configuration


def parse_args():
    env = os.environ.get
    p = argparse.ArgumentParser(description="Detect parked vehicles in a video source and report them to Park Mandu.")
    p.add_argument(
        "--source",
        default=env("PARKTRACK_SOURCE", str(folder / "video2.mp4")),
        help="Video file, webcam index (0), RTSP URL (CCTV) or HTTP stream URL (phone camera app).",
    )
    p.add_argument("--model", default=str(folder / "best.pt"))

    backend = p.add_argument_group("Park Mandu backend (leave --camera-code empty to run offline)")
    backend.add_argument("--camera-code", default=env("PARKTRACK_CAMERA_CODE"), help="e.g. CAM-014 or PHONE-01")
    backend.add_argument("--api-url", default=env("PARKMANDU_API_URL", "http://localhost:8000/api/v1"))
    backend.add_argument("--api-key", default=env("INGEST_API_KEY"), help="Same value as INGEST_API_KEY in backend/.env")
    backend.add_argument("--violation", default="no_parking_zone", choices=VIOLATION_TYPES)
    backend.add_argument("--name", help="Camera name shown in the app (used when registering a new camera)")
    backend.add_argument("--road")
    backend.add_argument("--area")
    backend.add_argument("--zone")
    backend.add_argument("--lat", type=float, help="Camera latitude")
    backend.add_argument("--lng", type=float, help="Camera longitude")

    tuning = p.add_argument_group("Detection tuning")
    tuning.add_argument("--park-seconds", type=float, default=30.0, help="Stillness before a vehicle counts as parked")
    tuning.add_argument("--stop-seconds", type=float, default=3.0)
    tuning.add_argument(
        "--window", type=float, default=1.0, help="Movement window in seconds. Use 2-3 when the source runs below 3 FPS."
    )
    tuning.add_argument("--move-pixels", type=float, default=15.0)
    tuning.add_argument("--fps", type=float, default=FIXED_FPS, help="Frame rate used to time video files")
    tuning.add_argument("--realtime", action="store_true", help="Play video files at their real speed")

    out = p.add_argument_group("Outputs")
    out.add_argument("--preview-port", type=int, default=8090, help="Annotated MJPEG preview; 0 disables it")
    out.add_argument("--public-host", help="Host/IP the apps use to reach the preview (auto-detected LAN IP)")
    out.add_argument("--ws-port", type=int, default=8765, help="WebSocket detections; 0 disables it")
    out.add_argument("--csv", default=str(folder / "output.csv"), help="CSV of stopped/parked rows; '' disables it")
    out.add_argument("--parked-dir", default=str(folder / "parked"))
    out.add_argument("--show", action="store_true", help="Open a local window with the annotated video")
    return p.parse_args()


def parse_source(raw):
    """Webcam indexes become ints; anything with a scheme or that is not a file is treated as a live stream."""
    if raw.isdigit():
        return int(raw), True
    if "://" in raw:
        return raw, True
    return str(Path(raw)), False


def lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


# --------------------------------------------------------------------------- video input


class LiveReader:
    """Keeps only the newest frame of a live stream so slow inference never builds up lag. Reconnects on drop."""

    def __init__(self, source):
        self.source = source
        self.frame = None
        self.lock = threading.Lock()
        self.fresh = threading.Event()
        self.running = True
        self.thread = threading.Thread(target=self._run, daemon=True)

    def start(self):
        self.thread.start()
        return self

    def _run(self):
        while self.running:
            capture = cv2.VideoCapture(self.source)
            if not capture.isOpened():
                log.warning("Cannot open %s, retrying in 3 s", self.source)
                time.sleep(3)
                continue
            log.info("Connected to %s", self.source)
            while self.running:
                ok, frame = capture.read()
                if not ok:
                    log.warning("Stream dropped, reconnecting")
                    break
                with self.lock:
                    self.frame = frame
                self.fresh.set()
            capture.release()
            time.sleep(1)

    def read(self, timeout=10):
        if not self.fresh.wait(timeout):
            return None
        self.fresh.clear()
        with self.lock:
            return self.frame

    def stop(self):
        self.running = False


# --------------------------------------------------------------------------- outputs


class DetectionSocket:
    """WebSocket broadcaster for the most recently processed frame."""

    def __init__(self, host="0.0.0.0", port=8765):
        self.host = host
        self.port = port
        self.clients = set()
        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.ready = threading.Event()

    async def _handler(self, websocket):
        self.clients.add(websocket)
        try:
            await websocket.wait_closed()
        finally:
            self.clients.discard(websocket)

    async def _broadcast(self, message):
        if self.clients:
            await asyncio.gather(
                *(client.send(message) for client in tuple(self.clients)),
                return_exceptions=True,
            )

    async def _serve(self):
        # websockets >= 14 must create its server inside a running event loop.
        self.server = await websockets.serve(self._handler, self.host, self.port)

    def _run(self):
        asyncio.set_event_loop(self.loop)
        self.loop.run_until_complete(self._serve())
        self.ready.set()
        self.loop.run_forever()

    def start(self):
        self.thread.start()
        if not self.ready.wait(timeout=5):
            raise RuntimeError("WebSocket server did not start")

    def publish(self, frame_number, time_seconds, detections):
        # Send a frame envelope even when detections is empty so clients can clear boxes.
        payload = {
            "type": "detections",
            "frame": frame_number,
            "time_seconds": time_seconds,
            "detections": [
                {
                    **vehicle,
                    "parked": vehicle["status"] == "parking_candidate",
                    "box_color": "red" if vehicle["status"] == "parking_candidate" else "green",
                }
                for vehicle in detections
            ],
        }
        asyncio.run_coroutine_threadsafe(self._broadcast(json.dumps(payload)), self.loop)

    def stop(self):
        if self.loop.is_running():
            self.loop.call_soon_threadsafe(self.loop.stop)
            self.thread.join(timeout=2)


class PreviewServer:
    """Serves the annotated video: /stream.mjpg (for <img> tags) and /snapshot.jpg (for polling clients)."""

    def __init__(self, port):
        self.port = port
        self.jpeg = None
        self.condition = threading.Condition()
        server = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def _headers(self, content_type):
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Cache-Control", "no-store")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()

            def do_GET(self):
                path = self.path.split("?", 1)[0]
                if path == "/snapshot.jpg":
                    jpeg = server.wait_frame(timeout=5)
                    if jpeg is None:
                        self.send_error(503, "No frame yet")
                        return
                    self._headers("image/jpeg")
                    self.wfile.write(jpeg)
                elif path == "/stream.mjpg":
                    self._headers("multipart/x-mixed-replace; boundary=frame")
                    try:
                        while True:
                            jpeg = server.wait_frame(timeout=10)
                            if jpeg is None:
                                continue
                            self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\n")
                            self.wfile.write(f"Content-Length: {len(jpeg)}\r\n\r\n".encode())
                            self.wfile.write(jpeg + b"\r\n")
                    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                        pass
                elif path == "/":
                    self._headers("text/html; charset=utf-8")
                    self.wfile.write(b"<title>Park Mandu detector</title><img src='/stream.mjpg' style='max-width:100%'>")
                else:
                    self.send_error(404)

        self.httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
        self.httpd.daemon_threads = True

    def start(self):
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def push(self, frame):
        height, width = frame.shape[:2]
        if width > 960:
            frame = cv2.resize(frame, (960, int(height * 960 / width)))
        ok, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
        if ok:
            with self.condition:
                self.jpeg = buffer.tobytes()
                self.condition.notify_all()

    def wait_frame(self, timeout):
        with self.condition:
            self.condition.wait(timeout)
            return self.jpeg

    def stop(self):
        self.httpd.shutdown()


class BackendClient:
    """Sends heartbeats and parked-vehicle detections to the Park Mandu API from a background thread."""

    def __init__(self, args, stream_url):
        self.api = args.api_url.rstrip("/")
        self.headers = {"X-API-Key": args.api_key}
        self.camera_code = args.camera_code.upper()
        self.violation = args.violation
        self.registration = {
            "camera_code": self.camera_code,
            "stream_url": stream_url,
            "name": args.name,
            "road": args.road,
            "area": args.area,
            "zone": args.zone,
            "latitude": args.lat,
            "longitude": args.lng,
        }
        self.queue = queue.Queue(maxsize=100)
        self.stopping = threading.Event()

    def start(self):
        self.heartbeat()  # Fail fast on a wrong URL or key, and register the camera before any detection.
        threading.Thread(target=self._heartbeat_loop, daemon=True).start()
        threading.Thread(target=self._send_loop, daemon=True).start()

    def heartbeat(self):
        body = {k: v for k, v in self.registration.items() if v is not None}
        response = requests.post(f"{self.api}/ingest/heartbeat", json=body, headers=self.headers, timeout=10)
        if response.status_code == 401:
            raise SystemExit("Backend rejected the API key. Use INGEST_API_KEY from backend/.env.")
        response.raise_for_status()
        data = response.json()
        if data.get("created"):
            log.info("Registered new camera %s in Park Mandu", data["camera_code"])
        return data

    def _heartbeat_loop(self):
        while not self.stopping.wait(30):
            try:
                self.heartbeat()
            except requests.RequestException as exc:
                log.warning("Heartbeat failed: %s", exc)

    def report(self, vehicle, crop):
        payload = {
            "camera_code": self.camera_code,
            "violation_type": self.violation,
            "vehicle_type": vehicle["class"].replace("_", " ").title()[:40],
            "confidence": round(min(max(vehicle["confidence"], 0.0), 1.0), 3),
            "detected_at": datetime.now(UTC).isoformat(),
        }
        if crop is not None:
            ok, buffer = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 90])
            if ok and len(buffer) < 2 * 1024 * 1024:
                payload["snapshot_base64"] = base64.b64encode(buffer.tobytes()).decode()
        try:
            self.queue.put_nowait(payload)
        except queue.Full:
            log.warning("Backend queue full, dropping detection")

    def _send_loop(self):
        while True:
            payload = self.queue.get()
            for attempt in range(3):
                try:
                    response = requests.post(
                        f"{self.api}/ingest/detections", json=payload, headers=self.headers, timeout=15
                    )
                    response.raise_for_status()
                    log.info("Reported parked %s (%.0f%%)", payload["vehicle_type"], payload["confidence"] * 100)
                    break
                except requests.RequestException as exc:
                    log.warning("Report failed (attempt %d): %s", attempt + 1, exc)
                    time.sleep(2 * (attempt + 1))
            self.queue.task_done()

    def stop(self, timeout=30):
        """Waits for queued reports to be delivered (a video file can end right after a detection)."""
        self.stopping.set()
        deadline = time.monotonic() + timeout
        while self.queue.unfinished_tasks and time.monotonic() < deadline:
            time.sleep(0.2)


# --------------------------------------------------------------------------- helpers


def iou(a, b):
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def crop(frame, vehicle, pad=0.0):
    height, width = frame.shape[:2]
    w, h = vehicle["x2"] - vehicle["x1"], vehicle["y2"] - vehicle["y1"]
    x1 = max(0, int(vehicle["x1"] - w * pad))
    y1 = max(0, int(vehicle["y1"] - h * pad))
    x2 = min(width, int(vehicle["x2"] + w * pad))
    y2 = min(height, int(vehicle["y2"] + h * pad))
    image = frame[y1:y2, x1:x2]
    return image if image.size else None


def annotate(frame, vehicles, label):
    canvas = frame.copy()
    for v in vehicles:
        parked = v["status"] == "parking_candidate"
        color = (40, 40, 230) if parked else (60, 200, 60) if v["status"] == "moving" else (0, 190, 255)
        p1, p2 = (int(v["x1"]), int(v["y1"])), (int(v["x2"]), int(v["y2"]))
        cv2.rectangle(canvas, p1, p2, color, 2)
        text = f"{v['class']} #{v['track_id']} {'PARKED' if parked else v['status']}"
        cv2.putText(canvas, text, (p1[0], max(14, p1[1] - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
    stamp = f"{label}  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
    cv2.putText(canvas, stamp, (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
    return canvas


# --------------------------------------------------------------------------- main loop


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    args = parse_args()
    source, live = parse_source(args.source)

    model = YOLO(args.model)
    device = "0" if torch.cuda.is_available() else "cpu"
    log.info("Running inference on %s", "CUDA GPU 0" if device == "0" else "CPU")

    preview = None
    stream_url = None
    if args.preview_port:
        preview = PreviewServer(args.preview_port)
        preview.start()
        stream_url = f"http://{args.public_host or lan_ip()}:{args.preview_port}"
        log.info("Live preview: %s/stream.mjpg", stream_url)

    backend = None
    if args.camera_code:
        if not args.api_key:
            raise SystemExit("--api-key (or INGEST_API_KEY) is required when --camera-code is set.")
        backend = BackendClient(args, stream_url)
        backend.start()
        log.info("Reporting to %s as camera %s", args.api_url, backend.camera_code)
    else:
        log.info("No --camera-code: running offline (CSV and crops only)")

    socket_server = None
    if args.ws_port:
        socket_server = DetectionSocket(port=args.ws_port)
        socket_server.start()

    reader = LiveReader(source).start() if live else None
    capture = None if live else cv2.VideoCapture(source)
    if capture is not None and not capture.isOpened():
        raise SystemExit(f"Cannot open video file {source}")

    parked_dir = Path(args.parked_dir)
    parked_dir.mkdir(exist_ok=True)
    csv_file = open(args.csv, "w", newline="") if args.csv else None  # noqa: SIM115
    writer = None
    if csv_file:
        writer = csv.DictWriter(
            csv_file,
            fieldnames=["time_seconds", "track_id", "class", "status", "confidence", "x1", "y1", "x2", "y2"],
        )
        writer.writeheader()

    tuning = dict(
        stopped_after=args.stop_seconds,
        parking_after=args.park_seconds,
        window=args.window,
        move_threshold=args.move_pixels,
    )
    label = args.camera_code.upper() if args.camera_code else "PARK-TRACK"
    saved_vehicles = set()
    reported_boxes = []  # (time, box) so a re-identified parked car is not reported twice
    frame_number = 0
    started = time.monotonic()
    last_report, last_frames = started, 0

    try:
        while True:
            if live:
                frame = reader.read()
                if frame is None:
                    log.warning("No frames from %s yet", args.source)
                    continue
                timestamp = time.monotonic() - started
            else:
                ok, frame = capture.read()
                if not ok:
                    break
                timestamp = frame_number / args.fps
                if args.realtime:
                    delay = started + timestamp - time.monotonic()
                    if delay > 0:
                        time.sleep(delay)
            frame_number += 1
            if time.monotonic() - last_report >= 10:
                fps = (frame_number - last_frames) / (time.monotonic() - last_report)
                log.info("Processing %.1f frames/s (video time %.1f s)", fps, timestamp)
                if live and fps < 3:
                    log.info("Below 3 frames/s: consider --window 2.5 so parked vehicles are still recognised")
                last_report, last_frames = time.monotonic(), frame_number

            vehicles = detect_parking(model, frame, timestamp, device=device, **tuning)
            if socket_server:
                socket_server.publish(frame_number, timestamp, vehicles)

            for vehicle in vehicles:
                if writer and vehicle["status"] in {"stopped", "parking_candidate"}:
                    writer.writerow(vehicle)

                track_id = vehicle["track_id"]
                if vehicle["status"] != "parking_candidate" or track_id in saved_vehicles:
                    continue
                saved_vehicles.add(track_id)

                vehicle_image = crop(frame, vehicle)
                if vehicle_image is not None:
                    image_path = parked_dir / f"vehicle_{track_id}_time_{timestamp:.2f}_seconds.jpg"
                    cv2.imwrite(str(image_path), vehicle_image, [cv2.IMWRITE_JPEG_QUALITY, 95])

                box = (vehicle["x1"], vehicle["y1"], vehicle["x2"], vehicle["y2"])
                reported_boxes = [(t, b) for t, b in reported_boxes if timestamp - t < 600]
                if any(iou(box, b) > 0.5 for _, b in reported_boxes):
                    continue  # Same spot reported in the last 10 minutes under an older track ID.
                reported_boxes.append((timestamp, box))
                log.info("Vehicle %s parked (%s) at %.1f s", track_id, vehicle["class"], timestamp)
                if backend:
                    backend.report(vehicle, crop(frame, vehicle, pad=0.15))

            if preview or args.show:
                canvas = annotate(frame, vehicles, label)
                if preview:
                    preview.push(canvas)
                if args.show:
                    cv2.imshow("Park Mandu detector", canvas)
                    if cv2.waitKey(1) & 0xFF == ord("q"):
                        break
    except KeyboardInterrupt:
        log.info("Stopping")
    finally:
        if capture is not None:
            capture.release()
        if reader:
            reader.stop()
        if csv_file:
            csv_file.close()
        if socket_server:
            socket_server.stop()
        if preview:
            preview.stop()
        if backend:
            backend.stop()
        if args.show:
            cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
