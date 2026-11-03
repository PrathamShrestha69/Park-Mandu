import csv
import asyncio
import importlib.util
import json
from pathlib import Path
import threading

import websockets

import cv2
import torch
from ultralytics import YOLO


folder = Path(__file__).parent
model_path = folder / "best.pt"
video_source = folder / "video2.mp4"  # Change to 0 for a webcam or a stream URL.
FIXED_FPS = 25.0
output_path = folder / "output.csv"
parked_path = folder / "parked"
WEBSOCKET_HOST = "0.0.0.0"
WEBSOCKET_PORT = 8765


class DetectionSocket:
    """WebSocket broadcaster for the most recently processed frame."""

    def __init__(self, host=WEBSOCKET_HOST, port=WEBSOCKET_PORT):
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

    def _run(self):
        asyncio.set_event_loop(self.loop)
        self.loop.run_until_complete(websockets.serve(self._handler, self.host, self.port))
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
        asyncio.run_coroutine_threadsafe(
            self._broadcast(json.dumps(payload)), self.loop
        )

    def stop(self):
        if self.loop.is_running():
            self.loop.call_soon_threadsafe(self.loop.stop)
            self.thread.join(timeout=2)

# Load the hyphenated file (Python imports cannot use hyphens).
spec = importlib.util.spec_from_file_location("parking_detector", folder / "detect-parking.py")
parking_detector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parking_detector)
detect_parking = parking_detector.detect_parking


def main():
    # Load the model once, then reuse it for every frame.
    model = YOLO(model_path)
    device = "0" if torch.cuda.is_available() else "cpu"
    print(f"Running inference on {'CUDA GPU 0' if device == '0' else 'CPU'}")
    capture = cv2.VideoCapture(
        video_source if isinstance(video_source, int) else str(video_source)
    )
    frame_number = 0
    saved_vehicles = set()
    parked_path.mkdir(exist_ok=True)
    detection_socket = DetectionSocket()
    detection_socket.start()

    try:
        with open(output_path, "w", newline="") as output:
            writer = csv.DictWriter(
                output,
                fieldnames=[
                    "time_seconds", "track_id", "class", "status",
                    "confidence", "x1", "y1", "x2", "y2",
                ],
            )
            writer.writeheader()

            # Read and process one frame at a time.
            while capture.isOpened():
                success, frame = capture.read()
                if not success:
                    break

                frame_number += 1
                timestamp = (frame_number - 1) / FIXED_FPS
                vehicles = detect_parking(model, frame, timestamp, device=device)
                detection_socket.publish(frame_number, timestamp, vehicles)
                for vehicle in vehicles:
                    if vehicle["status"] in {"stopped", "parking_candidate"}:
                        writer.writerow(vehicle)

                    # Save one cropped image when a vehicle becomes a parking candidate.
                    track_id = vehicle["track_id"]
                    if vehicle["status"] == "parking_candidate" and track_id not in saved_vehicles:
                        height, width = frame.shape[:2]
                        x1 = max(0, int(vehicle["x1"]))
                        y1 = max(0, int(vehicle["y1"]))
                        x2 = min(width, int(vehicle["x2"]))
                        y2 = min(height, int(vehicle["y2"]))
                        vehicle_image = frame[y1:y2, x1:x2]

                        if vehicle_image.size:
                            seconds = f"{timestamp:.2f}"
                            image_path = parked_path / f"vehicle_{track_id}_time_{seconds}_seconds.jpg"
                            quality = [cv2.IMWRITE_JPEG_QUALITY, 95]
                            if cv2.imwrite(str(image_path), vehicle_image, quality):
                                saved_vehicles.add(track_id)
    finally:
        capture.release()
        detection_socket.stop()


if __name__ == "__main__":
    main()
