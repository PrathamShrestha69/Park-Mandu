"""Decides whether a tracked vehicle is PARKED or NOT_PARKED.

Standing still for a while is not enough: a car in a traffic jam or at a red light also stands still.
What separates a parked vehicle is what happens *around* it while it stands:

  * other vehicles drive past it (the road keeps flowing, this vehicle does not take part), or
  * it stands for a long time with no queue around it at all.

A vehicle that only ever stands inside a queue of other standing vehicles stays NOT_PARKED, however
long the jam lasts. When the queue releases and the vehicles around it drive off while it stays, those
departing vehicles count as passing traffic, so a vehicle parked behind a jam is still recognised.

A vehicle is reported PARKED as soon as it has stood ``min_dwell_seconds`` (30 s), and a parked vehicle
has to drive off for ``depart_seconds`` (and actually move away from where it stood) before it is reported as gone,
so a flicker in the tracker never flips the state.

This module has no OpenCV or model dependency. It receives what the existing tracker already knows
about each vehicle (box, how long it has stood still) and keeps its own memory per vehicle.
"""

from __future__ import annotations

import itertools
import math
import secrets
from dataclasses import dataclass, field
from typing import Literal

PARKED = "PARKED"
NOT_PARKED = "NOT_PARKED"
ParkingState = Literal["PARKED", "NOT_PARKED"]

Box = tuple[float, float, float, float]


@dataclass(frozen=True)
class ParkingRules:
    # Standing still at least this long before a vehicle can be considered parked at all.
    min_dwell_seconds: float = 30.0
    # Different vehicles that must drive past while it stands (the road flows, this vehicle does not).
    min_passers: int = 2
    # With no queue around it, standing this long on its own is parking.
    isolated_dwell_seconds: float = 30.0
    # A neighbour counts as having passed once it travelled this many of the vehicle's own box sizes.
    pass_distance: float = 1.0
    # Neighbours are vehicles whose centre is within this many box sizes of the vehicle.
    proximity: float = 3.0
    # Share of standing neighbours (with nobody moving nearby) that makes the vehicle part of a queue.
    queue_share: float = 0.6
    # A parked vehicle must move for this long, and away from where it stood, before it is no longer parked.
    depart_seconds: float = 4.0
    depart_distance: float = 0.5
    # A parked vehicle that disappears (hidden behind a bus) keeps its state this long before it has left.
    lost_grace_seconds: float = 20.0
    # A new track this close (IoU) to a recently lost parked vehicle is that same vehicle.
    same_vehicle_iou: float = 0.5
    # Vehicles that are not parked are forgotten this long after the tracker last saw them.
    forget_seconds: float = 3.0


@dataclass(frozen=True)
class Observation:
    """One vehicle in one frame, as the existing tracker sees it."""

    track_id: int
    box: Box  # fractions of the frame: x1, y1, x2, y2
    still_seconds: float  # 0 while the vehicle is moving
    vehicle_type: str
    confidence: float


@dataclass(frozen=True)
class Transition:
    """A confirmed change of parking state, to be sent to the backend."""

    vehicle_key: str
    track_id: int
    state: ParkingState
    seq: int
    at: float  # tracker time of the change
    box: Box
    vehicle_type: str
    confidence: float
    stationary_seconds: float
    reason: str
    passers: int
    queue_seconds: float


@dataclass
class VehicleMemory:
    key: str
    track_id: int
    box: Box
    vehicle_type: str
    confidence: float
    last_seen: float
    last_step: float
    state: ParkingState = NOT_PARKED
    seq: int = 0
    dwell_start: float | None = None
    # Neighbours seen moving near it during this stand: track id -> centre where first seen moving nearby.
    passer_origin: dict[int, tuple[float, float]] = field(default_factory=dict)
    passers: set[int] = field(default_factory=set)
    queue_seconds: float = 0.0
    moving_since: float | None = None
    parked_box: Box | None = None
    reason: str = ""

    def dwell(self, now: float) -> float:
        return now - self.dwell_start if self.dwell_start is not None else 0.0

    def reset_stand(self) -> None:
        self.dwell_start = None
        self.passer_origin.clear()
        self.passers.clear()
        self.queue_seconds = 0.0


