# Vehicle Parking Detection

This program uses the YOLO model in `best.pt` to detect and track vehicles in a video. It checks each vehicle's movement and marks it as stopped or a possible parking candidate.

## Install

Install Python, then run:

```bash
python -m pip install ultralytics opencv-python lap websockets
```

## Run

Put the video in the project folder and set `video_source` in `main.py` to its path. By default, the program reads `video2.mp4` at the fixed rate of 25 FPS. If your video has a different frame rate, update `FIXED_FPS` in `main.py`.

```bash
python main.py
```

To use a webcam, set `video_source = 0`. A stream URL can be used instead of a file path.

## How it works

`main.py` loads `best.pt` once and reads the video one frame at a time. It passes each frame to `detect_parking()` in `detect-parking.py`. ByteTrack keeps vehicle IDs between frames, and the function checks the recent position of each vehicle.

The program writes rows to `output.csv` only while a vehicle is `stopped` or a `parking_candidate`. Each row includes the time in seconds, vehicle ID, class, status, confidence, and bounding box.

When a vehicle becomes a `parking_candidate`, its cropped image is saved once in the `parked` folder as a quality 95 JPEG. The filename includes the vehicle ID and elapsed time, for example `vehicle_1067_time_35.42_seconds.jpg`.

## Live detections over WebSocket

When `main.py` runs, it starts a WebSocket server on port `8765` and sends one JSON message for every processed video frame. Connect from a browser on the same computer with:

```js
const socket = new WebSocket("ws://localhost:8765");

socket.addEventListener("message", (event) => {
  const frame = JSON.parse(event.data);
  if (frame.type !== "detections") return;

  // Replace the displayed detections each frame (an empty array clears old boxes).
  renderBoxes(frame.detections);
});

socket.addEventListener("open", () => console.log("Connected to vehicle detections"));
socket.addEventListener("close", () => console.log("Detection socket closed"));
```

`renderBoxes` is frontend code that draws the boxes over the matching video frame. Coordinates are pixel positions in the original source frame (`x1`, `y1`, `x2`, `y2`); scale them if the video is displayed at a different size. The message looks like this:

```json
{
  "type": "detections",
  "frame": 42,
  "time_seconds": 1.64,
  "detections": [
    {
      "track_id": 1067,
      "class": "car",
      "status": "moving",
      "confidence": 0.91,
      "x1": 120.5,
      "y1": 80.0,
      "x2": 310.2,
      "y2": 240.8,
      "parked": false,
      "box_color": "green"
    }
  ]
}
```

Each detection also includes its track ID, class, confidence, and status. `parked` is `true` only for `parking_candidate`; those boxes have `box_color: "red"`. Moving and stopped vehicles have `parked: false` and green boxes. A `stopped` vehicle is not considered parked yet; it becomes a parking candidate after being still for about 30 seconds. The server sends an empty `detections` array on frames where no tracked vehicles are found, so the frontend can remove stale boxes. For a frontend on another computer, connect to `ws://<processing-computer-ip>:8765` and allow inbound connections to port 8765 on that machine.

Statuses are:

- `moving`: the vehicle is moving or has not been still long enough.
- `stopped`: little movement for about 3 seconds.
- `parking_candidate`: little movement for about 30 seconds.

These statuses are based on movement in the video, so a stopped vehicle is only a possible parking event.
