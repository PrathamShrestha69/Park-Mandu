# Vehicle Parking Detection

This program uses the YOLO model in `best.pt` to detect and track vehicles in a video. It checks each vehicle's movement and marks it as stopped or a possible parking candidate.

## Install

Install Python, then run:

```bash
python -m pip install ultralytics opencv-python lap
```

## Run

Put the video in the project folder and set `video_source` in `main.py` to its path. By default, the program reads `video.mp4`.

```bash
python main.py
```

To use a webcam, set `video_source = 0`. A stream URL can be used instead of a file path.

## How it works

`main.py` loads `best.pt` once and reads the video one frame at a time. It passes each frame to `detect_parking()` in `detect-parking.py`. ByteTrack keeps vehicle IDs between frames, and the function checks the recent position of each vehicle.

The program writes one row per detected vehicle to `output.csv`, including the frame, time, vehicle ID, class, status, confidence, and bounding box.

Statuses are:

- `moving`: the vehicle is moving or has not been still long enough.
- `stopped`: little movement for about 3 seconds.
- `parking_candidate`: little movement for about 30 seconds.

These statuses are based on movement in the video, so a stopped vehicle is only a possible parking event.
