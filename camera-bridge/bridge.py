"""Runs the vehicle_detection model on a camera or video and feeds a Park Mandu camera page.

It loads vehicle_detection/models/best.pt, follows every vehicle with ByteTrack (each one keeps its
number while in view) and works out how long each vehicle has been standing still:

  * moving   - the vehicle is travelling
  * stopped  - standing still for at least --stop-seconds (a traffic stop, a red light, a queue)
  * parked   - the Parking Availability Bridge (camera-bridge/parking_availability) confirmed it is
               PARKED: it stood still while other traffic drove past it, or stood alone for a long
               time. Standing still in a queue is never parking, however long the jam lasts.

PARKED / NOT_PARKED changes go to the backend (POST /ingest/parking-status) with a photo. The backend
decides whether a parked vehicle is illegal parking, checks the camera's traffic status first (no alert
while the road is jammed or while traffic is unknown) and alerts the nearest officer.

It serves the annotated frames at  http://<this-pc>:<port>/stream.mjpg  and  /snapshot.jpg, keeps the
camera live in the backend (heartbeat) and sends the tracked vehicles and counts (telemetry).

Speed is measured only when the road is calibrated (--road-quad, --road-width-m, --road-length-m). The
backend turns that speed into the camera's traffic level; without calibration the traffic status of an
AI camera stays unknown and parking alerts are held back.

Parking owners connect their CCTV under My Parking, which gives the camera a code such as PK-3F9A1C.
Started with only that code (--camera-code PK-3F9A1C, no --source), the bridge reads the stream address
from the backend and runs in parking mode: the same model and tracker count the vehicles standing in
the lot (each track once) and the backend turns that into the facility's occupancy. No alerts are
raised in parking mode.

Run from the project folder:
    vehicle_detection\\.venv\\Scripts\\python camera-bridge\\bridge.py --source video2.mp4 --camera-code CAM-014
    vehicle_detection\\.venv\\Scripts\\python camera-bridge\\bridge.py --source http://<PHONE-IP>:8080/video --camera-code PHONE-01
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import socket
import threading
import time
import urllib.error
import urllib.request
from collections import Counter, deque
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import cv2
import numpy as np
from parking_availability import (
    PARKED,
    Observation,
    ParkingAvailabilityBridge,
    ParkingClassifier,
    ParkingRules,
    ParkingStatusClient,
    Transition,
)
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parent.parent
MODEL_PATH = ROOT / "vehicle_detection" / "models" / "best.pt"
BACKEND_ENV = ROOT / "backend" / ".env"

HEARTBEAT_SECONDS = 20
TELEMETRY_SECONDS = 2
RECONNECT_SECONDS = 3
MAX_TRACKS_SENT = 100  # backend limit per telemetry message

# A vehicle counts as standing still when its centre moved less than this fraction of its own box
# height over the last STILL_WINDOW seconds. Relative to box size, so it works near and far.
STILL_WINDOW = 1.5
STILL_TOLERANCE = 0.12
# A track not seen for this long is forgotten.
TRACK_FORGET_SECONDS = 3.0
# A vehicle joins "flow per minute" only after being detected in this many frames.
MIN_HITS_FOR_FLOW = 8
# Speed is measured over this window, from where the vehicle touches the road.
SPEED_WINDOW = 1.5

COLORS = {"moving": (230, 200, 0), "stopped": (0, 165, 255), "parked": (0, 0, 230)}  # BGR


# --------------------------------------------------------------------------- shared state


class Latest:
    """Most recent annotated frame and tracking picture, shared between threads."""

    def __init__(self) -> None:
        self.cond = threading.Condition()
        self.jpeg: bytes | None = None
        self.seq = 0
        self.telemetry: dict | None = None
        self.updated = 0.0

    def publish(self, jpeg: bytes, telemetry: dict) -> None:
        with self.cond:
            self.jpeg, self.telemetry = jpeg, telemetry
            self.seq += 1
            self.updated = time.monotonic()
            self.cond.notify_all()


latest = Latest()


class Preview(BaseHTTPRequestHandler):
    def log_message(self, *args) -> None:  # keep the console for detector messages
        pass

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/snapshot.jpg":
            with latest.cond:
                jpeg = latest.jpeg
            if jpeg is None:
                self.send_error(503, "No frame yet")
                return
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(jpeg)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(jpeg)
        elif path == "/stream.mjpg":
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            seen = -1
            try:
                while True:
                    with latest.cond:
                        if not latest.cond.wait_for(lambda: latest.jpeg is not None and latest.seq != seen, timeout=10):
                            continue
                        seen, jpeg = latest.seq, latest.jpeg
                    self.wfile.write(
                        b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                        + str(len(jpeg)).encode()
                        + b"\r\n\r\n"
                        + jpeg
                        + b"\r\n"
                    )
            except (BrokenPipeError, ConnectionError, OSError):
                pass  # viewer closed the page
        else:
            self.send_error(404)


# --------------------------------------------------------------------------- backend


def read_ingest_key() -> str:
    key = os.environ.get("INGEST_API_KEY")
    if key:
        return key
    if BACKEND_ENV.exists():
        for line in BACKEND_ENV.read_text(encoding="utf-8").splitlines():
            if line.startswith("INGEST_API_KEY="):
                return line.split("=", 1)[1].strip()
    raise SystemExit("INGEST_API_KEY not found: set it, or keep it in backend/.env")


def lan_address(towards: str) -> str:
    """This PC's address on the network that reaches `towards` (the camera)."""
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect((towards, 9))
        return probe.getsockname()[0]
    except OSError:
        return "localhost"
    finally:
        probe.close()


