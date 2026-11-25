"""Parking Availability Bridge: connects the existing AI vehicle tracker to the Park Mandu backend.

The tracker (camera-bridge/bridge.py) keeps doing what it always did: detect vehicles, follow them with
ByteTrack and measure how long each one has stood still. This package sits between it and the backend:

    tracker observations ──▶ ParkingClassifier ──▶ PARKED / NOT_PARKED changes ──▶ ParkingStatusClient ──▶ backend

It only ever reports two states, PARKED and NOT_PARKED, and only once a change is confirmed (see
classifier.py for how traffic stops are told apart from parking). Whether a PARKED vehicle becomes an
illegal-parking alert is decided by the backend, which also checks the camera's traffic status.
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from datetime import UTC, datetime

from .classifier import (
    NOT_PARKED,
    PARKED,
    Observation,
    ParkingClassifier,
    ParkingRules,
    ParkingState,
    Transition,
)
from .client import ParkingStatusClient

__all__ = [
    "NOT_PARKED",
    "PARKED",
    "Observation",
    "ParkingAvailabilityBridge",
    "ParkingClassifier",
    "ParkingRules",
    "ParkingState",
    "ParkingStatusClient",
    "Transition",
    "update_payload",
]


def update_payload(change: Transition, snapshot_base64: str | None = None) -> dict:
    """The JSON the backend expects for one vehicle (see ParkingStatusUpdate in the backend)."""
    payload = {
        "vehicle_key": change.vehicle_key,
        "track_id": change.track_id,
        "state": change.state,
        "seq": change.seq,
        "changed_at": datetime.now(UTC).isoformat(),
        "vehicle_type": change.vehicle_type.replace("_", " "),
        "confidence": round(min(max(change.confidence, 0.0), 1.0), 3),
        "box": [round(min(max(v, 0.0), 1.0), 4) for v in change.box],
        "stationary_seconds": max(change.stationary_seconds, 0.0),
        "evidence": {"reason": change.reason, "passers": change.passers, "queue_seconds": change.queue_seconds},
    }
    if snapshot_base64:
        payload["snapshot_base64"] = snapshot_base64
    return payload


class ParkingAvailabilityBridge:
    """Feeds tracker output through the classifier and hands confirmed changes to the backend client."""

    def __init__(
        self,
        classifier: ParkingClassifier,
        client: ParkingStatusClient | None,
        *,
        log: Callable[[str], None] = print,
    ) -> None:
        self.classifier = classifier
        self.client = client
        self.log = log
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self.client and self._thread is None:
            self._thread = threading.Thread(target=self.client.run, name="parking-status", daemon=True)
            self._thread.start()

    def reset(self) -> None:
        """Camera reconnected or the video restarted: vehicles are forgotten, parked ones are released."""
        for memory in self.classifier.parked():
            memory.state = NOT_PARKED
            memory.seq += 1
            memory.reason = "camera_restarted"
            if self.client:
                self.client.submit(update_payload(self.classifier.transition(memory, memory.last_seen)))
        self.classifier.reset()

    def state_of(self, track_id: int) -> ParkingState:
        return self.classifier.state_of(track_id)

    def parked_seconds(self, track_id: int, now: float) -> float:
        """How long a PARKED vehicle has been standing; 0 for a vehicle that is not PARKED."""
        memory = self.classifier.vehicles.get(track_id)
        return memory.dwell(now) if memory and memory.state == PARKED else 0.0

    def observe(
        self,
        now: float,
        observations: list[Observation],
        snapshot: Callable[[Transition], str | None] | None = None,
    ) -> list[Transition]:
        changes = self.classifier.step(now, observations)
        for change in changes:
            photo = snapshot(change) if snapshot and change.state == PARKED else None
            self.log(
                f"Vehicle #{change.track_id} ({change.vehicle_type}) {change.state} "
                f"[{change.reason}; {change.passers} passed it, stood {change.stationary_seconds:.0f}s]."
            )
            if self.client:
                self.client.submit(update_payload(change, photo))
        return changes
