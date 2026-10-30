from collections import deque
from pathlib import Path
import csv

import cv2
from ultralytics import YOLO


folder = Path(__file__).parent
video_path = folder / "video.mp4"
model = YOLO(folder / "best.pt")

cap = cv2.VideoCapture(str(video_path))
fps = cap.get(cv2.CAP_PROP_FPS) or 30
cap.release()

stationary_window = 1.0  # seconds used to check for movement
stopped_after = 3.0  # seconds before a vehicle is called stopped
parked_after = 30.0  # seconds before a stopped vehicle is a parking candidate
movement_threshold = 15.0  # pixels of movement within the stationary window
tracks = {}

with open(folder / "output.txt", "w", newline="") as output:
    writer = csv.writer(output)
    writer.writerow(
        ["frame", "time_seconds", "track_id", "class", "status", "confidence", "x1", "y1", "x2", "y2"]
    )

    next_track_id = 1
    for frame, result in enumerate(model.predict(source=str(video_path), stream=True, verbose=False), 1):
        time_seconds = (frame - 1) / fps
        detections = []
        for box in result.boxes:
            class_id = int(box.cls[0])
            class_name = result.names[class_id]
            confidence = float(box.conf[0])
            x1, y1, x2, y2 = map(float, box.xyxy[0])
            center_x = (x1 + x2) / 2
            center_y = (y1 + y2) / 2
            detections.append((box, class_name, confidence, x1, y1, x2, y2, center_x, center_y))

        # Match each detection to the nearest recent track of the same class.
        possible_matches = []
        for detection_index, detection in enumerate(detections):
            _, class_name, _, x1, y1, x2, y2, center_x, center_y = detection
            for track_id, track in tracks.items():
                age = time_seconds - track["last_seen"]
                if track["class"] != class_name or age > 1.0:
                    continue
                old_x, old_y = track["center"]
                distance = ((center_x - old_x) ** 2 + (center_y - old_y) ** 2) ** 0.5
                box_size = max(x2 - x1, y2 - y1, track["box_size"])
                max_distance = max(40.0, box_size * 0.8) + age * 100
                if distance <= max_distance:
                    possible_matches.append((distance / max_distance, detection_index, track_id))

        assigned_detections = {}
        used_tracks = set()
        for _, detection_index, track_id in sorted(possible_matches):
            if detection_index not in assigned_detections and track_id not in used_tracks:
                assigned_detections[detection_index] = track_id
                used_tracks.add(track_id)

        for detection_index, detection in enumerate(detections):
            _, class_name, confidence, x1, y1, x2, y2, center_x, center_y = detection
            track_id = assigned_detections.get(detection_index)
            if track_id is None:
                track_id = next_track_id
                next_track_id += 1
                tracks[track_id] = {
                    "class": class_name,
                    "center": (center_x, center_y),
                    "box_size": max(x2 - x1, y2 - y1),
                    "positions": deque(),
                    "stopped_since": None,
                    "last_seen": time_seconds,
                }

            track = tracks[track_id]

            # Start a fresh movement window after a long detection gap.
            if time_seconds - track["last_seen"] > stationary_window:
                track["positions"].clear()
                track["stopped_since"] = None

            track["last_seen"] = time_seconds
            track["center"] = (center_x, center_y)
            track["box_size"] = max(x2 - x1, y2 - y1)
            positions = track["positions"]
            positions.append((time_seconds, center_x, center_y))
            while positions and time_seconds - positions[0][0] > stationary_window:
                positions.popleft()

            stable = len(positions) > 1 and positions[-1][0] - positions[0][0] >= stationary_window * 0.8
            if stable:
                start_x, start_y = positions[0][1:]
                moved = any(
                    ((x - start_x) ** 2 + (y - start_y) ** 2) ** 0.5 > movement_threshold
                    for _, x, y in positions
                )
                if moved:
                    track["stopped_since"] = None
                elif track["stopped_since"] is None:
                    track["stopped_since"] = time_seconds - stationary_window
            else:
                track["stopped_since"] = None

            stopped_for = (
                time_seconds - track["stopped_since"]
                if track["stopped_since"] is not None
                else 0
            )
            if stopped_for >= parked_after:
                status = "parking_candidate"
            elif stopped_for >= stopped_after:
                status = "stopped"
            else:
                status = "moving"

            writer.writerow(
                [frame, f"{time_seconds:.2f}", track_id, class_name, status,
                 f"{confidence:.4f}", f"{x1:.1f}", f"{y1:.1f}", f"{x2:.1f}", f"{y2:.1f}"]
            )
