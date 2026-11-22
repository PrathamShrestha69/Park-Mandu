# Park Mandu

Smart parking and illegal-parking detection for Kathmandu Valley.

| Part | Folder | What it does | Runs on |
| --- | --- | --- | --- |
| Backend API | `backend/` | FastAPI + PostgreSQL + Redis, alerts, users, cameras | http://localhost:8000 |
| Web app | `frontend/web/` | Next.js app for public users, traffic police and admins | http://localhost:3000 |
| Mobile app | `frontend/mobile/` | Expo (React Native) app for public users and traffic police | Expo Go on your phone |
| AI detector | `park-track/` | YOLO + ByteTrack; tracks every vehicle in a camera feed, measures traffic and raises parked-vehicle alerts | live video on port 8090 |

```
 phone camera / CCTV ──video──▶ AI detector ──live tracking, alerts + photos──▶ Backend ◀── Web app / Mobile app
                                    └──────────── live AI video (port 8090) ────────────────▲
```

Administrators use the web app only. The mobile app has no administrator screens and the API refuses
administrator sign-ins from it.

---

## 1. Install once

On the laptop/PC that runs everything:

- **Docker Desktop**: https://www.docker.com/products/docker-desktop
- **Node.js 20 or newer**: https://nodejs.org
- **Python 3.10 or newer**: https://www.python.org (tick "Add Python to PATH")
- **Git**

Then from the project folder:

```powershell
# Backend settings
cd backend
copy .env.example .env
cd ..

# Web app
cd frontend\web
copy .env.example .env.local
npm install
cd ..\..

# Mobile app
cd frontend\mobile
npm install
cd ..\..

# AI detector
cd park-track
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
cd ..
```

In `backend\.env`, replace the three `change-me` secrets. The commands that generate them are written
next to each one in the file. `SIMULATE_DETECTIONS=true` keeps the demo cameras alive; a camera that
has a real AI detector is never simulated, so both can run side by side.

> macOS/Linux: use `cp` instead of `copy`, and `.venv/bin/python` instead of `.\.venv\Scripts\python`.

---

## 2. Start everything

Use one terminal per part, each opened in the project folder. Open Docker Desktop first and wait until
it is running.

**Terminal 1: Backend**
```powershell
cd backend
docker compose up --build
```
Ready when http://localhost:8000/docs opens. The first start takes a few minutes.

**Terminal 2: Web app**
```powershell
cd frontend\web
npm run dev
```
Open http://localhost:3000.

**Terminal 3: AI detector** (see section 3 for the camera address)
```powershell
cd park-track
$env:INGEST_API_KEY = ((Get-Content ..\backend\.env | Select-String '^INGEST_API_KEY=') -split '=',2)[1]
.\.venv\Scripts\python main.py --source http://<PHONE-IP>:8080/video --camera-code PHONE-01 --name "My phone" --lat 27.7056 --lng 85.3206
```
To try it without a camera, use the sample video and attach the AI to the existing camera `CAM-014`
(one line):

```powershell
.\.venv\Scripts\python main.py --source video2.mp4 --realtime --park-seconds 10 --camera-code CAM-014 --road-quad "265,475;690,593;890,387;575,345" --road-width-m 7 --road-length-m 12
```

The three `--road-…` options calibrate speed for that video (approximate: they assume 3.5 m lanes and
6 m between lane dashes). Without them vehicles are still tracked and counted, but average speed and
the traffic level are not measured. See [park-track/README.md](park-track/README.md) for calibrating
your own camera.

**Terminal 4: Mobile app**
```powershell
cd frontend\mobile
npm start
```
A QR code appears; see section 4.

### Sign in

All demo accounts use the password `ParkMandu@2026`.

| Role | Sign in with |
| --- | --- |
| Traffic police (sees cameras and alerts) | `TP-2841` |
| Administrator (web only) | `nabin.shrestha@parkmandu.test` |
| Public user | `sita.sharma@example.com` |

As police, open **Cameras** and choose your camera (for example `CAM-014` or `PHONE-01`) to watch the
live AI video. Every vehicle keeps its number while it is in view, and the page lists the tracked
vehicles, counts, average speed and traffic level, refreshed every two seconds. Red boxes are vehicles
the **Parking Availability Bridge** judged PARKED: they stood still while other traffic drove past
them (or stood alone for two minutes). Vehicles waiting in a queue are never PARKED. A PARKED vehicle
becomes an alert, with a photo, under **Alerts** only while the camera's traffic is flowing normally;
during a jam, or while the camera's traffic has not been measured recently, the alert is held back and
raised once traffic is normal again. The same camera appears under **Road conditions** on the dashboard
marked "AI tracking".

> Traffic is measured from vehicle speed, so a police camera needs its road calibrated
> (`--road-quad`, `--road-width-m`, `--road-length-m` on `camera-bridge/bridge.py`). Without
> calibration its traffic stays unknown and its parking alerts are held back.

As administrator, **Issue reports** lists the problems public users report about parking locations.

