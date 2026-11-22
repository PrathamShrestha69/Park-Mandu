"""Scenario tests for the Parking Availability Bridge. Pure Python, no model or camera needed.

Run from the project folder:  backend/.venv/Scripts/python -m pytest camera-bridge/tests -q
"""

from __future__ import annotations

import sys
from collections.abc import Callable
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from parking_availability import (  # noqa: E402
    NOT_PARKED,
    PARKED,
    Observation,
    ParkingAvailabilityBridge,
    ParkingClassifier,
    ParkingRules,
    ParkingStatusClient,
    update_payload,
)

FPS = 5
W = 0.06  # box width as a fraction of the frame
H = 0.05

Position = Callable[[float], tuple[float, float] | None]  # time -> centre, or None when not in view


class FakeTracker:
    """Plays scripted vehicles like the real tracker reports them: box + seconds standing still."""

    def __init__(self, vehicles: dict[int, Position]) -> None:
        self.vehicles = vehicles
        self.still_since: dict[int, float | None] = {}
        self.last: dict[int, tuple[float, float]] = {}

    def frame(self, t: float) -> list[Observation]:
        out = []
        for track_id, position in self.vehicles.items():
            p = position(t)
            if p is None:
                self.still_since.pop(track_id, None)
                self.last.pop(track_id, None)
                continue
            prev = self.last.get(track_id)
            moved = prev is None or abs(p[0] - prev[0]) + abs(p[1] - prev[1]) > 1e-4
            self.last[track_id] = p
            if moved:
                self.still_since[track_id] = None
            elif self.still_since.get(track_id) is None:
                self.still_since[track_id] = t
            since = self.still_since[track_id]
            # The real tracker only calls a vehicle still after watching it for ~1 s.
            still = t - since + 1.0 if since is not None else 0.0
            box = (p[0] - W / 2, p[1] - H / 2, p[0] + W / 2, p[1] + H / 2)
            out.append(Observation(track_id, box, still, "car", 0.9))
        return out


def run(vehicles: dict[int, Position], seconds: float, rules: ParkingRules | None = None):
    classifier = ParkingClassifier(rules or ParkingRules(), session="test")
    tracker = FakeTracker(vehicles)
    changes = []
    states: dict[float, dict[int, str]] = {}
    for i in range(int(seconds * FPS)):
        t = i / FPS
        changes.extend(classifier.step(t, tracker.frame(t)))
        states[t] = {tid: classifier.state_of(tid) for tid in vehicles}
    return classifier, changes, states


def driving(lane_y: float, start: float, speed: float = 0.04, enter: float = 0.0) -> Position:
    """A vehicle driving left to right through the frame, entering at `enter` seconds."""

    def pos(t: float) -> tuple[float, float] | None:
        if t < enter:
            return None
        x = start + speed * (t - enter)
        return (x, lane_y) if x < 1.0 else None

    return pos


def standing(x: float, y: float, until: float | None = None, then_speed: float = 0.05) -> Position:
    def pos(t: float) -> tuple[float, float] | None:
        if until is None or t < until:
            return (x, y)
        nx = x + then_speed * (t - until)
        return (nx, y) if nx < 1.0 else None

    return pos


def traffic_stream(lane_y: float, every: float, count: int, first_id: int = 100) -> dict[int, Position]:
    return {first_id + i: driving(lane_y, 0.0, 0.05, enter=i * every) for i in range(count)}


# --------------------------------------------------------------------------- scenarios


def test_vehicle_moving_normally_is_never_parked() -> None:
    _, changes, _ = run({1: driving(0.5, 0.0, 0.01)}, 90)
    assert changes == []


def test_vehicle_stopped_in_a_traffic_jam_is_not_parked() -> None:
    # Five cars queue bumper to bumper for three minutes; nobody passes anyone.
    queue = {i: standing(0.2 + i * 0.07, 0.5) for i in range(1, 6)}
    _, changes, _ = run(queue, 180)
    assert changes == [], "a queue is a traffic stop, not parking"


def test_genuinely_parked_vehicle_with_traffic_passing() -> None:
    vehicles = {1: standing(0.5, 0.45), **traffic_stream(0.52, every=6, count=12)}
    classifier, changes, states = run(vehicles, 60)
    parked = [c for c in changes if c.track_id == 1]
    assert [c.state for c in parked] == [PARKED]
    assert parked[0].reason == "traffic_passing"
    assert parked[0].passers >= 2
    # Not before the minimum standing time plus confirmation.
    first = min(t for t, s in states.items() if s[1] == PARKED)
    assert first >= ParkingRules().min_dwell_seconds
    # The passing cars themselves are never parked.
    assert all(c.track_id == 1 for c in changes)


def test_thirty_seconds_still_alone_is_not_enough() -> None:
    # Standing 45 s with nothing around: could be a red light, so it is not parked yet.
    _, changes, states = run({1: standing(0.5, 0.5)}, 45)
    assert changes == []
    # Standing alone well past the isolated threshold is parking.
    _, changes, _ = run({1: standing(0.5, 0.5)}, 150)
    assert [c.state for c in changes] == [PARKED]
    assert changes[0].reason == "standing_alone"


def test_long_jam_alone_never_becomes_parked() -> None:
    queue = {i: standing(0.2 + i * 0.07, 0.5) for i in range(1, 4)}
    _, changes, _ = run(queue, 300)
    assert changes == [], "queue time keeps the isolated rule from firing during a long jam"