def post(url: str, key: str, body: dict) -> dict:
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "X-API-Key": key},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        raw = response.read()
    try:
        return json.loads(raw) if raw else {}
    except ValueError:
        return {}


def get(url: str, key: str) -> dict:
    request = urllib.request.Request(url, headers={"X-API-Key": key}, method="GET")
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.loads(response.read() or b"{}")


def detector_config(args: argparse.Namespace, key: str) -> dict:
    """The backend's view of this camera: video source and parking/traffic mode. {} if unavailable."""
    try:
        return get(f"{args.backend}/ingest/cameras/{args.camera_code}", key)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return {}
        raise SystemExit(f"Backend refused the camera lookup ({exc.code}): {exc.read().decode(errors='replace')[:300]}")
    except OSError as exc:
        if args.source:
            print(f"Backend not reachable for camera lookup ({exc}); using --source as given.", flush=True)
            return {}
        raise SystemExit(f"Backend not reachable at {args.backend}: {exc}")


def report(args: argparse.Namespace, key: str, stream_url: str) -> None:
    """Keeps the camera live in the backend and sends the current tracking picture."""
    last_beat = 0.0
    warned = False
    while True:
        try:
            now = time.monotonic()
            if now - last_beat >= HEARTBEAT_SECONDS:
                post(f"{args.backend}/ingest/heartbeat", key, {"camera_code": args.camera_code, "stream_url": stream_url})
                if last_beat == 0.0:
                    print(f"Backend accepted camera {args.camera_code}; preview at {stream_url}/stream.mjpg", flush=True)
                last_beat = now
            with latest.cond:
                fresh = latest.telemetry is not None and now - latest.updated < 10
                telemetry = dict(latest.telemetry) if fresh else None
            if telemetry:  # nothing while the camera is down, so the page shows it as not reporting
                telemetry["camera_code"] = args.camera_code
                telemetry["captured_at"] = datetime.now(UTC).isoformat()
                post(f"{args.backend}/ingest/telemetry", key, telemetry)
            warned = False
        except urllib.error.HTTPError as exc:
            if not warned:
                hint = " (API key rejected: check INGEST_API_KEY)" if exc.code == 401 else ""
                print(f"Backend answered {exc.code}{hint}: {exc.read().decode(errors='replace')[:300]}", flush=True)
                warned = True
        except OSError as exc:
            if not warned:
                print(f"Backend not reachable at {args.backend}: {exc}", flush=True)
                warned = True
        time.sleep(TELEMETRY_SECONDS)


# --------------------------------------------------------------------------- tracking


