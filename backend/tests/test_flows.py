"""End-to-end API flows against a running stack (docker compose up). Run: docker compose exec api pytest -q"""

import base64
import io
import os
import time
import uuid

import httpx
import pytest
from PIL import Image
from redis import Redis

from app.core.config import settings

BASE = os.environ.get("API_BASE_URL", "http://localhost:8000") + "/api/v1"
PASSWORD = "ParkMandu@2026"


def token_client(identifier: str) -> httpx.Client:
    client = httpx.Client(base_url=BASE, timeout=20, headers={"X-Client-Type": "mobile"})
    res = client.post("/auth/login", json={"identifier": identifier, "password": PASSWORD})
    assert res.status_code == 200, res.text
    client.headers["Authorization"] = f"Bearer {res.json()['tokens']['access_token']}"
    client.refresh_token = res.json()["tokens"]["refresh_token"]  # type: ignore[attr-defined]
    return client


@pytest.fixture(scope="module")
def landowner() -> httpx.Client:
    return token_client("sita.sharma@example.com")


@pytest.fixture(scope="module")
def admin() -> httpx.Client:
    return token_client("nabin.shrestha@parkmandu.test")


@pytest.fixture(scope="module")
def police() -> httpx.Client:
    return token_client("TP-2841")  # officers can sign in with their badge number


def png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 48), "#2b7de9").save(buf, "PNG")
    return buf.getvalue()


# --------------------------------------------------------------------------- auth


def test_browser_login_sets_httponly_cookies_and_enforces_csrf() -> None:
    with httpx.Client(base_url=BASE, timeout=20) as browser:
        res = browser.post("/auth/login", json={"identifier": "+9779841234567", "password": PASSWORD})
        assert res.status_code == 200
        assert res.json()["tokens"] is None  # browsers never see tokens
        set_cookie = res.headers.get_list("set-cookie")
        assert any(c.startswith("pm_access=") and "HttpOnly" in c for c in set_cookie)
        assert any(c.startswith("pm_csrf=") and "HttpOnly" not in c for c in set_cookie)

        assert browser.get("/auth/me").json()["full_name"] == "Sita Sharma"
        # Unsafe request without the CSRF header is refused…
        assert browser.post("/notifications/read-all").status_code == 403
        # …and accepted when the header echoes the cookie.
        ok = browser.post("/notifications/read-all", headers={"X-CSRF-Token": browser.cookies["pm_csrf"]})
        assert ok.status_code == 200


def test_wrong_password_is_generic() -> None:
    res = httpx.post(f"{BASE}/auth/login", json={"identifier": "nobody@example.com", "password": "x"})
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "invalid_credentials"


def test_refresh_rotates_and_detects_reuse() -> None:
    client = token_client("ramesh.adhikari@example.com")
    old = client.refresh_token  # type: ignore[attr-defined]
    rotated = client.post("/auth/refresh", json={"refresh_token": old})
    assert rotated.status_code == 200
    new = rotated.json()["tokens"]["refresh_token"]
    assert new != old
    # A parallel request racing with the same token inside the grace window gets the same successor.
    raced = client.post("/auth/refresh", json={"refresh_token": old})
    assert raced.status_code == 200 and raced.json()["tokens"]["refresh_token"] == new

    # After the grace window, replaying the old token revokes the whole session family.
    redis = Redis.from_url(settings.redis_url)
    redis.delete(*redis.keys("auth:grace:*"))
    assert client.post("/auth/refresh", json={"refresh_token": old}).status_code == 401
    assert client.post("/auth/refresh", json={"refresh_token": new}).status_code == 401


def test_logout_revokes_access_token() -> None:
    client = token_client("anjali.gurung@example.com")
    assert client.get("/auth/me").status_code == 200
    assert client.post("/auth/logout").status_code == 200
    res = client.get("/auth/me")
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "session_revoked"


def test_register_validates_fields() -> None:
    res = httpx.post(f"{BASE}/auth/register", json={"full_name": "A", "phone": "12", "password": "short"})
    assert res.status_code == 422
    fields = res.json()["error"]["fields"]
    assert {"full_name", "phone", "password"} <= fields.keys()


def test_otp_login_in_dev_mode() -> None:
    sent = httpx.post(f"{BASE}/auth/otp/request", json={"phone": "9851000002"})
    assert sent.status_code == 200
    code = sent.json()["dev_code"]
    assert code and len(code) == 6
    res = httpx.post(
        f"{BASE}/auth/otp/verify", json={"phone": "9851000002", "code": code}, headers={"X-Client-Type": "mobile"}
    )
    assert res.status_code == 200
    assert res.json()["user"]["role"] == "police"


# --------------------------------------------------------------------------- public parking


