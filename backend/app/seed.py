"""Idempotent demo data for Kathmandu Valley. Run with: python -m app.seed"""

import logging
import random
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from pathlib import Path

from PIL import Image, ImageDraw
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import encrypt_field, hash_password
from app.db.session import SyncSessionLocal
from app.models import (
    ApplicationDocument,
    ApplicationEvent,
    Camera,
    Incident,
    IncidentNote,
    Notification,
    ParkingApplication,
    ParkingLocation,
    User,
)
from app.models.enums import (
    AlertStatus,
    ApplicationEventKind,
    ApplicationStatus,
    AvailableDays,
    CameraStatus,
    DocumentKind,
    DocumentStatus,
    IncidentStatus,
    NotificationKind,
    NotificationTone,
    ParkingCategory,
    ParkingStatus,
    ParkingType,
    PricingMode,
    TrafficLevel,
    UserRole,
    ViolationType,
)
from app.services import storage
from app.services.alerts_sync import COLORS, DIRECTIONS, VEHICLES, create_alert, random_plate

log = logging.getLogger("seed")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

DEMO_PASSWORD = "ParkMandu@2026"
NOW = datetime.now(UTC)
random.seed(2081)


def ago(**kwargs: float) -> datetime:
    return NOW - timedelta(**kwargs)


# --------------------------------------------------------------------------- users

USERS = [
    # (full_name, email, phone, role, designation, badge, unit, verified, on_duty, registered_days_ago)
    (
        "Sita Sharma",
        "sita.sharma@example.com",
        "+9779841234567",
        UserRole.PUBLIC,
        "Verified landowner",
        None,
        None,
        True,
        False,
        420,
    ),
    (
        "Ramesh Adhikari",
        "ramesh.adhikari@example.com",
        "+9779803456781",
        UserRole.PUBLIC,
        "Landowner",
        None,
        None,
        True,
        False,
        210,
    ),
    (
        "Anjali Gurung",
        "anjali.gurung@example.com",
        "+9779812345670",
        UserRole.PUBLIC,
        "Landowner",
        None,
        None,
        True,
        False,
        160,
    ),
    (
        "Bikash Thapa",
        "bikash.thapa@example.com",
        "+9779860011223",
        UserRole.PUBLIC,
        "Landowner",
        None,
        None,
        False,
        False,
        95,
    ),
    (
        "Prakash Maharjan",
        "prakash.maharjan@example.com",
        "+9779841987654",
        UserRole.PUBLIC,
        "Landowner",
        None,
        None,
        True,
        False,
        300,
    ),
    (
        "Manisha Karki",
        "manisha.karki@example.com",
        "+9779851122334",
        UserRole.PUBLIC,
        "Landowner",
        None,
        None,
        True,
        False,
        260,
    ),
    (
        "Suman Tamang",
        "suman.tamang@example.com",
        "+9779818765432",
        UserRole.PUBLIC,
        "Landowner",
        None,
        None,
        True,
        False,
        190,
    ),
    (
        "Kabita Shrestha",
        "kabita.shrestha@example.com",
        "+9779849001122",
        UserRole.PUBLIC,
        "Public user",
        None,
        None,
        False,
        False,
        40,
    ),
    (
        "Hari Bahadur Basnet",
        "hari.basnet@example.com",
        "+9779808899776",
        UserRole.PUBLIC,
        "Public user",
        None,
        None,
        False,
        False,
        12,
    ),
    (
        "Rajendra Karki",
        "rajendra.karki@parkmandu.test",
        "+9779851000001",
        UserRole.POLICE,
        "Inspector",
        "TP-2841",
        "Metropolitan Traffic Police Division · Central",
        True,
        True,
        900,
    ),
    (
        "Sunita Rai",
        "sunita.rai@parkmandu.test",
        "+9779851000002",
        UserRole.POLICE,
        "Sub-Inspector",
        "TP-3107",
        "Metropolitan Traffic Police Division · East",
        True,
        True,
        640,
    ),
    (
        "Dipak Bhandari",
        "dipak.bhandari@parkmandu.test",
        "+9779851000003",
        UserRole.POLICE,
        "Assistant Sub-Inspector",
        "TP-3392",
        "Metropolitan Traffic Police Division · West",
        True,
        False,
        380,
    ),
    (
        "Nabin Shrestha",
        "nabin.shrestha@parkmandu.test",
        "+9779851000101",
        UserRole.ADMIN,
        "Senior Parking Officer",
        None,
        "Department of Transport Management",
        True,
        False,
        1100,
    ),
    (
        "Pooja Joshi",
        "pooja.joshi@parkmandu.test",
        "+9779851000102",
        UserRole.ADMIN,
        "Parking Registration Officer",
        None,
        "Kathmandu Metropolitan City",
        True,
        False,
        500,
    ),
]

# --------------------------------------------------------------------------- parking