class SpeedMeter:
    """Road speed from a calibrated patch of road: four image corners and its real width and length.

    The corners go around the patch; the first edge spans the road's width, the second runs along it.
    Each vehicle's ground point (bottom centre of its box) is mapped onto that patch in metres.
    """

    def __init__(self, quad: list[tuple[float, float]], width_m: float, length_m: float) -> None:
        src = np.array(quad, dtype=np.float32)
        dst = np.array([[0, 0], [width_m, 0], [width_m, length_m], [0, length_m]], dtype=np.float32)
        self.matrix = cv2.getPerspectiveTransform(src, dst)
        self.polygon = src.reshape(-1, 1, 2)

    def ground(self, box: tuple[float, ...]) -> tuple[float, float] | None:
        foot = ((box[0] + box[2]) / 2, box[3])
        if cv2.pointPolygonTest(self.polygon, foot, False) < 0:
            return None  # outside the calibrated road: no trustworthy speed
        point = cv2.perspectiveTransform(np.array([[foot]], dtype=np.float32), self.matrix)[0][0]
        return float(point[0]), float(point[1])


def parse_quad(text: str) -> list[tuple[float, float]]:
    points = [tuple(float(v) for v in pair.split(",")) for pair in text.split(";")]
    if len(points) != 4 or any(len(p) != 2 for p in points):
        raise SystemExit('--road-quad needs four "x,y" corners separated by ";"')
    return points  # type: ignore[return-value]


class Track:
    def __init__(self, track_id: int, now: float) -> None:
        self.id = track_id
        self.classes: Counter[str] = Counter()
        self.confs: deque[float] = deque(maxlen=60)
        self.history: deque[tuple[float, float, float]] = deque()  # (time, cx, cy)
        self.box = (0.0, 0.0, 0.0, 0.0)
        self.still_since: float | None = None
        self.last_seen = now
        self.hits = 0  # frames this vehicle was detected in
        self.ground: deque[tuple[float, float, float]] = deque()  # (time, x m, y m) on the calibrated road
        self.speed_kmh: float | None = None

    @property
    def vehicle_type(self) -> str:
        return self.classes.most_common(1)[0][0]

    @property
    def confidence(self) -> float:
        return float(np.mean(self.confs)) if self.confs else 0.0

    def update(self, now: float, box: tuple[float, ...], cls: str, conf: float) -> None:
        self.last_seen, self.box = now, tuple(box)
        self.hits += 1
        self.classes[cls] += 1
        self.confs.append(conf)
        cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
        self.history.append((now, cx, cy))
        while self.history and now - self.history[0][0] > STILL_WINDOW:
            self.history.popleft()
        span = self.history[-1][0] - self.history[0][0]
        if span < STILL_WINDOW * 0.6:  # not watched long enough to judge yet
            return
        height = max(box[3] - box[1], 1.0)
        moved = max(np.hypot(x - cx, y - cy) for _, x, y in self.history)
        if moved / height < STILL_TOLERANCE:
            if self.still_since is None:
                self.still_since = self.history[0][0]
        else:
            self.still_since = None

    def stopped_seconds(self, now: float) -> float:
        return now - self.still_since if self.still_since is not None else 0.0

    def measure_speed(self, now: float, meter: SpeedMeter | None) -> None:
        point = meter.ground(self.box) if meter else None
        if point is None:
            self.ground.clear()
            self.speed_kmh = None
            return
        self.ground.append((now, *point))
        while self.ground and now - self.ground[0][0] > SPEED_WINDOW:
            self.ground.popleft()
        span = self.ground[-1][0] - self.ground[0][0]
        if span < SPEED_WINDOW * 0.6:
            return
        metres = np.hypot(self.ground[-1][1] - self.ground[0][1], self.ground[-1][2] - self.ground[0][2])
        self.speed_kmh = round(min(metres / span * 3.6, 300.0), 1)