def test_jam_releases_while_parked_vehicle_stays() -> None:
    # Cars 2-4 are stuck in a queue next to car 1 for 40 s, then drive off; car 1 never moves.
    vehicles: dict[int, Position] = {1: standing(0.5, 0.5)}
    for i, x in enumerate((0.42, 0.56, 0.62), start=2):
        vehicles[i] = standing(x, 0.52, until=40)
    _, changes, states = run(vehicles, 80)
    assert all(states[t][1] == NOT_PARKED for t in states if t < 40), "not parked while it is part of the jam"
    parked = [c for c in changes if c.track_id == 1]
    assert [c.state for c in parked] == [PARKED]
    assert all(c.track_id == 1 for c in changes), "the cars that drove off were never parked"


def test_parked_vehicle_drives_off() -> None:
    vehicles = {1: standing(0.3, 0.45, until=60), **traffic_stream(0.52, every=5, count=14)}
    _, changes, _ = run(vehicles, 80)
    assert [(c.state, c.seq) for c in changes] == [(PARKED, 1), (NOT_PARKED, 2)]
    assert changes[-1].reason == "drove_off"


def test_hidden_parked_vehicle_keeps_its_identity() -> None:
    # The tracker loses car 1 behind a bus for 8 s and finds it again as track 9: same vehicle.
    def hidden(t: float):
        return None if 50 <= t < 58 else (0.5, 0.45)

    vehicles = {1: lambda t: hidden(t) if t < 50 else None, 9: lambda t: hidden(t) if t >= 58 else None}
    vehicles.update(traffic_stream(0.52, every=6, count=12))
    classifier, changes, _ = run(vehicles, 75)
    assert [c.state for c in changes] == [PARKED], "no NOT_PARKED/PARKED flap and no second report"
    assert classifier.state_of(9) == PARKED
    assert classifier.vehicles[9].key == changes[0].vehicle_key


def test_vehicle_that_leaves_view_is_released_after_grace() -> None:
    vehicles = {1: lambda t: (0.5, 0.45) if t < 55 else None, **traffic_stream(0.52, every=6, count=12)}
    _, changes, _ = run(vehicles, 80)
    assert [c.state for c in changes] == [PARKED, NOT_PARKED]
    assert changes[-1].reason == "left_view"


def test_brief_tracker_jitter_does_not_unpark() -> None:
    def jitter(t: float):
        return (0.5 + (0.004 if 50 <= t < 51 else 0.0), 0.45)

    vehicles = {1: jitter, **traffic_stream(0.52, every=6, count=12)}
    _, changes, _ = run(vehicles, 70)
    assert [c.state for c in changes] == [PARKED]


# --------------------------------------------------------------------------- delivery


def test_duplicate_and_stale_updates_are_coalesced() -> None:
    sent: list[dict] = []
    client = ParkingStatusClient("http://backend", "key", "CAM-1", "test", transport=lambda url, body: sent.append(body) or {})
    classifier = ParkingClassifier(session="t")
    bridge = ParkingAvailabilityBridge(classifier, client, log=lambda _: None)
    tracker = FakeTracker({1: standing(0.3, 0.45, until=60), **traffic_stream(0.52, every=5, count=14)})
    for i in range(80 * FPS):
        bridge.observe(i / FPS, tracker.frame(i / FPS), snapshot=lambda change: "photo")
    # Both changes were queued before anything was sent: only the newest survives for that vehicle.
    batch = client._take_batch()
    assert [(u["state"], u["seq"]) for u in batch] == [(NOT_PARKED, 2)]
    # An older change submitted late never replaces a newer one still waiting to be sent.
    # (Once sent, the backend's sequence check drops the older one.)
    client.submit(batch[0])
    client.submit({**batch[0], "state": PARKED, "seq": 1})
    assert client._pending[batch[0]["vehicle_key"]]["seq"] == 2


def test_failed_delivery_is_retried_and_keepalive_repeats_same_seq() -> None:
    calls: list[dict] = []

    def flaky(url: str, body: dict) -> dict:
        calls.append(body)
        if len(calls) == 1:
            raise OSError("network down")
        return {"applied": len(body["vehicles"]), "ignored": 0}

    client = ParkingStatusClient("http://backend", "key", "CAM-1", "b", transport=flaky, keepalive_seconds=0, log=lambda _: None)
    classifier = ParkingClassifier(session="t")
    tracker = FakeTracker({1: standing(0.5, 0.45), **traffic_stream(0.52, every=6, count=12)})
    for i in range(60 * FPS):
        for change in classifier.step(i / FPS, tracker.frame(i / FPS)):
            client.submit(update_payload(change, "photo"))
    first = client._take_batch()
    assert client.flush(first) is False  # network down: requeued
    second = client._take_batch()
    assert client.flush(second) is True
    assert second[0]["snapshot_base64"] == "photo" and second[0]["seq"] == 1
    keepalive = client._take_batch()
    assert keepalive and keepalive[0]["seq"] == 1 and "snapshot_base64" not in keepalive[0]


def test_camera_restart_releases_parked_vehicles() -> None:
    sent: list[dict] = []
    client = ParkingStatusClient("http://backend", "key", "CAM-1", "b", transport=lambda u, b: sent.append(b) or {})
    classifier = ParkingClassifier(session="t")
    bridge = ParkingAvailabilityBridge(classifier, client, log=lambda _: None)
    tracker = FakeTracker({1: standing(0.5, 0.45), **traffic_stream(0.52, every=6, count=12)})
    for i in range(60 * FPS):
        bridge.observe(i / FPS, tracker.frame(i / FPS))
    bridge.reset()
    batch = client._take_batch()
    assert [(u["state"], u["seq"], u["evidence"]["reason"]) for u in batch] == [(NOT_PARKED, 2, "camera_restarted")]
