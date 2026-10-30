import csv
import importlib.util
from pathlib import Path

import cv2
from ultralytics import YOLO


folder = Path(__file__).parent
model_path = folder / "best.pt"
video_source = folder / "video2.mp4"  # Change to 0 for a webcam or a stream URL.
FIXED_FPS = 25.0
output_path = folder / "output.csv"
parked_path = folder / "parked"

# Load the hyphenated file (Python imports cannot use hyphens).
spec = importlib.util.spec_from_file_location("parking_detector", folder / "detect-parking.py")
parking_detector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parking_detector)
detect_parking = parking_detector.detect_parking


def main():
    # Load the model once, then reuse it for every frame.
    model = YOLO(model_path)
    capture = cv2.VideoCapture(
        video_source if isinstance(video_source, int) else str(video_source)
    )
    frame_number = 0
    saved_vehicles = set()
    parked_path.mkdir(exist_ok=True)

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
            vehicles = detect_parking(model, frame, timestamp)
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

    capture.release()


if __name__ == "__main__":
    main()
