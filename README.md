# Park Mandu

Smart parking and illegal-parking detection for Kathmandu Valley.

| Part | Folder | What it does | Runs on |
| --- | --- | --- | --- |
| Backend API | `backend/` | FastAPI + PostgreSQL + Redis, alerts, users, cameras | http://localhost:8000 |
| Web app | `frontend/web/` | Next.js app for public users, traffic police and admins | http://localhost:3000 |
| Mobile app | `frontend/mobile/` | Expo (React Native) app for Android and iPhone | Expo Go on your phone |
| AI detector | `park-track/` | YOLO + ByteTrack; finds parked vehicles in a camera feed and raises alerts | live video on port 8090 |

```
 phone camera / CCTV ──video──▶ AI detector ──alerts + photos──▶ Backend ◀── Web app / Mobile app
                                    └──────── live AI video (port 8090) ──────────▲
```

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
next to each one in the file. While using real cameras, also set `SIMULATE_DETECTIONS=false`, or the
demo simulator keeps inventing alerts.

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
To try it without a camera, use the sample video instead:
`--source video2.mp4 --realtime --park-seconds 10 --camera-code DEMO-01`.

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
| Administrator | `nabin.shrestha@parkmandu.test` |
| Public user | `sita.sharma@example.com` |

As police, open **Cameras** and choose your camera (for example `PHONE-01`) to watch the live AI video.
Red boxes are vehicles flagged as parked. Each parked vehicle creates an alert, with a photo, under
**Alerts**.

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
- For a quicker demo, add `--park-seconds 10`. The default is 30 seconds of standing still.

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
| Fake "bus stop" alerts appear | Set `SIMULATE_DETECTIONS=false` in `backend\.env` and restart Terminal 1. |
| Detector is slow (under 3 frames/s) | Lower the camera resolution, or add `--window 2.5`. An NVIDIA GPU with CUDA PyTorch is much faster. |
| Mobile app cannot reach the API | Same Wi-Fi, and allow port 8000 through the firewall. |

Detailed docs: [backend/README.md](backend/README.md) · [frontend/mobile/README.md](frontend/mobile/README.md) ·
[park-track/README.md](park-track/README.md)