---

## 3. Use a phone as the camera

The phone only sends video. The AI runs on the laptop. **The phone and the laptop must be on the same
Wi-Fi.**

### Android: IP Webcam
1. Install **IP Webcam** (by Pavel Khlebovich) from the Google Play Store.
2. Open it, optionally set *Video preferences → Video resolution* to `1280x720`, scroll to the bottom and
   tap **Start server**.
3. The screen shows an address such as `http://192.168.88.20:8080`.
4. Check it: open that address in the laptop's browser. You should see the phone's video.
5. In Terminal 3 use `--source http://192.168.88.20:8080/video` (your address, with `/video` added).

### iPhone or Android: DroidCam
1. Install **DroidCam Webcam** from the App Store or Google Play.
2. Open it. It shows *WiFi IP* (for example `192.168.88.21`) and *Port* (usually `4747`).
3. In Terminal 3 use `--source http://192.168.88.21:4747/video`.

### iPhone: RTSP camera apps
Any app that runs an RTSP server, such as **IP Camera Lite**, also works. Use the `rtsp://...` address it
shows as `--source`.

### Tips
- Mount the phone on a tripod or holder pointed at the road, keep it charging, and turn off auto-lock.
- If the phone reconnects to Wi-Fi, its address can change. Check the camera app and update `--source`.
- When Windows asks whether to let Python through the firewall, click **Allow**. Without that, the web
  and mobile apps cannot load the live video from port 8090.
- A vehicle standing still for 30 s is judged PARKED and the alert goes out straight away. Only a
  queue of standing vehicles (a traffic jam) holds it back. For a quicker demo, add `--park-seconds 10`
  (then 10 s is enough when other traffic drives past it).

### CCTV cameras instead of a phone
Use the camera's RTSP address, for example Hikvision
`rtsp://admin:PASSWORD@192.168.1.64:554/Streaming/Channels/102`. Run one detector per camera, each with
its own `--camera-code` and `--preview-port`. More formats and options are in
[park-track/README.md](park-track/README.md).

---

## 4. Install the Park Mandu app on Android and iPhone

During development the app runs inside **Expo Go**, so there is no APK or App Store build yet.

1. Install **Expo Go** on the phone: Google Play (Android) or App Store (iPhone).
2. Put the phone on the **same Wi-Fi** as the laptop.
3. Start Terminal 4 (`npm start` in `frontend\mobile`).
4. Open the app:
   - **Android:** open Expo Go and tap **Scan QR code**, then scan the code in the terminal.
   - **iPhone:** open the normal **Camera** app, point it at the QR code and tap the banner.
5. Sign in as `TP-2841` / `ParkMandu@2026`, then open **Cameras → PHONE-01**.

The app finds the backend automatically, on the laptop that runs `npm start`, port 8000. If it cannot
connect:
- Allow port **8000** and port **8090** through Windows Firewall.
- If your Wi-Fi blocks devices from reaching each other (common on public or office networks), use a
  phone hotspot, or run `npx expo start --tunnel`. Note that live video still needs the same network.

The same phone can be both the camera and the app viewer. IP Webcam keeps streaming in the background
while you use Expo Go.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Camera page says "Waiting for video from the AI detector…" | Detector not running, or its `--source` is wrong. Open the phone's address in a browser to test it. Watch Terminal 3 for `Connected to …`. |
| Camera shows **Offline** | The detector stopped. Cameras go offline about 2 minutes after the last heartbeat. |
| Detector says `Backend rejected the API key` | `INGEST_API_KEY` must match `backend\.env`. Re-run the `$env:INGEST_API_KEY = ...` line. |
| Fake alerts appear on other cameras | Those are the demo cameras. Set `SIMULATE_DETECTIONS=false` in `backend\.env` and restart Terminal 1 to switch the demo off (demo cameras then go offline). |
| Camera page shows counts but "Camera not calibrated for speed" | Add `--road-quad`, `--road-width-m` and `--road-length-m` (see `park-track/README.md`). |
| A parked vehicle was logged by the detector but no alert appeared | The detector prints `Backend ignored parked …`: the detection confidence was under the backend's 60% alert threshold. |
| Administrator cannot sign in on the phone | Intended: administrators use the web app at http://localhost:3000. |
| Detector is slow (under 3 frames/s) | Lower the camera resolution, or add `--window 2.5`. An NVIDIA GPU with CUDA PyTorch is much faster. |
| Mobile app cannot reach the API | Same Wi-Fi, and allow port 8000 through the firewall. |

Paid parking (eSewa and Khalti): [PAYMENT_GATEWAY_DOCUMENTATION.md](PAYMENT_GATEWAY_DOCUMENTATION.md).
In-app directions use the routing service set by `ROUTING_BASE_URL` in `backend/.env` (OSRM).

Detailed docs: [backend/README.md](backend/README.md) · [frontend/mobile/README.md](frontend/mobile/README.md) ·
[park-track/README.md](park-track/README.md)