def test_parking_search_with_distance_filters_and_pagination() -> None:
    res = httpx.get(f"{BASE}/parkings", params={"lat": 27.7048, "lng": 85.3117, "radius_m": 3000, "size": 5})
    body = res.json()
    assert res.status_code == 200
    assert body["size"] == 5 and len(body["items"]) <= 5 and body["total"] >= len(body["items"])
    distances = [p["distance_m"] for p in body["items"]]
    assert distances == sorted(distances) and all(d <= 3000 for d in distances)

    free = httpx.get(f"{BASE}/parkings", params={"free_only": True}).json()["items"]
    assert free and all(p["pricing_mode"] == "free" for p in free)

    page2 = httpx.get(f"{BASE}/parkings", params={"size": 5, "page": 2, "sort": "name"}).json()
    page1 = httpx.get(f"{BASE}/parkings", params={"size": 5, "page": 1, "sort": "name"}).json()
    assert {p["id"] for p in page1["items"]}.isdisjoint({p["id"] for p in page2["items"]})

    assert httpx.get(f"{BASE}/parkings", params={"size": 500}).status_code == 422


def test_search_and_map_markers() -> None:
    hits = httpx.get(f"{BASE}/parkings", params={"q": "ratna"}).json()["items"]
    assert hits[0]["name"] == "Ratna Park Public Parking"
    detail = httpx.get(f"{BASE}/parkings/{hits[0]['id']}").json()
    assert detail["managed_by"] == "Kathmandu Metropolitan City"

    markers = httpx.get(f"{BASE}/parkings/map").json()
    tones = {m["tone"] for m in markers}
    assert {"blue", "gray"} <= tones  # government parking + pending applications


# --------------------------------------------------------------------------- landowner → admin


def test_full_application_lifecycle(landowner: httpx.Client, admin: httpx.Client) -> None:
    draft = landowner.post("/applications").json()
    app_id = draft["id"]
    assert draft["status"] == "draft" and "location" in draft["missing"]

    bad = landowner.put(
        f"/applications/{app_id}/location", json={"latitude": 40.7, "longitude": -74, "address": "New York"}
    )
    assert bad.status_code == 422

    assert (
        landowner.put(
            f"/applications/{app_id}/location",
            json={
                "latitude": 27.7001,
                "longitude": 85.3302,
                "address": "Thapagaun Marg 5, Kathmandu-10",
                "area": "Thapagaun",
            },
        ).status_code
        == 200
    )
    assert (
        landowner.put(
            f"/applications/{app_id}/property",
            json={
                "property_name": f"Test Lot {uuid.uuid4().hex[:6]}",
                "land_size_sqm": 500,
                "capacity": 15,
                "parking_type": "open_air",
                "opens_at": "07:00",
                "closes_at": "21:00",
                "available_days": "every_day",
                "pricing_mode": "hourly",
                "price_per_hour": "35",
            },
        ).status_code
        == 200
    )
    owner = landowner.put(
        f"/applications/{app_id}/owner",
        json={
            "owner_name": "Sita Sharma",
            "owner_phone": "9841234567",
            "government_id": "27-01-75-44321",
            "ownership_document_number": "KTM-WD10-2081-4432",
            "owner_confirmed": True,
        },
    ).json()
    assert owner["gov_id_masked"] == "•••• 4321"  # stored encrypted, only last 4 shown

    rejected = landowner.post(
        f"/applications/{app_id}/documents",
        data={"kind": "property_photo"},
        files={"file": ("notes.txt", b"hello world", "text/plain")},
    )
    assert rejected.status_code == 415

    for kind in ("ownership_document", "government_id", "property_photo"):
        res = landowner.post(
            f"/applications/{app_id}/documents",
            data={"kind": kind},
            files={"file": (f"{kind}.png", png_bytes(), "image/png")},
        )
        assert res.status_code == 201, res.text

    early = landowner.post(f"/applications/{app_id}/submit", json={"declaration_accepted": False})
    assert early.status_code == 422
    submitted = landowner.post(f"/applications/{app_id}/submit", json={"declaration_accepted": True}).json()
    assert submitted["status"] == "submitted" and submitted["reference"].startswith("PM-")
    assert (
        landowner.put(
            f"/applications/{app_id}/location", json={"latitude": 27.7, "longitude": 85.33, "address": "Somewhere 1"}
        ).status_code
        == 409
    )

    queue = admin.get("/admin/applications", params={"status": "pending", "q": submitted["reference"]}).json()
    assert queue["total"] == 1
    assert admin.post(f"/admin/applications/{app_id}/start-review").json()["status"] == "under_review"
    assert admin.post(f"/admin/applications/{app_id}/decision", json={"decision": "reject"}).status_code == 422
    approved = admin.post(f"/admin/applications/{app_id}/decision", json={"decision": "approve"}).json()
    assert approved["status"] == "approved" and approved["parking_location_id"]

    published = httpx.get(f"{BASE}/parkings/{approved['parking_location_id']}").json()
    assert published["category"] == "private" and published["marker_tone"] in ("green", "red")

    time.sleep(2)  # notifications are delivered by the Celery worker
    titles = [n["title"] for n in landowner.get("/notifications", params={"size": 10}).json()["items"]]
    assert "Your parking location has been approved." in titles

    doc_id = approved["documents"][0]["id"]
    assert admin.get(f"/files/documents/{doc_id}").status_code == 200
    stranger = token_client("bikash.thapa@example.com")
    assert stranger.get(f"/files/documents/{doc_id}").status_code == 404
    assert stranger.get(f"/applications/{app_id}").status_code == 404


