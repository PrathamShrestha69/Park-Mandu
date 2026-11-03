from collections import deque
import time


def detect_parking(model, frame, timestamp=None, device="cpu"):
    """Process one frame and return the vehicles found in it."""
    if not hasattr(model, "_parking_state"):
        model._parking_state = {"tracks": {}}

    # Supply video time when available. Live frames use the clock.
    timestamp = time.monotonic() if timestamp is None else timestamp
    tracks = model._parking_state["tracks"]

    # persist=True keeps vehicle IDs between calls.
    result = model.track(
        frame,
        persist=True,
        tracker="bytetrack.yaml",
        device=device,
        verbose=False,
    )[0]

    if result.boxes is None or result.boxes.id is None:
        return []

    records = []
    for box, track_id in zip(result.boxes, result.boxes.id.int().tolist()):
        track_id = int(track_id)
        class_name = result.names[int(box.cls[0])]
        confidence = float(box.conf[0])
        x1, y1, x2, y2 = map(float, box.xyxy[0])
        center_x = (x1 + x2) / 2
        center_y = (y1 + y2) / 2
        track = tracks.setdefault(
            track_id,
            {"positions": deque(), "stopped_since": None, "last_seen": timestamp},
        )

        if timestamp - track["last_seen"] > 1.0:
            track["positions"].clear()
            track["stopped_since"] = None

        track["last_seen"] = timestamp
        positions = track["positions"]
        positions.append((timestamp, center_x, center_y))

        # Keep only the latest second of positions to check movement.
        while positions and timestamp - positions[0][0] > 1.0:
            positions.popleft()

        stable = len(positions) > 1 and positions[-1][0] - positions[0][0] >= 0.8
        if stable:
            start_x, start_y = positions[0][1:]
            moved = any(
                ((x - start_x) ** 2 + (y - start_y) ** 2) ** 0.5 > 15.0
                for _, x, y in positions
            )
            if moved:
                track["stopped_since"] = None
            elif track["stopped_since"] is None:
                track["stopped_since"] = timestamp - 1.0
        else:
            track["stopped_since"] = None

        stopped_for = (
            timestamp - track["stopped_since"]
            if track["stopped_since"] is not None
            else 0
        )

        # A stopped vehicle becomes a parking candidate after 30 seconds.
        if stopped_for >= 30.0:
            status = "parking_candidate"
        elif stopped_for >= 3.0:
            status = "stopped"
        else:
            status = "moving"

        records.append(
            {
                "time_seconds": timestamp,
                "track_id": track_id,
                "class": class_name,
                "status": status,
                "confidence": confidence,
                "x1": x1, "y1": y1,
                "x2": x2, "y2": y2,
            }
        )

    return records
