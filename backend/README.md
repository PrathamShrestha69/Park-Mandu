# Park Mandu — API (FastAPI)

Government smart-parking and traffic-monitoring backend for Kathmandu Valley. It serves the
Next.js web app and the React Native mobile app for three roles: **public users / landowners**,
**traffic police** and **government administrators**.

## Stack

| Concern | Library |
| --- | --- |
| HTTP API | FastAPI, Pydantic v2, ORJSON |
| Database | PostgreSQL 16 + PostGIS (geography points, GIST and trigram indexes) |
| ORM / migrations | SQLAlchemy 2 (async, psycopg 3), Alembic, GeoAlchemy2 |
| Cache, sessions, rate limits, pub/sub | Redis 7 |
| Background jobs | Celery (worker + beat), Redis broker |
| Auth | PyJWT access tokens, rotating refresh sessions, Argon2id (pwdlib) |
| Field encryption | `cryptography` Fernet (government ID numbers) |
| Rate limiting | slowapi (Redis storage) |
| Real-time alerts | Server-Sent Events (sse-starlette) over Redis pub/sub |
| Uploads | python-multipart, `filetype` content sniffing, Pillow |
| Request tracing | asgi-correlation-id (`X-Request-ID`) |

## Run it

Requires Docker Desktop.

```bash
cp .env.example .env
```

Generate real secrets for `SECRET_KEY`, `FIELD_ENCRYPTION_KEY` and `INGEST_API_KEY` (the commands
are in `.env.example`), then:

```bash
docker compose up --build
```

`migrate` runs Alembic and seeds demo data, then `api`, `worker` and `beat` start.

- API: http://localhost:8000/api/v1 · interactive docs: http://localhost:8000/docs
- Postgres on host port **5433**, Redis on **6380** (to avoid clashing with local installs)

### Demo accounts

All seeded accounts use the password `ParkMandu@2026`.

| Role | Sign in with |
| --- | --- |
| Public user / landowner | `sita.sharma@example.com` or `9841234567` |
| Traffic police | badge `TP-2841` (also `TP-3107`, `TP-3392`) |
| Administrator | `nabin.shrestha@parkmandu.test` |

In development, one-time SMS codes and password-reset codes are returned in the API response
(`EXPOSE_DEV_CODES=true`) and logged by the worker instead of being sent.

## Tests

The suite runs real end-to-end flows against the running stack: auth modes, CSRF, refresh
rotation, search and pagination, the full application lifecycle with uploads, admin decisions,
police incidents, ingestion and statistics.

```bash
docker compose exec api pytest -q
```

```bash
docker compose exec api ruff check app tests
```

## Architecture notes

### Authentication — three client modes, one API

- **Browsers calling the API directly** receive `pm_access` / `pm_refresh` as `HttpOnly` cookies
  plus a readable `pm_csrf` cookie. Unsafe requests must echo it in `X-CSRF-Token`
  (double-submit pattern).
- **The Next.js server** (`X-Client-Type: web-server`) and the **mobile app**
  (`X-Client-Type: mobile`) receive tokens in the response body and send
  `Authorization: Bearer …`. The web app keeps them in its own `HttpOnly` cookies; the mobile app
  keeps them in the device keychain/keystore.
- Access tokens last 15 minutes. Refresh tokens rotate on every use. Replaying an old refresh
  token revokes the whole session, except within a 30-second grace window, where parallel
  requests racing with the same token get the same successor.
- Logout and suspension revoke sessions immediately through a Redis deny-list keyed by session id.
- Failed logins lock an identifier for 15 minutes after 5 attempts; login, OTP, registration
  and reset endpoints are rate-limited per IP.

### Server-side data rules

- Every list endpoint is paginated (`page`, `size` ≤ 100) and returns
  `{items, total, page, size, pages, has_next}`.
- Filtering, searching and sorting happen in SQL via typed query models: `/parkings`, `/alerts`,
  `/cameras`, `/incidents`, `/admin/applications`, `/admin/users`, `/notifications`.
- Spatial queries use PostGIS (`ST_DWithin`, `ST_Distance`); "open now" is evaluated in SQL in
  Nepal time.
- Errors share one envelope: `{"error": {"code", "message", "fields"}}`, with per-field
  validation messages.
- The landowner wizard is a server-side draft, so progress survives across devices; status
  transitions are validated and every decision is written to the audit log.

### Background jobs (Celery)

| Task | Queue | Trigger |
| --- | --- | --- |
| `process_document`: strip EXIF/GPS, normalise orientation, WEBP thumbnail | `media` | After each upload |
| `send_notification`: in-app notification + optional Expo push | `notifications` | Application events |
| `send_sms`: SMS gateway integration point (logs in development) | `notifications` | OTP / password reset |
| `ingest_detection`: CCTV analytics → alert, de-duplicated for 10 minutes | `monitoring` | `POST /ingest/detections` |
| `simulate_camera_telemetry` / `simulate_detection` | `monitoring` | Beat (demo data) |
| `escalate_stale_alerts`: raise priority after 30 min, auto-close after 8 h | `monitoring` | Beat, every minute |
| `purge_expired_sessions` | `default` | Beat, every 6 h |

Set `SIMULATE_DETECTIONS=false` to turn off the demo CCTV simulator once real cameras push to
`POST /api/v1/ingest/detections` with the `X-API-Key` header.

## Layout

```text
app/
  api/v1/      routers: auth, parkings, applications, notifications, files, geo, monitoring, admin
  core/        settings, security (JWT, Argon2, Fernet), errors, rate limiting, Redis
  db/          declarative base, async and sync sessions
  models/      SQLAlchemy models and enums
  schemas/     Pydantic request/response and filter models
  services/    auth sessions, serialisers, storage, audit log
  worker/      Celery app and tasks
  seed.py      idempotent Kathmandu demo data
alembic/       migrations
tests/         end-to-end API flows
```

## Production checklist

- Set `ENVIRONMENT=production` (disables `/docs`), `COOKIE_SECURE=true`, `COOKIE_DOMAIN`,
  `EXPOSE_DEV_CODES=false` and strong secrets.
- Run the API with `gunicorn` (the image's default command), behind TLS. Restrict
  `--forwarded-allow-ips` to your proxy's addresses instead of `*`, so clients cannot spoof
  their IP to bypass rate limits.
- Replace the local upload volume with object storage if you run several API replicas.
- Wire `send_sms` to an SMS gateway and set `EXPO_PUSH_ENABLED=true` for mobile push.
