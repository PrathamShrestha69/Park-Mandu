import csv
import importlib.util
from pathlib import Path

import cv2
from ultralytics import YOLO


folder = Path(__file__).parent
model_path = folder / "best.pt"
video_source = folder / "video.mp4"  # Change to 0 for a webcam or a stream URL.
output_path = folder / "output.txt"

# Python module imports do not accept hyphens in file names, so load the requested filename directly.
spec = importlib.util.spec_from_file_location("parking_detector", folder / "detect-parking.py")
parking_detector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parking_detector)
detect_parking = parking_detector.detect_parking


def main():
    model = YOLO(model_path)
    capture = cv2.VideoCapture(str(video_source))
    fps = capture.get(cv2.CAP_PROP_FPS)
    frame_number = 0

    with open(output_path, "w", newline="") as output:
        writer = csv.DictWriter(
            output,
            fieldnames=[
                "frame", "time_seconds", "track_id", "class", "status",
                "confidence", "x1", "y1", "x2", "y2",
            ],
        )
        writer.writeheader()

        while capture.isOpened():
            success, frame = capture.read()
            if not success:
                break

            frame_number += 1
            timestamp = (frame_number - 1) / fps if fps > 0 else None
            for vehicle in detect_parking(model, frame, timestamp):
                writer.writerow({"frame": frame_number, **vehicle})

    capture.release()


if __name__ == "__main__":
    main()