def test_role_boundaries(landowner: httpx.Client, police: httpx.Client) -> None:
    assert landowner.get("/admin/stats").status_code == 403
    assert landowner.get("/alerts").status_code == 403
    assert police.get("/admin/users").status_code == 403


# --------------------------------------------------------------------------- police


def test_alert_to_incident_to_resolution(police: httpx.Client) -> None:
    dashboard = police.get("/police/dashboard").json()
    assert dashboard["officer"]["badge_number"] == "TP-2841"
    assert dashboard["cameras"]["total"] == 22

    active = police.get("/alerts", params={"status": "active", "sort": "severity", "size": 50}).json()
    assert active["items"], "seed data should include active alerts"
    alert = active["items"][0]

    incident = police.post(f"/alerts/{alert['id']}/handle").json()
    assert incident["status"] == "in_progress" and incident["code"].startswith("INC-")
    # A second officer cannot claim the same alert.
    other = token_client("sunita.rai@parkmandu.test")
    assert other.post(f"/alerts/{alert['id']}/handle").status_code == 409

    noted = police.post(f"/incidents/{incident['id']}/notes", json={"body": "Tow truck requested."}).json()
    assert noted["notes"][-1]["body"] == "Tow truck requested."
    resolved = police.post(f"/incidents/{incident['id']}/resolve", json={"resolution": "Vehicle towed."}).json()
    assert resolved["status"] == "resolved" and resolved["alert"]["status"] == "resolved"


def test_ingest_requires_api_key_and_queues(police: httpx.Client) -> None:
    payload = {
        "camera_code": "CAM-014",
        "violation_type": "no_parking_zone",
        "vehicle_type": "Car",
        "confidence": 0.93,
        "plate_number": f"Ba 9 Cha {uuid.uuid4().int % 9000 + 1000}",
    }
    assert httpx.post(f"{BASE}/ingest/detections", json=payload, headers={"X-API-Key": "wrong"}).status_code == 401
    accepted = httpx.post(
        f"{BASE}/ingest/detections", json=payload, headers={"X-API-Key": os.environ["INGEST_API_KEY"]}
    )
    assert accepted.status_code == 202
    time.sleep(2)
    found = police.get("/alerts", params={"q": payload["plate_number"]}).json()
    assert found["total"] == 1


def test_admin_stats_and_map(admin: httpx.Client) -> None:
    stats = admin.get("/admin/stats").json()
    assert stats["overview"]["cameras_total"] == 22
    assert len(stats["charts"]["applications_over_time"]) == 6
    assert len(stats["charts"]["cctv_activity"]) == 7
    layers = admin.get("/admin/map", params=[("layers", "cameras")]).json()
    assert {m["kind"] for m in layers["markers"]} == {"camera"}
    users = admin.get("/admin/users", params={"role": "police"}).json()
    assert users["total"] == 3


def test_ai_detector_heartbeat_registers_camera_and_snapshot_is_served(police: httpx.Client) -> None:
    key = {"X-API-Key": os.environ["INGEST_API_KEY"]}
    code = f"PH-{uuid.uuid4().hex[:6].upper()}"
    beat = {
        "camera_code": code,
        "name": "Phone camera test",
        "latitude": 27.7,
        "longitude": 85.31,
        "stream_url": "http://192.168.1.50:8090",
    }
    assert httpx.post(f"{BASE}/ingest/heartbeat", json=beat, headers={"X-API-Key": "wrong"}).status_code == 401
    first = httpx.post(f"{BASE}/ingest/heartbeat", json=beat, headers=key)
    assert first.status_code == 200 and first.json()["created"] is True
    again = httpx.post(f"{BASE}/ingest/heartbeat", json={"camera_code": code}, headers=key).json()
    assert again["created"] is False and again["camera_id"] == first.json()["camera_id"]
    camera = police.get(f"/cameras/{again['camera_id']}").json()
    assert camera["status"] == "live" and camera["stream_url"] == beat["stream_url"]

    # Smallest valid JPEG header is enough for content sniffing.
    jpeg = bytes.fromhex("ffd8ffe000104a46494600010100000100010000ffd9")
    plate = f"Ba 1 Pa {uuid.uuid4().int % 9000 + 1000}"
    detection = {
        "camera_code": code,
        "violation_type": "no_parking_zone",
        "vehicle_type": "car",
        "confidence": 0.9,
        "plate_number": plate,
        "snapshot_base64": base64.b64encode(jpeg).decode(),
    }
    assert httpx.post(f"{BASE}/ingest/detections", json=detection, headers=key).status_code == 202
    time.sleep(2)
    alert = police.get("/alerts", params={"q": plate}).json()["items"][0]
    assert alert["has_snapshot"] is True
    image = police.get(f"/files/alerts/{alert['id']}/snapshot")
    assert image.status_code == 200 and image.headers["content-type"] == "image/jpeg"