T = time
PARKINGS = [
    # name, address, area, lat, lng, category, type, capacity, available, hours, days, price, managed_by, status
    (
        "Ratna Park Public Parking",
        "Ratna Park East Gate, Kathmandu-1",
        "Ratna Park",
        27.7058,
        85.3150,
        ParkingCategory.GOVERNMENT,
        ParkingType.OPEN_AIR,
        120,
        34,
        (T(6), T(21)),
        AvailableDays.EVERY_DAY,
        30,
        "Kathmandu Metropolitan City",
        ParkingStatus.OPEN,
    ),
    (
        "Sundhara Multi-level Parking",
        "Sundhara Chowk, Kathmandu-22",
        "Sundhara",
        27.7008,
        85.3128,
        ParkingCategory.GOVERNMENT,
        ParkingType.COVERED,
        200,
        61,
        (T(6), T(22)),
        AvailableDays.EVERY_DAY,
        40,
        "Kathmandu Metropolitan City",
        ParkingStatus.OPEN,
    ),
    (
        "Durbar Marg Parking Plaza",
        "Durbar Marg, Kathmandu-1",
        "Durbar Marg",
        27.7105,
        85.3178,
        ParkingCategory.GOVERNMENT,
        ParkingType.BASEMENT,
        150,
        12,
        (T(7), T(22)),
        AvailableDays.EVERY_DAY,
        60,
        "Kathmandu Metropolitan City",
        ParkingStatus.OPEN,
    ),
    (
        "New Road Gate Parking",
        "Khichapokhari Marg, New Road, Kathmandu-22",
        "New Road",
        27.7036,
        85.3108,
        ParkingCategory.PRIVATE,
        ParkingType.COVERED,
        60,
        9,
        (T(7), T(21)),
        AvailableDays.EVERY_DAY,
        50,
        "Shakya Parking Services",
        ParkingStatus.OPEN,
    ),
    (
        "Thamel Community Parking",
        "Chaksibari Marg, Thamel, Kathmandu-26",
        "Thamel",
        27.7152,
        85.3108,
        ParkingCategory.PRIVATE,
        ParkingType.OPEN_AIR,
        40,
        15,
        (T(6), T(23)),
        AvailableDays.EVERY_DAY,
        40,
        "Thamel Tole Sudhar Samiti",
        ParkingStatus.OPEN,
    ),
    (
        "Putalisadak Parking",
        "Putalisadak Road, Kathmandu-30",
        "Putalisadak",
        27.7050,
        85.3220,
        ParkingCategory.PRIVATE,
        ParkingType.OPEN_AIR,
        35,
        0,
        (T(7), T(20)),
        AvailableDays.MON_SAT,
        35,
        "Bhattarai Land Holdings",
        ParkingStatus.FULL,
    ),
    (
        "Baneshwor Government Parking",
        "Civil Service Hospital Road, New Baneshwor, Kathmandu-10",
        "Baneshwor",
        27.6915,
        85.3420,
        ParkingCategory.GOVERNMENT,
        ParkingType.OPEN_AIR,
        90,
        41,
        (T(6), T(21)),
        AvailableDays.EVERY_DAY,
        25,
        "Department of Transport Management",
        ParkingStatus.OPEN,
    ),
    (
        "Lazimpat Parking Point",
        "Lazimpat Road, Kathmandu-2",
        "Lazimpat",
        27.7225,
        85.3205,
        ParkingCategory.PRIVATE,
        ParkingType.OPEN_AIR,
        30,
        7,
        (T(7), T(21)),
        AvailableDays.EVERY_DAY,
        35,
        "Rana Family Trust",
        ParkingStatus.OPEN,
    ),
    (
        "Patan Durbar Square Parking",
        "Mangal Bazaar, Lalitpur-16",
        "Patan",
        27.6727,
        85.3253,
        ParkingCategory.GOVERNMENT,
        ParkingType.OPEN_AIR,
        80,
        22,
        (T(6), T(20)),
        AvailableDays.EVERY_DAY,
        30,
        "Lalitpur Metropolitan City",
        ParkingStatus.OPEN,
    ),
    (
        "Jawalakhel Ground Parking",
        "Jawalakhel Chowk, Lalitpur-3",
        "Jawalakhel",
        27.6727,
        85.3141,
        ParkingCategory.GOVERNMENT,
        ParkingType.OPEN_AIR,
        100,
        58,
        (T(5), T(22)),
        AvailableDays.EVERY_DAY,
        None,
        "Lalitpur Metropolitan City",
        ParkingStatus.OPEN,
    ),
    (
        "Kalanki Chowk Parking",
        "Ring Road, Kalanki, Kathmandu-14",
        "Kalanki",
        27.6936,
        85.2817,
        ParkingCategory.PRIVATE,
        ParkingType.OPEN_AIR,
        50,
        19,
        (T(6), T(21)),
        AvailableDays.EVERY_DAY,
        25,
        "Kalanki Transport Cooperative",
        ParkingStatus.OPEN,
    ),
    (
        "Koteshwor Park & Ride",
        "Araniko Highway, Koteshwor, Kathmandu-32",
        "Koteshwor",
        27.6787,
        85.3495,
        ParkingCategory.GOVERNMENT,
        ParkingType.OPEN_AIR,
        180,
        97,
        (T(0), T(23, 59)),
        AvailableDays.EVERY_DAY,
        20,
        "Department of Transport Management",
        ParkingStatus.OPEN,
    ),
    (
        "Boudha Stupa Visitor Parking",
        "Boudha Road, Kathmandu-6",
        "Boudha",
        27.7215,
        85.3620,
        ParkingCategory.GOVERNMENT,
        ParkingType.OPEN_AIR,
        70,
        26,
        (T(6), T(20)),
        AvailableDays.EVERY_DAY,
        40,
        "Boudhanath Area Development Committee",
        ParkingStatus.OPEN,
    ),
    (
        "Chabahil Parking",
        "Chabahil Chowk, Kathmandu-7",
        "Chabahil",
        27.7173,
        85.3466,
        ParkingCategory.PRIVATE,
        ParkingType.OPEN_AIR,
        35,
        11,
        (T(7), T(20)),
        AvailableDays.MON_SAT,
        30,
        "Chabahil Business Association",
        ParkingStatus.OPEN,
    ),
    (
        "Maharajgunj Community Parking",
        "Chakrapath, Maharajgunj, Kathmandu-3",
        "Maharajgunj",
        27.7362,
        85.3302,
        ParkingCategory.PRIVATE,
        ParkingType.OPEN_AIR,
        25,
        14,
        (T(6), T(20)),
        AvailableDays.EVERY_DAY,
        None,
        "Maharajgunj Ward Office",
        ParkingStatus.OPEN,
    ),
    (
        "Dasharath Stadium Parking",
        "Tripureshwor, Kathmandu-11",
        "Tripureshwor",
        27.6950,
        85.3145,
        ParkingCategory.GOVERNMENT,
        ParkingType.OPEN_AIR,
        120,
        64,
        (T(6), T(21)),
        AvailableDays.EVERY_DAY,
        30,
        "National Sports Council",
        ParkingStatus.OPEN,
    ),
    (
        "Kupondole Riverside Parking",
        "Kupondole Height, Lalitpur-1",
        "Kupondole",
        27.6868,
        85.3165,
        ParkingCategory.PRIVATE,
        ParkingType.OPEN_AIR,
        28,
        6,
        (T(7), T(21)),
        AvailableDays.EVERY_DAY,
        35,
        "Pradhan Properties",
        ParkingStatus.OPEN,
    ),
    (
        "Swayambhu Visitor Parking",
        "Swayambhu Ring Road, Kathmandu-15",
        "Swayambhu",
        27.7149,
        85.2904,
        ParkingCategory.GOVERNMENT,
        ParkingType.OPEN_AIR,
        60,
        30,
        (T(6), T(19)),
        AvailableDays.EVERY_DAY,
        30,
        "Kathmandu Metropolitan City",
        ParkingStatus.OPEN,
    ),
    (
        "Jamal Parking",
        "Jamal Marg, Kathmandu-28",
        "Jamal",
        27.7090,
        85.3155,
        ParkingCategory.PRIVATE,
        ParkingType.OPEN_AIR,
        45,
        0,
        (T(8), T(19)),
        AvailableDays.WEEKDAYS,
        45,
        "Joshi Real Estate",
        ParkingStatus.CLOSED,
    ),
    (
        "Pulchowk Parking",
        "Pulchowk Road, Lalitpur-3",
        "Pulchowk",
        27.6780,
        85.3170,
        ParkingCategory.PRIVATE,
        ParkingType.OPEN_AIR,
        30,
        12,
        (T(7), T(20)),
        AvailableDays.WEEKDAYS,
        30,
        "Pulchowk Traders Group",
        ParkingStatus.OPEN,
    ),
]