class Tracker:
    """Turns per-frame tracker output into moving / stopped / parked vehicles."""

    def __init__(self, args: argparse.Namespace, parking: ParkingAvailabilityBridge | None) -> None:
        self.args = args
        self.parking = parking
        self.meter = (
            SpeedMeter(parse_quad(args.road_quad), args.road_width_m, args.road_length_m) if args.road_quad else None
        )
        self.tracks: dict[int, Track] = {}
        self.flow_ids: dict[int, float] = {}

    def reset(self) -> None:
        self.tracks.clear()
        self.flow_ids.clear()
        if self.parking:
            self.parking.reset()

    def status(self, track: Track, now: float) -> str:
        still = track.stopped_seconds(now)
        if self.parking is not None:
            # Police cameras: only the parking bridge decides "parked"; standing still alone is not enough.
            if self.parking.state_of(track.id) == PARKED:
                return "parked"
        elif still >= self.args.park_seconds:
            # Parking-lot cameras: a vehicle that stands still is taking a space.
            return "parked"
        if still >= self.args.stop_seconds:
            return "stopped"
        return "moving"

    def step(self, now: float, frame: np.ndarray, result, names: dict[int, str]) -> tuple[np.ndarray, dict]:
        boxes = result.boxes
        current: list[Track] = []
        if boxes is not None and boxes.id is not None:
            for xyxy, tid, cls, conf in zip(
                boxes.xyxy.tolist(), boxes.id.int().tolist(), boxes.cls.int().tolist(), boxes.conf.tolist()
            ):
                track = self.tracks.get(tid) or self.tracks.setdefault(tid, Track(tid, now))
                track.update(now, xyxy, names[cls], conf)
                current.append(track)
                # Brief false detections also get a number; only count real vehicles in the flow.
                if track.hits >= MIN_HITS_FOR_FLOW and tid not in self.flow_ids:
                    self.flow_ids[tid] = now
        for tid in [t for t, tr in self.tracks.items() if now - tr.last_seen > TRACK_FORGET_SECONDS]:
            del self.tracks[tid]
        for tid in [t for t, first in self.flow_ids.items() if now - first > 60]:
            del self.flow_ids[tid]

        h, w = frame.shape[:2]
        for track in current:
            track.measure_speed(now, self.meter)
        if self.parking is not None:
            observations = [
                Observation(
                    track_id=t.id,
                    box=(t.box[0] / w, t.box[1] / h, t.box[2] / w, t.box[3] / h),
                    still_seconds=t.stopped_seconds(now),
                    vehicle_type=t.vehicle_type,
                    confidence=t.confidence,
                )
                for t in current
            ]
            self.parking.observe(now, observations, snapshot=lambda change: vehicle_photo(frame, change))

        annotated = frame.copy()
        statuses = Counter()
        sent_tracks = []
        road_speeds: list[float] = []
        for track in current:
            status = self.status(track, now)
            statuses[status] += 1
            # Traffic speed is the speed of the traffic: parked vehicles are not part of it.
            if status != "parked" and track.speed_kmh is not None:
                road_speeds.append(track.speed_kmh)
            x1, y1, x2, y2 = (int(v) for v in track.box)
            color = COLORS[status]
            cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 3 if status != "moving" else 2)
            still = track.stopped_seconds(now)
            label = f"#{track.id} {track.vehicle_type} {track.confidence:.0%}"
            if status != "moving":
                label += f" {status.upper()} {still:.0f}s"
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 2)
            cv2.rectangle(annotated, (x1, max(0, y1 - th - 8)), (x1 + tw + 6, y1), color, -1)
            cv2.putText(annotated, label, (x1 + 3, max(th, y1 - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2)
            sent_tracks.append(
                {
                    "track_id": track.id,
                    "vehicle_type": track.vehicle_type,
                    "status": status,
                    "confidence": round(min(max(track.confidence, 0.0), 1.0), 3),
                    "speed_kmh": track.speed_kmh,
                    "stopped_seconds": round(still, 1),
                    "parking_state": "PARKED" if status == "parked" else "NOT_PARKED",
                    "box": [
                        round(min(max(track.box[0] / w, 0.0), 1.0), 4),
                        round(min(max(track.box[1] / h, 0.0), 1.0), 4),
                        round(min(max(track.box[2] / w, 0.0), 1.0), 4),
                        round(min(max(track.box[3] / h, 0.0), 1.0), 4),
                    ],
                }
            )

        sent_tracks.sort(key=lambda t: {"parked": 0, "stopped": 1, "moving": 2}[t["status"]])
        telemetry = {
            "vehicle_count": len(current),
            "moving_count": statuses["moving"],
            "stopped_count": statuses["stopped"],
            "parked_count": statuses["parked"],
            "counts_by_class": dict(Counter(t.vehicle_type for t in current)),
            "flow_per_minute": len(self.flow_ids),
            # Measured only on a calibrated road. Null otherwise, and the backend keeps traffic as unknown.
            "avg_speed_kmh": round(float(np.mean(road_speeds)), 1) if road_speeds else None,
            "speed_calibrated": self.meter is not None,
            "tracks": sent_tracks[:MAX_TRACKS_SENT],
        }
        return annotated, telemetry


def vehicle_photo(frame: np.ndarray, change: Transition) -> str | None:
    """JPEG crop around a vehicle that just became PARKED, base64 encoded for the backend."""
    h, w = frame.shape[:2]
    x1, y1, x2, y2 = change.box[0] * w, change.box[1] * h, change.box[2] * w, change.box[3] * h
    pad_x, pad_y = (x2 - x1) * 0.6, (y2 - y1) * 0.6
    crop = (int(max(0, x1 - pad_x)), int(max(0, y1 - pad_y)), int(min(w, x2 + pad_x)), int(min(h, y2 + pad_y)))
    photo = frame[crop[1] : crop[3], crop[0] : crop[2]].copy()
    if photo.size == 0:
        return None
    cv2.rectangle(photo, (int(x1) - crop[0], int(y1) - crop[1]), (int(x2) - crop[0], int(y2) - crop[1]), COLORS["parked"], 2)
    ok, jpeg = cv2.imencode(".jpg", photo, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return base64.b64encode(jpeg.tobytes()).decode() if ok else None


# --------------------------------------------------------------------------- main


def main() -> None:
    parser = argparse.ArgumentParser(description="Track vehicles and raise parking alerts for a Park Mandu camera")
    parser.add_argument(
        "--source",
        help="Video file, camera index, or address such as http://192.168.18.139:8080/video. "
        "Optional for cameras connected under My Parking: their saved stream address is used.",
    )
    parser.add_argument("--camera-code", required=True, help="Camera to show the video on, e.g. CAM-014")
    parser.add_argument("--conf", type=float, default=0.25, help="Minimum detection confidence (default 0.25)")
    parser.add_argument("--stop-seconds", type=float, default=3, help="Standing still this long = stopped (default 3)")
    parser.add_argument(
        "--park-seconds",
        type=float,
        help="Police cameras: minimum standing time before a vehicle can be judged PARKED (default 30; "
        "other traffic must also pass it). Parking-lot cameras: standing this long takes a space (default 10)",
    )
    parser.add_argument("--min-passers", type=int, default=2, help="Vehicles that must drive past a standing vehicle before it is PARKED (default 2)")
    parser.add_argument(
        "--isolated-seconds", type=float, default=30, help="With no queue around it, standing this long alone is PARKED (default 30)"
    )
    parser.add_argument("--road-quad", help='Speed calibration: four image corners of a road patch, "x,y;x,y;x,y;x,y"')
    parser.add_argument("--road-width-m", type=float, help="Real width of that patch in metres (first edge)")
    parser.add_argument("--road-length-m", type=float, help="Real length of that patch in metres (second edge)")
    parser.add_argument("--violation", default="no_parking_zone", help="Violation type sent with alerts (default no_parking_zone)")
    parser.add_argument("--no-realtime", action="store_true", help="Process a video file as fast as possible instead of at its own speed")
    parser.add_argument("--port", type=int, default=8090)
    parser.add_argument("--backend", default="http://localhost:8000/api/v1")
    parser.add_argument("--public-host", help="Address other devices use to reach this PC (default: detected)")
    args = parser.parse_args()
    args.backend = args.backend.rstrip("/")
    args.camera_code = args.camera_code.upper()
    if args.road_quad and not (args.road_width_m and args.road_length_m):
        raise SystemExit("--road-quad also needs --road-width-m and --road-length-m")

    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"Missing model: {MODEL_PATH}")
    key = read_ingest_key()

    config = detector_config(args, key)
    args.parking_mode = config.get("mode") == "parking"
    if not args.source:
        args.source = config.get("source_url")
        if not args.source:
            raise SystemExit(f"No --source given and the backend has no stream address saved for {args.camera_code}.")
    if args.park_seconds is None:
        # In a parking lot a vehicle that has stood still briefly is taking a space.
        args.park_seconds = 10.0 if args.parking_mode else 30.0
    if args.parking_mode:
        capacity = config.get("capacity")
        print(
            f"Parking mode for {config.get('parking_name') or args.camera_code}"
            f"{f' ({capacity} spaces)' if capacity else ''}: counting parked vehicles, no alerts.",
            flush=True,
        )

    model = YOLO(str(MODEL_PATH))
    print("Model loaded:", MODEL_PATH, flush=True)
    print("Vehicle classes:", model.names, flush=True)
    parking: ParkingAvailabilityBridge | None = None
    if args.parking_mode:
        print(f"Stopped after {args.stop_seconds:g}s still, taking a space after {args.park_seconds:g}s still.", flush=True)
    else:
        rules = ParkingRules(
            min_dwell_seconds=args.park_seconds,
            min_passers=args.min_passers,
            isolated_dwell_seconds=max(args.isolated_seconds, args.park_seconds),
        )
        classifier = ParkingClassifier(rules)
        client = ParkingStatusClient(
            args.backend,
            key,
            args.camera_code,
            bridge_id=classifier.session,
            violation_type=args.violation,
            log=lambda message: print(message, flush=True),
        )
        parking = ParkingAvailabilityBridge(classifier, client, log=lambda message: print(message, flush=True))
        parking.start()
        print(
            f"Parking Availability Bridge: PARKED after standing {rules.min_dwell_seconds:g}s while "
            f"{rules.min_passers}+ vehicles pass, or {rules.isolated_dwell_seconds:g}s alone; queues never count.",
            flush=True,
        )
    if args.road_quad:
        print(f"Road calibrated: {args.road_width_m:g} m x {args.road_length_m:g} m; measuring traffic speed.", flush=True)
    elif not args.parking_mode:
        print("Road not calibrated: no traffic speed, so the backend holds parking alerts back for this camera.", flush=True)

    host = args.public_host or lan_address(urlparse(args.source).hostname or "8.8.8.8")
    stream_url = f"http://{host}:{args.port}"
    server = ThreadingHTTPServer(("0.0.0.0", args.port), Preview)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    threading.Thread(target=report, args=(args, key, stream_url), daemon=True).start()

    source = int(args.source) if args.source.isdigit() else args.source
    is_file = isinstance(source, str) and Path(source).is_file()
    video_fps = 0.0
    if is_file:
        capture = cv2.VideoCapture(source)
        video_fps = capture.get(cv2.CAP_PROP_FPS) or 25.0
        capture.release()
    tracker = Tracker(args, parking)

    while True:
        try:
            print(f"Connecting to {args.source} ...", flush=True)
            tracker.reset()
            started, frames = time.monotonic(), 0
            for result in model.track(
                source=source, conf=args.conf, stream=True, verbose=False, persist=False, tracker="bytetrack.yaml"
            ):
                frames += 1
                if frames == 1:
                    print(f"Connected to {args.source}; tracking.", flush=True)
                # Time inside the video: for a file, frame number / frame rate, so "standing still for
                # 30 s" means 30 s of footage however fast the PC is.
                now = frames / video_fps if is_file else time.monotonic()
                if is_file and not args.no_realtime:
                    ahead = now - (time.monotonic() - started)
                    if ahead > 0:
                        time.sleep(ahead)
                annotated, telemetry = tracker.step(now, result.orig_img, result, model.names)
                elapsed = time.monotonic() - started
                telemetry["fps"] = round(min(frames / elapsed, 240), 1) if elapsed > 1 else None
                ok, jpeg = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 80])
                if ok:
                    latest.publish(jpeg.tobytes(), telemetry)
            print("Video ended; starting again.", flush=True)
        except KeyboardInterrupt:
            print("Stopped.", flush=True)
            return
        except Exception as exc:  # camera unreachable or dropped: keep trying
            print(f"Camera problem: {exc}", flush=True)
        time.sleep(RECONNECT_SECONDS)


if __name__ == "__main__":
    main()
