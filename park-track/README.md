# Vehicle Parking Detection

This program uses the YOLO model in `best.pt` to detect and track vehicles in a video. It checks each vehicle's movement and marks it as stopped or a possible parking candidate.

## Install

Install Python 3.10+, then from this folder:

```bash
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
python -m pip install -r requirements.txt
```

For GPU inference install a PyTorch build that matches your CUDA version first (see pytorch.org); the
default PyTorch wheel is CPU-only.

## Run offline (no backend)

```bash
python main.py                                  # video2.mp4, same behaviour as before
python main.py --source video.mp4 --show        # another file, with a preview window
```

Without `--camera-code` nothing is sent anywhere; results go to `output.csv`, `parked/` and the WebSocket.

## Connect to Park Mandu (backend + web + mobile)

```
 camera / phone ──video──▶ park-track (main.py) ──HTTPS + X-API-Key──▶ backend /api/v1/ingest/*
                                   │                                         │
                                   └── live preview :8090 ◀── web / mobile ──┘ alerts (SSE, push)
```

1. Start the backend (`cd backend && docker compose up`). Copy `INGEST_API_KEY` from `backend/.env`.
2. Run the detector with a camera code. Unknown codes are registered automatically on the first heartbeat:

```bash
set INGEST_API_KEY=<value from backend/.env>     # PowerShell: $env:INGEST_API_KEY="..."
python main.py --source video2.mp4 --realtime --camera-code DEMO-01 ^
  --name "Demo junction" --road "Kantipath" --area "Kathmandu" --lat 27.7056 --lng 85.3206
```

3. Sign in as police (badge `TP-2841`, password `ParkMandu@2026`). Under **Cameras**, `DEMO-01`
   shows the live annotated video. When a vehicle stays still for `--park-seconds` (30 by default), an
   alert with the vehicle photo appears under **Alerts** in real time.

What the detector sends:

| Call | When | Purpose |
| --- | --- | --- |
| `POST /ingest/heartbeat` | at start, then every 30 s | registers/updates the camera, marks it live, publishes the preview URL |
| `POST /ingest/detections` | once per parked vehicle | creates an alert with a base64 JPEG crop (`snapshot_base64`) |

Stop the detector and the camera goes offline in the app after about 2 minutes (when
`SIMULATE_DETECTIONS=false`). Set `SIMULATE_DETECTIONS=false` in `backend/.env` once you use real
cameras, so the demo simulator stops inventing alerts.

Useful options (`python main.py --help` lists all):

| Option | Default | Notes |
| --- | --- | --- |
| `--violation` | `no_parking_zone` | what kind of violation this camera watches (`bus_stop_obstruction`, `footpath_obstruction`, …) |
| `--park-seconds` | 30 | lower it (e.g. 10) for demos |
| `--window` | 1.0 | raise to 2–3 if the source or CPU gives fewer than ~3 frames per second |
| `--preview-port` | 8090 | annotated MJPEG at `/stream.mjpg`, still frame at `/snapshot.jpg`; `0` disables it |
| `--public-host` | LAN IP | the address phones and browsers use to reach the preview |
| `--realtime` | off | play files at real speed instead of as fast as possible |

The machine running `main.py` must allow inbound TCP 8090 (preview) through Windows Firewall, and the
web/mobile apps must be on the same network. The preview has no login, so only expose it on a trusted
LAN or put it behind a VPN/reverse proxy.

## Camera sources

`--source` accepts anything OpenCV can open. One `main.py` process handles one camera; run one process
per camera (each with its own `--camera-code` and `--preview-port`).

### Mobile phone as the camera

The phone streams video over Wi-Fi; `main.py` runs on a laptop/PC on the same network.

**Android – "IP Webcam" (free, Play Store)**
1. Install IP Webcam, set *Video preferences → Video resolution* to 1280×720, then tap **Start server**.
2. The app shows an address such as `http://192.168.1.23:8080`.
3. Run:
   ```bash
   python main.py --source http://192.168.1.23:8080/video --camera-code PHONE-01 --name "My phone" --lat 27.71 --lng 85.32
   ```

**Android or iPhone – "DroidCam"**: start the app, then use `--source http://<phone-ip>:4747/video`.

**iPhone – any RTSP camera app** (for example "IP Camera Lite" or "Larix Broadcaster" in RTSP server
mode): use the `rtsp://...` URL the app displays.

Tips: mount the phone (tripod or window clamp) looking at the road; keep it charging; disable screen
lock/battery saving for the app. Phone and PC must be on the same Wi-Fi, or use a hotspot from the PC.
Test the URL in a browser or VLC first; if it plays there, `main.py` can read it.

### CCTV / IP cameras

Most IP cameras and NVRs expose RTSP. Typical URLs (replace user, password and IP):

| Brand | Main stream |
| --- | --- |
| Hikvision | `rtsp://admin:PASS@192.168.1.64:554/Streaming/Channels/101` (use `102` for the lighter sub-stream) |
| Dahua / CP Plus | `rtsp://admin:PASS@192.168.1.108:554/cam/realmonitor?channel=1&subtype=0` |
| Generic ONVIF | find the URL with ONVIF Device Manager, or in the camera's web UI under Network → RTSP |

```bash
python main.py --source "rtsp://admin:PASS@192.168.1.64:554/Streaming/Channels/102" --camera-code CAM-014
```

Use the camera's existing code (`CAM-014` etc.) to attach the AI to a camera already in the database,
or a new code to register one. Prefer the sub-stream (lower resolution) on CPU-only machines; parking
detection does not need full HD. For cameras on another site, run `main.py` on a small PC (or a
Jetson) at that site and point `--api-url` at the public backend.

### USB webcam

`--source 0` (or `1`, `2` for additional webcams).

## How it works

`main.py` loads `best.pt` once and reads the video one frame at a time. It passes each frame to `detect_parking()` in `detect-parking.py`. ByteTrack keeps vehicle IDs between frames, and the function checks the recent position of each vehicle.

The program writes rows to `output.csv` only while a vehicle is `stopped` or a `parking_candidate`. Each row includes the time in seconds, vehicle ID, class, status, confidence, and bounding box.

Inference uses CUDA GPU 0 when PyTorch detects a CUDA-capable GPU; otherwise it runs on the CPU. For GPU inference, install a PyTorch build that matches your CUDA setup; the default PyTorch installation may be CPU-only.

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