CAMERAS = [
    ("CAM-001", "Kalanki Chowk", "Ring Road, Kalanki", "Kalanki", "Zone 05", 27.6933, 85.2810, CameraStatus.LIVE),
    ("CAM-003", "Balaju Chowk", "Ring Road, Balaju", "Balaju", "Zone 04", 27.7275, 85.3045, CameraStatus.LIVE),
    ("CAM-005", "Gongabu Bus Park", "Ring Road, Gongabu", "Gongabu", "Zone 04", 27.7350, 85.3140, CameraStatus.LIVE),
    (
        "CAM-008",
        "Maharajgunj Chakrapath",
        "Chakrapath, Maharajgunj",
        "Maharajgunj",
        "Zone 03",
        27.7398,
        85.3375,
        CameraStatus.OFFLINE,
    ),
    ("CAM-010", "Chabahil Chowk", "Ring Road, Chabahil", "Chabahil", "Zone 06", 27.7175, 85.3460, CameraStatus.LIVE),
    (
        "CAM-012",
        "Lazimpat Road",
        "Lazimpat Road, near Embassy Row",
        "Lazimpat",
        "Zone 02",
        27.7215,
        85.3200,
        CameraStatus.LIVE,
    ),
    (
        "CAM-014",
        "Kantipath & Jamal Junction",
        "Kantipath, Jamal",
        "Jamal",
        "Zone 01",
        27.7083,
        85.3157,
        CameraStatus.LIVE,
    ),
    (
        "CAM-016",
        "Narayanhiti Gate",
        "Durbar Marg, Narayanhiti",
        "Durbar Marg",
        "Zone 01",
        27.7118,
        85.3185,
        CameraStatus.LIVE,
    ),
    ("CAM-018", "Putalisadak Chowk", "Putalisadak Road", "Putalisadak", "Zone 01", 27.7040, 85.3225, CameraStatus.LIVE),
    ("CAM-020", "New Road Gate", "New Road, Khichapokhari", "New Road", "Zone 01", 27.7040, 85.3112, CameraStatus.LIVE),
    (
        "CAM-022",
        "Sundhara Junction",
        "Sundhara, near Dharahara",
        "Sundhara",
        "Zone 01",
        27.7005,
        85.3135,
        CameraStatus.LIVE,
    ),
    (
        "CAM-024",
        "Tripureshwor Chowk",
        "Tripureshwor Road",
        "Tripureshwor",
        "Zone 07",
        27.6945,
        85.3125,
        CameraStatus.LIVE,
    ),
    (
        "CAM-026",
        "Thapathali Bridge",
        "Thapathali Bridge Approach",
        "Thapathali",
        "Zone 07",
        27.6905,
        85.3190,
        CameraStatus.MAINTENANCE,
    ),
    (
        "CAM-027",
        "Maitighar Mandala",
        "Maitighar Roundabout",
        "Maitighar",
        "Zone 07",
        27.6945,
        85.3225,
        CameraStatus.LIVE,
    ),
    ("CAM-029", "Baneshwor Chowk", "New Baneshwor Road", "Baneshwor", "Zone 08", 27.6890, 85.3365, CameraStatus.LIVE),
    (
        "CAM-031",
        "Tinkune Junction",
        "Araniko Highway, Tinkune",
        "Tinkune",
        "Zone 08",
        27.6860,
        85.3465,
        CameraStatus.LIVE,
    ),
    (
        "CAM-033",
        "Koteshwor Junction",
        "Ring Road, Koteshwor",
        "Koteshwor",
        "Zone 08",
        27.6780,
        85.3490,
        CameraStatus.LIVE,
    ),
    ("CAM-035", "Thamel Chowk", "Thamel Marg", "Thamel", "Zone 02", 27.7152, 85.3123, CameraStatus.LIVE),
    ("CAM-037", "Jawalakhel Chowk", "Jawalakhel Road", "Jawalakhel", "Zone 09", 27.6730, 85.3135, CameraStatus.OFFLINE),
    (
        "CAM-039",
        "Kupondole Road",
        "Kupondole, near Bagmati Bridge",
        "Kupondole",
        "Zone 09",
        27.6865,
        85.3160,
        CameraStatus.LIVE,
    ),
    ("CAM-041", "Bagbazar Road", "Bagbazar, Kathmandu-28", "Bagbazar", "Zone 01", 27.7055, 85.3185, CameraStatus.LIVE),
    (
        "CAM-043",
        "Satdobato Chowk",
        "Ring Road, Satdobato",
        "Satdobato",
        "Zone 09",
        27.6585,
        85.3245,
        CameraStatus.MAINTENANCE,
    ),
]