def iou(a: Box, b: Box) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def centre(box: Box) -> tuple[float, float]:
    return (box[0] + box[2]) / 2, (box[1] + box[3]) / 2


def size(box: Box) -> float:
    return max(box[2] - box[0], box[3] - box[1], 1e-6)


class ParkingClassifier:
    """Keeps one memory per vehicle and reports confirmed PARKED / NOT_PARKED changes."""

    def __init__(self, rules: ParkingRules | None = None, session: str | None = None) -> None:
        self.rules = rules or ParkingRules()
        # Keys stay unique across restarts of the bridge, so the backend never confuses two vehicles.
        self.session = session or secrets.token_hex(4)
        self._counter = itertools.count(1)
        self.vehicles: dict[int, VehicleMemory] = {}  # by current track id
        self.lost_parked: list[VehicleMemory] = []  # parked vehicles the tracker lost sight of

    # ------------------------------------------------------------------ public

    def reset(self) -> None:
        """The video restarted or the camera reconnected: nothing seen before is trustworthy."""
        self.vehicles.clear()
        self.lost_parked.clear()

    def state_of(self, track_id: int) -> ParkingState:
        memory = self.vehicles.get(track_id)
        return memory.state if memory else NOT_PARKED

    def parked(self) -> list[VehicleMemory]:
        """Every vehicle currently PARKED, including ones briefly hidden from view."""
        return [m for m in self.vehicles.values() if m.state == PARKED] + list(self.lost_parked)

    def step(self, now: float, observations: list[Observation]) -> list[Transition]:
        transitions: list[Transition] = []
        current: list[VehicleMemory] = []
        elapsed: dict[int, float] = {}

        for obs in observations:
            memory = self.vehicles.get(obs.track_id) or self._adopt(obs, now)
            # Seconds since this vehicle's previous frame; long gaps (frame drops) are not evidence.
            elapsed[obs.track_id] = min(max(now - memory.last_step, 0.0), 1.0)
            memory.last_step = now
            memory.last_seen = now
            memory.box = obs.box
            memory.vehicle_type = obs.vehicle_type
            memory.confidence = obs.confidence
            if obs.still_seconds > 0:
                memory.moving_since = None
                if memory.dwell_start is None:
                    memory.dwell_start = now - obs.still_seconds
            else:
                if memory.moving_since is None:
                    memory.moving_since = now
                if memory.state == NOT_PARKED:
                    memory.reset_stand()
            current.append(memory)

        moving_now = {m.track_id for m in current if m.moving_since is not None}
        for memory in current:
            if memory.dwell_start is not None and memory.moving_since is None:
                self._gather_evidence(memory, current, moving_now, elapsed[memory.track_id])
            change = self._decide(memory, now)
            if change:
                transitions.append(change)

        transitions.extend(self._handle_lost(now, {m.track_id for m in current}))
        return transitions

    # ------------------------------------------------------------------ internals

    def _new_key(self) -> str:
        return f"{self.session}-{next(self._counter)}"

    def _adopt(self, obs: Observation, now: float) -> VehicleMemory:
        """A new track: either a parked vehicle the tracker lost and found again, or a new vehicle."""
        for lost in self.lost_parked:
            if iou(lost.box, obs.box) >= self.rules.same_vehicle_iou:
                self.lost_parked.remove(lost)
                lost.track_id = obs.track_id
                lost.last_step = now
                self.vehicles[obs.track_id] = lost
                return lost
        memory = VehicleMemory(
            key=self._new_key(),
            track_id=obs.track_id,
            box=obs.box,
            vehicle_type=obs.vehicle_type,
            confidence=obs.confidence,
            last_seen=now,
            last_step=now,
        )
        self.vehicles[obs.track_id] = memory
        return memory

    def _gather_evidence(
        self, memory: VehicleMemory, current: list[VehicleMemory], moving_now: set[int], dt: float
    ) -> None:
        rules = self.rules
        cx, cy = centre(memory.box)
        reach = rules.proximity * size(memory.box)
        standing_near = moving_near = 0
        for other in current:
            if other is memory:
                continue
            ox, oy = centre(other.box)
            if math.hypot(ox - cx, oy - cy) > reach:
                continue
            if other.track_id in moving_now:
                moving_near += 1
                origin = memory.passer_origin.setdefault(other.track_id, (ox, oy))
                # It counts once it has really travelled, not when it just creeps forward in a queue.
                if math.hypot(ox - origin[0], oy - origin[1]) >= rules.pass_distance * size(memory.box):
                    memory.passers.add(other.track_id)
            else:
                standing_near += 1
        if moving_near == 0 and standing_near > 0 and standing_near / (standing_near + moving_near) >= rules.queue_share:
            memory.queue_seconds += dt

    def _parked_reason(self, memory: VehicleMemory, now: float) -> str | None:
        rules = self.rules
        dwell = memory.dwell(now)
        if memory.dwell_start is None or memory.moving_since is not None or dwell < rules.min_dwell_seconds:
            return None
        if len(memory.passers) >= rules.min_passers:
            return "traffic_passing"
        if dwell >= rules.isolated_dwell_seconds and memory.queue_seconds < 0.5 * dwell:
            return "standing_alone"
        return None  # standing inside a queue: a traffic stop, not parking

    def _departed(self, memory: VehicleMemory, now: float) -> bool:
        rules = self.rules
        if memory.moving_since is None or now - memory.moving_since < rules.depart_seconds:
            return False
        anchor = memory.parked_box or memory.box
        ax, ay = centre(anchor)
        bx, by = centre(memory.box)
        return math.hypot(bx - ax, by - ay) >= rules.depart_distance * size(anchor)

    def _decide(self, memory: VehicleMemory, now: float) -> Transition | None:
        rules = self.rules
        if memory.state == NOT_PARKED:
            reason = self._parked_reason(memory, now)
            if reason is None:
                return None
            # Standing still for min_dwell_seconds is the confirmation: no extra wait before reporting.
            memory.parked_box = memory.box
            return self._change(memory, PARKED, now, reason)
        if self._departed(memory, now):
            memory.reset_stand()
            memory.parked_box = None
            return self._change(memory, NOT_PARKED, now, "drove_off")
        return None

    def _change(self, memory: VehicleMemory, state: ParkingState, now: float, reason: str) -> Transition:
        memory.state = state
        memory.seq += 1
        memory.reason = reason
        return self.transition(memory, now)

    def transition(self, memory: VehicleMemory, now: float) -> Transition:
        return Transition(
            vehicle_key=memory.key,
            track_id=memory.track_id,
            state=memory.state,
            seq=memory.seq,
            at=now,
            box=memory.box,
            vehicle_type=memory.vehicle_type,
            confidence=memory.confidence,
            stationary_seconds=round(memory.dwell(now), 1),
            reason=memory.reason,
            passers=len(memory.passers),
            queue_seconds=round(memory.queue_seconds, 1),
        )

    def _handle_lost(self, now: float, seen: set[int]) -> list[Transition]:
        rules = self.rules
        transitions: list[Transition] = []
        for track_id in [t for t in self.vehicles if t not in seen]:
            memory = self.vehicles[track_id]
            if memory.state == PARKED:
                del self.vehicles[track_id]
                self.lost_parked.append(memory)
            elif now - memory.last_seen > rules.forget_seconds:
                del self.vehicles[track_id]
        for memory in list(self.lost_parked):
            if now - memory.last_seen > rules.lost_grace_seconds:
                self.lost_parked.remove(memory)
                memory.state = NOT_PARKED
                memory.seq += 1
                memory.reason = "left_view"
                transitions.append(self.transition(memory, now))
        return transitions
