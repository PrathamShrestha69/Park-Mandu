"""Delivers parking-state changes to the Park Mandu backend (POST /ingest/parking-status).

Delivery rules:
  * every change carries the vehicle key and a sequence number; the backend applies a change once and
    ignores repeats and anything older than what it already has, so resending is always safe,
  * changes waiting to be sent are coalesced per vehicle (only the newest matters),
  * parked vehicles are re-sent every ``keepalive_seconds``; the backend treats a vehicle it stops
    hearing about as no longer observed and never raises an alert for it,
  * network failures are retried with back-off; a rejected request (4xx) is logged and dropped.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

MAX_BATCH = 50  # backend limit per request


class ParkingStatusClient:
    def __init__(
        self,
        backend: str,
        api_key: str,
        camera_code: str,
        bridge_id: str,
        *,
        violation_type: str = "no_parking_zone",
        keepalive_seconds: float = 15.0,
        log: Callable[[str], None] = print,
        transport: Callable[[str, dict[str, Any]], dict[str, Any]] | None = None,
    ) -> None:
        self.url = f"{backend.rstrip('/')}/ingest/parking-status"
        self.api_key = api_key
        self.camera_code = camera_code
        self.bridge_id = bridge_id
        self.violation_type = violation_type
        self.keepalive_seconds = keepalive_seconds
        self.log = log
        self.transport = transport or self._post
        self._lock = threading.Condition()
        self._pending: dict[str, dict[str, Any]] = {}  # newest unsent update per vehicle key
        self._parked: dict[str, dict[str, Any]] = {}  # last sent update of every parked vehicle
        self._last_keepalive = 0.0
        self._stopped = False

    # ------------------------------------------------------------------ producer side (tracker thread)

    def submit(self, update: dict[str, Any]) -> None:
        """Queue a state change. Older unsent changes of the same vehicle are replaced."""
        with self._lock:
            key = update["vehicle_key"]
            queued = self._pending.get(key)
            if queued is None or update["seq"] >= queued["seq"]:
                # Keep a photo taken for an earlier, still unsent PARKED change of the same stand.
                if queued and "snapshot_base64" in queued and update["state"] == "PARKED":
                    update.setdefault("snapshot_base64", queued["snapshot_base64"])
                self._pending[key] = update
            self._lock.notify()

    def stop(self) -> None:
        with self._lock:
            self._stopped = True
            self._lock.notify()

    # ------------------------------------------------------------------ sender side (own thread)

    def run(self) -> None:
        backoff = 1.0
        while True:
            with self._lock:
                self._lock.wait_for(lambda: self._stopped or self._pending or self._keepalive_due(), timeout=1.0)
                if self._stopped:
                    return
                batch = self._take_batch()
            if not batch:
                continue
            if self.flush(batch):
                backoff = 1.0
            else:
                time.sleep(backoff)
                backoff = min(backoff * 2, 30.0)

    def _keepalive_due(self) -> bool:
        return bool(self._parked) and time.monotonic() - self._last_keepalive >= self.keepalive_seconds

    def _take_batch(self) -> list[dict[str, Any]]:
        batch = list(self._pending.values())[:MAX_BATCH]
        for update in batch:
            del self._pending[update["vehicle_key"]]
        if self._keepalive_due():
            self._last_keepalive = time.monotonic()
            sending = {u["vehicle_key"] for u in batch}
            for key, update in self._parked.items():
                if key not in sending and len(batch) < MAX_BATCH:
                    # A keepalive repeats the same seq, which the backend reads as "still parked".
                    batch.append({k: v for k, v in update.items() if k != "snapshot_base64"})
        return batch

    def flush(self, batch: list[dict[str, Any]]) -> bool:
        """Sends one batch. Returns False when it should be retried later."""
        body = {
            "camera_code": self.camera_code,
            "bridge_id": self.bridge_id,
            "violation_type": self.violation_type,
            "sent_at": datetime.now(UTC).isoformat(),
            "vehicles": batch,
        }
        try:
            answer = self.transport(self.url, body)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")[:300]
            if exc.code == 429 or exc.code >= 500:
                self.log(f"Parking status not accepted yet ({exc.code}); retrying.")
                self._requeue(batch)
                return False
            self.log(f"Parking status rejected ({exc.code}): {detail}")
            return True
        except OSError as exc:
            self.log(f"Backend not reachable for parking status ({exc}); retrying.")
            self._requeue(batch)
            return False
        with self._lock:
            for update in batch:
                if update["state"] == "PARKED":
                    self._parked[update["vehicle_key"]] = update
                else:
                    self._parked.pop(update["vehicle_key"], None)
        changed = [u for u in batch if u.get("snapshot_base64") is not None or u["state"] == "NOT_PARKED"]
        if changed and answer:
            self.log(
                f"Parking status delivered: {answer.get('applied', 0)} change(s), "
                f"{answer.get('ignored', 0)} repeat(s) ignored."
            )
        return True

    def _requeue(self, batch: list[dict[str, Any]]) -> None:
        with self._lock:
            for update in batch:
                queued = self._pending.get(update["vehicle_key"])
                if queued is None or queued["seq"] < update["seq"]:
                    self._pending[update["vehicle_key"]] = update

    def _post(self, url: str, body: dict[str, Any]) -> dict[str, Any]:
        request = urllib.request.Request(
            url,
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "X-API-Key": self.api_key},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=15) as response:  # noqa: S310 - backend URL from config
            raw = response.read()
        return json.loads(raw) if raw else {}