# Named applications that tell a story for the demo landowner and the review queue.
APPLICATIONS = [
    # applicant email, name, address, area, lat, lng, capacity, land, type, status, submitted_days_ago, feedback
    (
        "sita.sharma@example.com",
        "Sharma Family Parking",
        "Baluwatar Marg 14, Kathmandu-4",
        "Baluwatar",
        27.7282,
        85.3302,
        24,
        780,
        ParkingType.OPEN_AIR,
        ApplicationStatus.APPROVED,
        150,
        None,
    ),
    (
        "sita.sharma@example.com",
        "Dhobighat Open Lot",
        "Dhobighat Ring Road, Lalitpur-4",
        "Dhobighat",
        27.6765,
        85.3020,
        18,
        680,
        ParkingType.OPEN_AIR,
        ApplicationStatus.UNDER_REVIEW,
        3,
        None,
    ),
    (
        "sita.sharma@example.com",
        "Kalimati Riverside Annex",
        "Kalimati Bridge Road, Kathmandu-13",
        "Kalimati",
        27.6975,
        85.2985,
        10,
        320,
        ParkingType.OPEN_AIR,
        ApplicationStatus.CHANGES_REQUESTED,
        21,
        "Please upload a clearer copy of the Lalpurja showing the plot number and the boundary plan.",
    ),
    (
        "ramesh.adhikari@example.com",
        "Adhikari Courtyard Parking",
        "Naxal Bhagwati Marg 22, Kathmandu-1",
        "Naxal",
        27.7155,
        85.3285,
        16,
        540,
        ParkingType.OPEN_AIR,
        ApplicationStatus.SUBMITTED,
        1,
        None,
    ),
    (
        "anjali.gurung@example.com",
        "Gurung Open Lot",
        "Sinamangal Airport Road, Kathmandu-9",
        "Sinamangal",
        27.6960,
        85.3500,
        42,
        1450,
        ParkingType.OPEN_AIR,
        ApplicationStatus.UNDER_REVIEW,
        5,
        None,
    ),
    (
        "bikash.thapa@example.com",
        "Thapa Basement Parking",
        "Kamaladi Marg 7, Kathmandu-28",
        "Kamaladi",
        27.7080,
        85.3205,
        26,
        900,
        ParkingType.BASEMENT,
        ApplicationStatus.SUBMITTED,
        2,
        None,
    ),
    (
        "kabita.shrestha@example.com",
        "Shrestha Rooftop Parking",
        "Bagbazar Sadak 31, Kathmandu-28",
        "Bagbazar",
        27.7060,
        85.3192,
        12,
        410,
        ParkingType.ROOFTOP,
        ApplicationStatus.SUBMITTED,
        0.3,
        None,
    ),
    (
        "prakash.maharjan@example.com",
        "Maharjan Heritage Lot",
        "Kumbheshwor, Lalitpur-11",
        "Patan",
        27.6780,
        85.3245,
        20,
        600,
        ParkingType.OPEN_AIR,
        ApplicationStatus.REJECTED,
        40,
        "The plot lies inside the Patan heritage conservation zone, where private commercial parking is not permitted.",
    ),
    (
        "manisha.karki@example.com",
        "Karki Plaza Parking",
        "Shantinagar Gate, New Baneshwor, Kathmandu-34",
        "Baneshwor",
        27.6880,
        85.3395,
        36,
        1100,
        ParkingType.COVERED,
        ApplicationStatus.APPROVED,
        110,
        None,
    ),
    (
        "suman.tamang@example.com",
        "Tamang Garden Parking",
        "Budhanilkantha Road, Kathmandu-3",
        "Budhanilkantha",
        27.7585,
        85.3600,
        30,
        1300,
        ParkingType.OPEN_AIR,
        ApplicationStatus.APPROVED,
        75,
        None,
    ),
]


