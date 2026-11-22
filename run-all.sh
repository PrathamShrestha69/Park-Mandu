#!/usr/bin/env bash
# Starts every Park Mandu part in one go: backend (Docker), web app, mobile app, AI detector.
# Run from Git Bash / macOS / Linux:   ./run-all.sh
#
# Options (environment variables):
#   BUILD=1                 rebuild backend images (docker compose up --build)
#   SKIP="web mobile"       parts to skip: backend web mobile detector
#   SOURCE=video2.mp4       video file / camera index / http://<PHONE-IP>:8080/video for the detector
#   CAMERA_CODE=CAM-014     camera the detector reports for
#   PARK_SECONDS=10         seconds standing still before a vehicle counts as parked
#
# Press Ctrl+C to stop everything (the Docker backend is stopped too).

set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

SKIP="${SKIP:-}"
SOURCE="${SOURCE:-video2.mp4}"
CAMERA_CODE="${CAMERA_CODE:-CAM-014}"
PARK_SECONDS="${PARK_SECONDS:-10}"

skip() { [[ " $SKIP " == *" $1 "* ]]; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing required tool: $1" >&2; exit 1; }; }

# Prefix every line of a part's output so the combined log stays readable.
run() {
  local name="$1" dir="$2"; shift 2
  ( cd "$dir" && "$@" 2>&1 | sed -u "s/^/[$name] /" ) &
  PIDS+=($!)
}

PIDS=()
BACKEND_UP=0

cleanup() {
  trap - INT TERM EXIT
  echo; echo "Stopping everything..."
  ((BACKEND_UP)) && (cd backend && docker compose stop >/dev/null 2>&1)
  for pid in "${PIDS[@]}"; do
    pkill -P "$pid" 2>/dev/null
    kill "$pid" 2>/dev/null
  done
  wait 2>/dev/null
  exit 0
}
trap cleanup INT TERM EXIT

# ---- Backend (Postgres, Redis, API, worker) -------------------------------------------------
if ! skip backend; then
  need docker
  [[ -f backend/.env ]] || { cp backend/.env.example backend/.env; echo "Created backend/.env - replace the 'change-me' secrets."; }
  BACKEND_UP=1
  if [[ "${BUILD:-0}" == 1 ]]; then run backend backend docker compose up --build
  else run backend backend docker compose up; fi
fi

# ---- Web app (http://localhost:3000) --------------------------------------------------------
if ! skip web; then
  need npm
  [[ -f frontend/web/.env.local ]] || cp frontend/web/.env.example frontend/web/.env.local 2>/dev/null
  [[ -d frontend/web/node_modules ]] || (cd frontend/web && npm install)
  run web frontend/web npm run dev
fi

# ---- Mobile app (Expo; scan the QR code) ----------------------------------------------------
if ! skip mobile; then
  need npm
  [[ -d frontend/mobile/node_modules ]] || (cd frontend/mobile && npm install)
  run mobile frontend/mobile npx expo start
fi

# ---- AI detector (live video on http://localhost:8090) --------------------------------------
if ! skip detector; then
  PY=""
  for p in vehicle_detection/.venv/Scripts/python vehicle_detection/.venv/bin/python; do
    [[ -x "$p" ]] && PY="$ROOT/$p" && break
  done
  if [[ -z "$PY" ]]; then
    echo "Detector skipped: no vehicle_detection/.venv found. Create it with:" >&2
    echo "  python -m venv vehicle_detection/.venv && vehicle_detection/.venv/Scripts/python -m pip install -r vehicle_detection/requirements.txt" >&2
  else
    # The detector needs the backend API; wait for it to answer first.
    (
      if ! skip backend; then
        until curl -fsS http://localhost:8000/health >/dev/null 2>&1; do sleep 3; done
      fi
      cd "$ROOT" && exec "$PY" camera-bridge/bridge.py --source "$SOURCE" \
        --camera-code "$CAMERA_CODE" --park-seconds "$PARK_SECONDS" 2>&1 | sed -u "s/^/[detector] /"
    ) &
    PIDS+=($!)
  fi
fi

echo
echo "Starting... Backend http://localhost:8000/docs | Web http://localhost:3000 | Detector http://localhost:8090/stream.mjpg"
echo "Press Ctrl+C to stop everything."
wait