def make_image(path: Path, title: str, subtitle: str, colors: tuple[str, str]) -> None:
    img = Image.new("RGB", (960, 640), colors[0])
    draw = ImageDraw.Draw(img)
    for y in range(640):  # simple vertical gradient
        ratio = y / 640
        c1 = tuple(int(colors[0][i : i + 2], 16) for i in (1, 3, 5))
        c2 = tuple(int(colors[1][i : i + 2], 16) for i in (1, 3, 5))
        draw.line([(0, y), (960, y)], fill=tuple(int(a + (b - a) * ratio) for a, b in zip(c1, c2, strict=True)))
    draw.rectangle([(60, 420), (900, 600)], fill="#4b5563")
    for x in range(90, 900, 120):
        draw.rectangle([(x, 430), (x + 6, 590)], fill="#f3f4f6")
    draw.text((60, 60), title, fill="white")
    draw.text((60, 90), subtitle, fill="#e5e7eb")
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG")


def seed_document(session: Session, app: ParkingApplication, kind: DocumentKind, label: str, index: int) -> None:
    folder = f"applications/{app.id}"
    is_pdf = kind == DocumentKind.OWNERSHIP_DOCUMENT
    key = f"{folder}/seed_{kind.value}_{index}.{'pdf' if is_pdf else 'png'}"
    path = storage.resolve(key)
    palette = {
        DocumentKind.OWNERSHIP_DOCUMENT: ("#f5f0e1", "#d6cfb8"),
        DocumentKind.GOVERNMENT_ID: ("#dbe7f5", "#9db4d3"),
        DocumentKind.PROPERTY_PHOTO: ("#9db3a2", "#486153"),
        DocumentKind.PARKING_PHOTO: ("#9eb3c8", "#677c6c"),
    }[kind]
    make_image(path.with_suffix(".png"), label, f"{app.property_name} · {app.address}", palette)
    thumb_key = None
    if is_pdf:
        with Image.open(path.with_suffix(".png")) as img:
            img.save(path, "PDF")
        path.with_suffix(".png").unlink()
    else:
        thumb_key = key.rsplit(".", 1)[0] + "_thumb.webp"
        with Image.open(path) as img:
            img.thumbnail((480, 480))
            img.save(storage.resolve(thumb_key), "WEBP", quality=80)
    session.add(
        ApplicationDocument(
            application_id=app.id,
            kind=kind,
            original_name=f"{label.lower().replace(' ', '-')}.{'pdf' if is_pdf else 'png'}",
            content_type="application/pdf" if is_pdf else "image/png",
            size_bytes=path.stat().st_size,
            checksum_sha256="0" * 64,
            storage_key=key,
            thumbnail_key=thumb_key,
            status=DocumentStatus.READY,
        )
    )


def seed() -> None:
    with SyncSessionLocal() as session:
        if session.scalar(select(User.id).where(User.email == "nabin.shrestha@parkmandu.test")):
            log.info("Seed data already present — skipping.")
            return

        log.info("Seeding users…")
        password_hash = hash_password(DEMO_PASSWORD)
        users: dict[str, User] = {}
        for name, email, phone, role, designation, badge, unit, verified, on_duty, days in USERS:
            user = User(
                full_name=name,
                email=email,
                phone=phone,
                password_hash=password_hash,
                role=role,
                designation=designation,
                badge_number=badge,
                unit=unit,
                is_verified=verified,
                on_duty=on_duty,
                created_at=ago(days=days),
            )
            session.add(user)
            users[email] = user
        session.flush()
        admin = users["nabin.shrestha@parkmandu.test"]

        log.info("Seeding parking locations…")
        for name, address, area, lat, lng, category, ptype, cap, avail, hours, days, price, managed, status in PARKINGS:
            session.add(
                ParkingLocation(
                    name=name,
                    address=address,
                    area=area,
                    latitude=lat,
                    longitude=lng,
                    category=category,
                    parking_type=ptype,
                    capacity=cap,
                    available_spaces=avail,
                    opens_at=hours[0],
                    closes_at=hours[1],
                    available_days=days,
                    pricing_mode=PricingMode.FREE if price is None else PricingMode.HOURLY,
                    price_per_hour=Decimal(price) if price else None,
                    managed_by=managed,
                    status=status,
                    contact_phone="+97714200000" if category == ParkingCategory.GOVERNMENT else None,
                    created_at=ago(days=random.randint(200, 700)),
                )
            )

        log.info("Seeding applications and documents…")
        public_users = [u for u in users.values() if u.role == UserRole.PUBLIC]
        story = [(users[email], *rest) for email, *rest in APPLICATIONS]
        # Background history so dashboard charts have six months of data.
        for _ in range(26):
            applicant = random.choice(public_users)
            status_choice = random.choices(
                [ApplicationStatus.APPROVED, ApplicationStatus.REJECTED, ApplicationStatus.CHANGES_REQUESTED],
                weights=[70, 15, 15],
            )[0]
            base = random.choice(PARKINGS)
            story.append(
                (
                    applicant,
                    f"{applicant.full_name.split()[-1]} {random.choice(['Courtyard', 'Open', 'Corner', 'Garden', 'Lane'])} Parking",
                    f"{random.randint(2, 80)} {base[2]} Marg, Kathmandu",
                    base[2],
                    base[3] + random.uniform(-0.006, 0.006),
                    base[4] + random.uniform(-0.006, 0.006),
                    random.randint(8, 45),
                    random.randint(250, 1500),
                    random.choice([ParkingType.OPEN_AIR, ParkingType.COVERED, ParkingType.BASEMENT]),
                    status_choice,
                    random.uniform(8, 175),
                    None
                    if status_choice == ApplicationStatus.APPROVED
                    else "Boundary plan does not match the cadastral map. Please upload a surveyed plan.",
                )
            )

        for applicant, pname, address, area, lat, lng, capacity, land, ptype, status, submitted_ago, feedback in story:
            submitted_at = ago(days=submitted_ago)
            app = ParkingApplication(
                applicant_id=applicant.id,
                status=status,
                completed_step=5,
                latitude=lat,
                longitude=lng,
                address=address,
                area=area,
                property_name=pname,
                land_size_sqm=land,
                capacity=capacity,
                parking_type=ptype,
                opens_at=time(7),
                closes_at=time(21),
                available_days=random.choice([AvailableDays.EVERY_DAY, AvailableDays.MON_SAT]),
                pricing_mode=PricingMode.HOURLY,
                price_per_hour=Decimal(random.choice([25, 30, 35, 40])),
                owner_name=applicant.full_name,
                owner_phone=applicant.phone,
                gov_id_encrypted=encrypt_field(f"27-01-75-{random.randint(10000, 99999)}"),
                gov_id_last4=str(random.randint(1000, 9999)),
                ownership_document_number=f"KTM-WD{random.randint(1, 32):02d}-2081-{random.randint(1000, 9999)}",
                owner_confirmed=True,
                declaration_accepted=True,
                submitted_at=submitted_at,
                created_at=submitted_at - timedelta(hours=2),
            )
            session.add(app)
            session.flush()
            app.reference = f"PM-{submitted_at.year}-{app.seq:06d}"
            events = [(ApplicationEventKind.SUBMITTED, "Application received.", applicant, submitted_at)]
            if status != ApplicationStatus.SUBMITTED:
                app.reviewer_id = admin.id
                events.append(
                    (
                        ApplicationEventKind.REVIEW_STARTED,
                        "Your property and documents are being assessed.",
                        admin,
                        submitted_at + timedelta(hours=20),
                    )
                )
            decided = submitted_at + timedelta(days=min(6, submitted_ago * 0.6))
            if status == ApplicationStatus.APPROVED:
                app.decided_at = decided
                events.append((ApplicationEventKind.APPROVED, "Application approved.", admin, decided))
                session.add(
                    ParkingLocation(
                        name=pname,
                        address=address,
                        area=area,
                        latitude=lat,
                        longitude=lng,
                        category=ParkingCategory.PRIVATE,
                        parking_type=ptype,
                        capacity=capacity,
                        available_spaces=random.randint(0, capacity),
                        land_size_sqm=land,
                        opens_at=time(7),
                        closes_at=time(21),
                        available_days=app.available_days,
                        pricing_mode=PricingMode.HOURLY,
                        price_per_hour=app.price_per_hour,
                        managed_by=applicant.full_name,
                        contact_phone=applicant.phone,
                        owner_id=applicant.id,
                        application_id=app.id,
                        created_at=decided,
                    )
                )
            elif status == ApplicationStatus.REJECTED:
                app.decided_at, app.feedback = decided, feedback
                events.append((ApplicationEventKind.REJECTED, feedback, admin, decided))
            elif status == ApplicationStatus.CHANGES_REQUESTED:
                app.feedback = feedback
                events.append((ApplicationEventKind.DOCUMENTS_REQUESTED, feedback, admin, decided))
            for kind, message, actor, at in events:
                session.add(
                    ApplicationEvent(
                        application_id=app.id, kind=kind, message=message, actor_id=actor.id, created_at=at
                    )
                )

            if submitted_ago < 60:  # documents for the recent, reviewable applications
                seed_document(session, app, DocumentKind.OWNERSHIP_DOCUMENT, "Lalpurja ownership certificate", 1)
                seed_document(session, app, DocumentKind.GOVERNMENT_ID, "Citizenship certificate", 1)
                seed_document(session, app, DocumentKind.PROPERTY_PHOTO, "Entrance", 1)
                seed_document(session, app, DocumentKind.PROPERTY_PHOTO, "Road access", 2)
                seed_document(session, app, DocumentKind.PARKING_PHOTO, "Parking area", 1)

        # One unfinished draft for the demo landowner (resumes at step 3).
        sita = users["sita.sharma@example.com"]
        session.add(
            ParkingApplication(
                applicant_id=sita.id,
                status=ApplicationStatus.DRAFT,
                completed_step=2,
                latitude=27.6840,
                longitude=85.3070,
                address="Sanepa Chowk 9, Lalitpur-2",
                area="Sanepa",
                property_name="Sanepa Courtyard Parking",
                land_size_sqm=450,
                capacity=14,
                parking_type=ParkingType.OPEN_AIR,
                opens_at=time(7),
                closes_at=time(20),
                available_days=AvailableDays.EVERY_DAY,
                pricing_mode=PricingMode.HOURLY,
                price_per_hour=Decimal(30),
                owner_name=sita.full_name,
                owner_phone=sita.phone,
            )
        )

        log.info("Seeding notifications…")
        sita_apps = {
            a.property_name: a
            for a in session.scalars(select(ParkingApplication).where(ParkingApplication.applicant_id == sita.id))
        }
        notices = [
            (
                NotificationKind.APPLICATION_UNDER_REVIEW,
                NotificationTone.WARNING,
                "Your parking application is under review.",
                f"Government review has started for reference {sita_apps['Dhobighat Open Lot'].reference}.",
                "Dhobighat Open Lot",
                ago(days=2, hours=4),
                None,
            ),
            (
                NotificationKind.APPLICATION_RECEIVED,
                NotificationTone.INFO,
                "Your parking application has been received.",
                "Dhobighat Open Lot is now waiting for government review.",
                "Dhobighat Open Lot",
                ago(days=3),
                None,
            ),
            (
                NotificationKind.DOCUMENTS_REQUIRED,
                NotificationTone.DANGER,
                "Additional documents are required.",
                "Please upload a clearer copy of the Lalpurja showing the plot number and the boundary plan.",
                "Kalimati Riverside Annex",
                ago(days=15),
                ago(days=14),
            ),
            (
                NotificationKind.APPLICATION_CHANGES,
                NotificationTone.DANGER,
                "Your parking application needs changes.",
                "Kalimati Riverside Annex needs updates before it can be approved.",
                "Kalimati Riverside Annex",
                ago(days=15, hours=1),
                ago(days=14),
            ),
            (
                NotificationKind.APPLICATION_APPROVED,
                NotificationTone.SUCCESS,
                "Your parking location has been approved.",
                "Sharma Family Parking is approved and visible to the public.",
                "Sharma Family Parking",
                ago(days=145),
                ago(days=144),
            ),
        ]
        for kind, tone, title, body, app_name, at, read_at in notices:
            session.add(
                Notification(
                    user_id=sita.id,
                    kind=kind,
                    tone=tone,
                    title=title,
                    body=body,
                    entity_type="application",
                    entity_id=sita_apps[app_name].id,
                    created_at=at,
                    read_at=read_at,
                )
            )

        log.info("Seeding cameras…")
        cameras: list[Camera] = []
        for code, name, road, area, zone, lat, lng, status in CAMERAS:
            level = random.choices(list(TrafficLevel), weights=[45, 30, 17, 8])[0]
            camera = Camera(
                code=code,
                name=name,
                road=road,
                area=area,
                zone=zone,
                latitude=lat,
                longitude=lng,
                status=status,
                traffic_level=level,
                avg_speed_kmh={"clear": 34, "moderate": 22, "slow": 12, "congested": 5}[level.value],
                stream_url=f"rtsp://cctv.parkmandu.test/{code.lower()}",
                last_heartbeat_at=NOW if status == CameraStatus.LIVE else ago(hours=random.randint(3, 30)),
                installed_on=date(2023, random.randint(1, 12), random.randint(1, 28)),
            )
            session.add(camera)
            cameras.append(camera)
        session.flush()

        log.info("Seeding alerts and incidents…")
        officers = [u for u in users.values() if u.role == UserRole.POLICE]
        live = [c for c in cameras if c.status == CameraStatus.LIVE]
        violations = list(ViolationType)
        for _ in range(70):  # resolved / dismissed history over the last week
            camera = random.choice(live)
            vehicle, series = random.choice(VEHICLES)
            detected = ago(minutes=random.randint(90, 7 * 24 * 60))
            alert = create_alert(
                session,
                camera,
                violation_type=random.choice(violations),
                vehicle_type=vehicle,
                vehicle_color=random.choice(COLORS),
                plate_number=random_plate(series),
                confidence=random.uniform(0.7, 0.98),
                direction=random.choice(DIRECTIONS),
                detected_at=detected,
            )
            officer = random.choice(officers)
            if random.random() < 0.8:
                alert.status, alert.assigned_officer_id = AlertStatus.RESOLVED, officer.id
                alert.closed_at = detected + timedelta(minutes=random.randint(8, 50))
                incident = Incident(
                    alert_id=alert.id,
                    officer_id=officer.id,
                    status=IncidentStatus.RESOLVED,
                    resolution="Vehicle moved and road cleared.",
                    resolved_at=alert.closed_at,
                    created_at=detected + timedelta(minutes=3),
                )
                session.add(incident)
                session.flush()
                incident.code = f"INC-{incident.seq}"
            else:
                alert.status, alert.closed_at = AlertStatus.DISMISSED, detected + timedelta(minutes=12)
                alert.dismiss_reason = "Authorised loading vehicle"

        rajendra = users["rajendra.karki@parkmandu.test"]
        active_specs = [
            ("CAM-014", ViolationType.RESTRICTED_LANE, "Car", "White", "Ba 3 Cha 4827", 0.94, 1, None),
            ("CAM-018", ViolationType.NEAR_INTERSECTION, "Taxi", "Black", "Ba 1 Ja 2210", 0.91, 4, None),
            ("CAM-020", ViolationType.DOUBLE_PARKING, "Microbus", "Blue", "Ba 2 Kha 9012", 0.88, 9, None),
            ("CAM-035", ViolationType.FOOTPATH, "Motorbike", "Red", "Ba 86 Pa 1123", 0.83, 14, None),
            ("CAM-029", ViolationType.BUS_STOP, "SUV", "Silver", "Ba 12 Cha 3391", 0.9, 18, rajendra),
            ("CAM-022", ViolationType.OVERTIME, "Car", "Grey", "Ba 5 Cha 7781", 0.79, 26, None),
            (
                "CAM-041",
                ViolationType.LOADING_ZONE,
                "Delivery van",
                "White",
                "Ba 4 Kha 5520",
                0.76,
                33,
                users["sunita.rai@parkmandu.test"],
            ),
        ]
        by_code = {c.code: c for c in cameras}
        for code, violation, vehicle, color, plate, conf, minutes, officer in active_specs:
            alert = create_alert(
                session,
                by_code[code],
                violation_type=violation,
                vehicle_type=vehicle,
                vehicle_color=color,
                plate_number=plate,
                confidence=conf,
                direction=random.choice(DIRECTIONS),
                detected_at=ago(minutes=minutes),
            )
            if officer:
                alert.status, alert.assigned_officer_id = AlertStatus.ASSIGNED, officer.id
                incident = Incident(alert_id=alert.id, officer_id=officer.id, created_at=ago(minutes=minutes - 2))
                session.add(incident)
                session.flush()
                incident.code = f"INC-{incident.seq}"
                session.add(
                    IncidentNote(
                        incident_id=incident.id,
                        author_id=officer.id,
                        created_at=ago(minutes=minutes - 3),
                        body="Patrol unit notified. Vehicle is obstructing the lane near the stop; driver being traced via plate.",
                    )
                )

        session.commit()
        log.info("Seed complete. Demo password for all accounts: %s", DEMO_PASSWORD)


if __name__ == "__main__":
    seed()
