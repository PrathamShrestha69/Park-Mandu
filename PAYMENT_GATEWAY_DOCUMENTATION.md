# ParkMandu Payment Gateway (eSewa and Khalti)

This document explains how paid parking works in ParkMandu: how a driver books a space, how eSewa and
Khalti are called, how payments are verified, and what happens when something goes wrong.

It is kept separate from the main README on purpose. For general setup see [README.md](README.md).

---

## 1. The short version

1. A driver picks a paid parking location and chooses **how many hours** they need.
2. The backend works out the price from **that location's own hourly rate** (`price_per_hour × hours`)
   and **holds one space** for 15 minutes.
3. The driver chooses **eSewa** or **Khalti** and is sent to the provider's payment page.
4. When the driver comes back, the backend **asks the provider directly** (server to server) whether
   the payment really went through, and checks the amount to the paisa.
5. Only then is the booking **confirmed**, with a start time and an **expiry time**.

The apps never see a merchant secret and never decide whether a payment succeeded. The backend does.

Free parking is untouched: free locations have no booking or payment step.

---

## 2. Architecture

```
 Web app (Next.js)  ─┐                                   ┌─▶ eSewa ePay v2  (form POST + status API)
                     ├─▶ ParkMandu API (FastAPI) ────────┤
 Mobile app (Expo) ──┘      │        ▲                   └─▶ Khalti ePayment (initiate + lookup API)
                            │        │
                     PostgreSQL   Celery worker (reconciliation every minute)
```

| Piece | File | What it does |
| --- | --- | --- |
| Provider clients | [backend/app/services/payments/gateways.py](backend/app/services/payments/gateways.py) | Talks to eSewa and Khalti: signing, initiating, status checks. No business rules. |
| Booking and payment rules | [backend/app/services/payments/service.py](backend/app/services/payments/service.py) | Holds spaces, prices bookings, applies provider answers, confirms bookings, reconciles. |
| HTTP endpoints | [backend/app/api/v1/bookings.py](backend/app/api/v1/bookings.py) | The API the apps call, plus the return URLs the providers redirect to. |
| Database models | [backend/app/models/booking.py](backend/app/models/booking.py) | `bookings` and `payments` tables. |
| Migration | [backend/alembic/versions/20261122_d9a4b7c2e5f1_parking_bridge_payments.py](backend/alembic/versions/20261122_d9a4b7c2e5f1_parking_bridge_payments.py) | Creates the tables. |
| Background job | `reconcile_payments` in [backend/app/worker/tasks.py](backend/app/worker/tasks.py) | Runs every 60 s (see [celery_app.py](backend/app/worker/celery_app.py)). |
| Web screens | [frontend/web/src/components/booking.tsx](frontend/web/src/components/booking.tsx), [frontend/web/src/app/(public)/bookings/](frontend/web/src/app/(public)/bookings/) | Checkout card, booking list and booking page. |
| Web server actions | [frontend/web/src/lib/actions/bookings.ts](frontend/web/src/lib/actions/bookings.ts) | Calls the API from the Next.js server (the browser never holds API tokens). |
| Mobile screens | [frontend/mobile/src/components/booking.tsx](frontend/mobile/src/components/booking.tsx), [frontend/mobile/src/app/(public)/booking/[id].tsx](frontend/mobile/src/app/(public)/booking/[id].tsx) | Same flow on the phone. |
| Mobile payment helper | [frontend/mobile/src/lib/payments.ts](frontend/mobile/src/lib/payments.ts) | Opens the provider in an in-app browser and returns to the app. |

The provider code is plain HTTP (`httpx`) inside the FastAPI backend. The
[eSewa-Khalti-mcp](https://github.com/Abidit/eSewa-Khalti-mcp) repository was used as a reference for
endpoints and fields. It is **not** a runtime dependency.

---

## 3. Payment flow, step by step

```
Driver            App                    ParkMandu API                    eSewa / Khalti
  │ choose hours   │                          │                                │
  │ + provider ───▶│ POST /bookings ─────────▶│ lock parking row, check space, │
  │                │                          │ price = rate × hours, hold 15m │
  │                │ POST /bookings/{id}/     │                                │
  │                │      payments ──────────▶│ create payment attempt         │
  │                │                          │ (Khalti: initiate ────────────▶│ pidx + payment_url)
  │                │◀──── checkout_url ───────│                                │
  │ pays at the provider ───────────────────────────────────────────────────▶│
  │◀──────────────────── provider redirects the browser to the API return URL ─│
  │                                           │ verify server-to-server ──────▶│ status / lookup
  │                                           │ amount matches? confirm booking│
  │◀──── redirect to the app's booking page (?payment=completed|cancelled|…) ──│
```

### 3.1 Booking and holding a space

`POST /api/v1/bookings` with `{ "parking_id": "...", "hours": 2, "vehicle_plate": "Ba 2 Pa 1234" }`.

Inside `service.create_booking`:

- The parking row is locked (`SELECT … FOR UPDATE`), so every booking for one facility is handled one
  at a time. **Two drivers can never be given the same last space**: the second waits for the first,
  then sees no free space and gets `409 no_space`.
- The price is `price_per_hour × hours`, using the facility's current rate. The rate is copied onto the
  booking, so a later price change never changes what this driver pays.
- The booking must fit before closing time and within `BOOKING_MAX_HOURS`.
- A driver can only hold one unpaid space per facility at a time. A second attempt returns
  `409 booking_pending` with the existing booking's id, and the apps simply continue with that one.

**How "free to book" is counted:** live free spaces (from the AI camera or the operator) minus active
holds minus confirmed bookings that have not been absorbed into the live figure yet. At a camera-counted
facility a driver who has arrived is already in the camera's count, so confirmed bookings only count
during the first `BOOKING_ARRIVAL_WINDOW_MINUTES`. See `reserved_spaces` in
[service.py](backend/app/services/payments/service.py).

### 3.2 Starting the payment

`POST /api/v1/bookings/{id}/payments` with `{ "provider": "esewa" | "khalti", "return_url": "..." }`.

Each call creates a new **payment attempt** with its own unique `transaction_uuid`
(e.g. `BK-7140-3fa9c1b2d0`). Retrying after a failure therefore never reuses an id the provider has
already seen.

`return_url` is where the driver ends up afterwards. It must be on the allow-list
(`PAYMENT_RETURN_ORIGINS` for web, `PAYMENT_RETURN_SCHEMES` for the mobile app), so the payment flow can
never be used to redirect someone to another site.

The answer contains `checkout_url`, which the app opens.

### 3.3 eSewa (ePay v2)

eSewa only accepts a **form POST from the driver's browser**, so `checkout_url` points to a tiny page
on the API (`GET /payments/{id}/esewa/checkout`) that submits a signed form to eSewa automatically.

The form fields are built in `Esewa.form_fields`:

```text
amount=60  tax_amount=0  product_service_charge=0  product_delivery_charge=0
total_amount=60  transaction_uuid=BK-7140-3fa9c1b2d0  product_code=EPAYTEST
success_url=…/payments/esewa/{payment_id}/success
failure_url=…/payments/esewa/{payment_id}/failure
signed_field_names=total_amount,transaction_uuid,product_code
signature=<base64 HMAC-SHA256>
```

The signature is computed on the server:

```python
message = "total_amount=60,transaction_uuid=BK-7140-3fa9c1b2d0,product_code=EPAYTEST"
signature = base64(HMAC_SHA256(ESEWA_SECRET_KEY, message))
```

This was checked against the real eSewa sandbox: a correctly signed form is accepted, and a tampered
signature is rejected by eSewa with `ES104 Invalid payload signature`.

The page sends a strict Content-Security-Policy that only allows a form submission to the eSewa host.

**Coming back from eSewa**

- **Success:** eSewa redirects to `success_url?data=<base64 JSON>`. The backend decodes `data`, checks
  its signature over the fields named in its own `signed_field_names`, and checks that it is for this
  transaction. A bad or forged `data` is logged and ignored. Either way, the backend then calls the
  **eSewa status API** and only that answer counts:

  ```
  GET https://rc.esewa.com.np/api/epay/transaction/status/?product_code=EPAYTEST&total_amount=60&transaction_uuid=BK-7140-3fa9c1b2d0
  → {"status": "COMPLETE", "total_amount": 60.0, "ref_id": "000AWEO", ...}
  ```

- **Failure / cancel:** eSewa redirects to `failure_url`. The backend still asks the status API, in case
  the payment did go through. eSewa reports an unpaid checkout as `PENDING`, which, after a failure
  redirect, is recorded as **cancelled**.

eSewa status values and how they are recorded:

| eSewa `status` | ParkMandu payment status |
| --- | --- |
| `COMPLETE` | `completed` (after the amount check) |
| `PENDING`, `AMBIGUOUS` | `pending`, or `cancelled` after the failure redirect |
| `CANCELED` | `cancelled` |
| `FULL_REFUND`, `PARTIAL_REFUND` | `refunded` |
| `NOT_FOUND` | `cancelled` after the failure redirect, otherwise `pending` (then `expired` after 2 h) |

### 3.4 Khalti (ePayment)

The backend asks Khalti for a payment session (`Khalti.initiate`):

```http
POST https://dev.khalti.com/api/v2/epayment/initiate/
Authorization: Key <KHALTI_SECRET_KEY>
Content-Type: application/json

{
  "return_url": "…/payments/khalti/{payment_id}/return",
  "website_url": "http://localhost:3000",
  "amount": 6000,                       ← paisa (Rs 60)
  "purchase_order_id": "BK-7140-3fa9c1b2d0",
  "purchase_order_name": "Parking BK-7140 · Durbar Marg Parking · 2 h",
  "customer_info": {"name": "...", "email": "...", "phone": "..."}
}
→ {"pidx": "HT6o6PEZRWFJ5ygavzHWd5", "payment_url": "https://test-pay.khalti.com/?pidx=…", "expires_at": "…"}
```

The `pidx` is stored on the payment and the driver is sent to `payment_url`. Khalti does not accept
amounts under Rs 10, so the apps grey out Khalti for smaller totals.

**Coming back from Khalti:** Khalti redirects to `return_url?pidx=…&status=…`. The query string is
**not trusted**. The backend looks up the `pidx` it stored itself:

```http
POST https://dev.khalti.com/api/v2/epayment/lookup/
{"pidx": "HT6o6PEZRWFJ5ygavzHWd5"}
→ {"status": "Completed", "total_amount": 6000, "transaction_id": "GFq9PFS7b2iYvL8Lir9oXe", ...}
```

| Khalti `status` | ParkMandu payment status |
| --- | --- |
| `Completed` | `completed` (after the amount check) |
| `Pending`, `Initiated` | `pending` |
| `User canceled` | `cancelled` |
| `Expired` | `expired` |
| `Refunded`, `Partially Refunded` | `refunded` |

### 3.5 Confirming the booking

`service.apply_result` applies the provider's answer while holding a lock on the booking and then on the
payment:

1. If the payment is already `completed`, nothing happens. This is a **duplicate callback** or a
   retry, and the booking is never confirmed twice.
2. The amount reported by the provider must equal the booking amount **exactly** (compared in paisa).
   If it does not, the payment is marked `failed` (`amount_mismatch`), the booking is **not** confirmed,
   and the payment is flagged for a refund.
3. The provider's transaction id must not already belong to another payment (database unique
   constraint `uq_payments_provider_transaction`). This guards against replayed or reused transactions.
4. The booking becomes `confirmed`: `starts_at = now`, `ends_at = now + hours`. The confirming payment
   is stored in `bookings.paid_payment_id`, which is unique.
5. The driver gets a notification ("Parking booked … valid until 14:30").

The driver is then redirected to the app's booking page with `?payment=completed` (or `cancelled`,
`failed`, `pending`, `needs_attention`). The page always shows the state from the API, not from the URL.

### 3.6 Extending a booking

`POST /api/v1/bookings/{id}/extend` with `{ "hours": 1 }` creates an **extension** booking linked to the
original one, priced at the same hourly rate and within opening hours. It is paid exactly like a normal
booking (`POST /bookings/{extension_id}/payments`). When it is confirmed, the original booking's
`ends_at` moves forward. No extra space is reserved; the driver keeps the space they have.

---

## 4. Payment statuses and what the driver sees

### Payment (`payments.status`)

| Status | Meaning |
| --- | --- |
| `initiated` | Attempt created; the driver is being sent to the provider. |
| `pending` | The provider has not finished, or could not be asked yet. Checked again automatically. |
| `completed` | Confirmed server-to-server with the provider, and the amount matched. |
| `failed` | The provider reported a failure, or the amount/transaction check failed. |
| `cancelled` | The driver cancelled at the provider. No money was taken. |
| `expired` | The provider session timed out, or the attempt was abandoned. |
| `refunded` | The provider reports the payment as refunded. |

### Booking (`bookings.status`)

| Status | Meaning |
| --- | --- |
| `pending_payment` | Space held until `hold_expires_at` while the driver pays. |
| `confirmed` | Paid and verified. Valid from `starts_at` to `ends_at`. |
| `expired` | The hold ran out before a verified payment arrived; the space was released. |
| `cancelled` | The driver cancelled before paying. |

### What the apps show (`display_status`, computed by the API)

| `display_status` | Shown as | When |
| --- | --- | --- |
| `awaiting_payment` | Awaiting payment | Space held, no payment yet (or the last one was cancelled or failed). |
| `payment_pending` | Payment pending | Waiting for the provider to confirm. The page re-checks every 8 s. |
| `active` | Confirmed | Paid; shows duration and expiry time. |
| `ended` | Ended | A confirmed booking whose time is over. |
| `expired` / `cancelled` | Expired / Cancelled | As above. |
| `needs_attention` | Refund in progress | Money was received but the booking could not be honoured (see 5). |

How each outcome is handled:

- **Successful:** booking confirmed, green "Payment successful" banner with expiry time, notification.
- **Failed:** red banner; the space stays held, so the driver can pay again or switch provider.
- **Pending:** amber banner; the app asks the API to re-verify, the page refreshes itself, and the
  background job keeps checking. The driver is never charged twice for retrying (see 5).
- **Cancelled:** "No money was taken"; the space stays held until the hold ends; "Pay again" is offered.

---

## 5. When things go wrong: reconciliation

Payments and bookings can get out of step: the driver closes the browser before the redirect, the
network drops, or the database fails at the wrong moment. The rule is simple: **a payment that took
money is never forgotten.**

Every completed payment has a `reconciliation` state:

| `reconciliation` | Meaning | What happens |
| --- | --- | --- |
| `none` | Normal. | Nothing. |
| `needs_confirmation` | Paid, but confirming the booking failed (e.g. a database error). | Retried every minute until it succeeds. |
| `refund_required` | Paid, but the booking cannot be honoured. | Driver and all administrators are notified. |
| `resolved` | An administrator settled it. | Nothing more. |

Situations covered:

| Situation | What ParkMandu does |
| --- | --- |
| Driver paid, then closed the browser before returning | The minute job checks open payments with the provider and confirms the booking. |
| Payment succeeded but saving the booking failed | Marked `needs_confirmation`; the minute job retries and confirms it. |
| Payment arrived after the 15-minute hold ran out | A space is taken again if one is free (booking confirmed); otherwise `refund_required`. |
| Driver paid twice (two tabs, impatient retry) | The first verified payment confirms the booking; the second is `refund_required`. |
| Provider reported a different amount | Booking not confirmed; payment `failed` and `refund_required`. |
| A cancel crossed with a late payment | Cancelled payments are re-checked for an hour; a late success is still recorded. |

The job is `reconcile_payments` ([tasks.py](backend/app/worker/tasks.py)), calling `service.reconcile`.
Each run:

1. Verifies open payments older than 60 s with the provider (at most every 45 s each, 25 per run).
2. Retries `needs_confirmation` payments.
3. Releases expired holds (`pending_payment` → `expired`).
4. Closes attempts nobody finished within 48 hours (`expired`).

**For administrators** (web only):

- `GET /api/v1/admin/payments/reconciliation`: payments that need a refund or confirmation.
- `POST /api/v1/admin/payments/{id}/recheck`: ask the provider again now.
- `POST /api/v1/admin/payments/{id}/resolve` with `{ "note": "Refunded in the eSewa merchant portal" }`:
  record that it was settled (written to the audit log).

Refunds themselves are made in the eSewa or Khalti merchant portal; ParkMandu records and tracks them.

---

## 6. API endpoints

All paths are under `/api/v1`. "Driver" means a signed-in public user.

| Method and path | Who | Purpose |
| --- | --- | --- |
| `GET /payments/providers` | anyone | Which providers are enabled, minimum amounts, sandbox or production. |
| `GET /parkings/{id}/booking-quote?hours=2` | anyone | Price for N hours, spaces that can be booked, max hours before closing. |
| `POST /bookings` | driver | Hold a space and create a booking. |
| `GET /bookings?scope=all\|active\|past` | driver | The driver's own bookings. |
| `GET /bookings/{id}` | driver (owner) | Booking with payments, extensions and what can be done next. |
| `POST /bookings/{id}/payments` | driver (owner) | Start a payment attempt; returns `checkout_url`. |
| `POST /bookings/{id}/extend` | driver (owner) | Create an extension (then pay it). |
| `POST /bookings/{id}/cancel` | driver (owner) | Release a held space (checks open payments with the provider first). |
| `POST /payments/{id}/verify` | driver (owner) | Ask the provider again ("Check payment status"). |
| `GET /payments/{id}/esewa/checkout` | browser | Auto-submitting signed eSewa form. |
| `GET /payments/esewa/{id}/success` | eSewa redirect | Verify, then send the driver back to the app. |
| `GET /payments/esewa/{id}/failure` | eSewa redirect | Verify, then send the driver back to the app. |
| `GET /payments/khalti/{id}/return` | Khalti redirect | Verify, then send the driver back to the app. |
| `GET /admin/payments/reconciliation` | administrator | Payments needing attention. |
| `POST /admin/payments/{id}/recheck` | administrator | Re-verify with the provider. |
| `POST /admin/payments/{id}/resolve` | administrator | Mark as settled. |

The provider return URLs carry no login, because the provider's redirect has none. They are safe because
they change nothing based on the URL itself: they only trigger a server-to-server check of a payment id
(an unguessable UUID). They are also hidden from the public API docs and rate-limited.

Example: book and start an eSewa payment from a script.

```bash
curl -X POST http://localhost:8000/api/v1/bookings \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "X-Client-Type: mobile" \
  -d '{"parking_id": "9c485426-…", "hours": 2}'
# → {"id": "8c46ae5f-…", "reference": "BK-7140", "amount": "60.00", "display_status": "awaiting_payment", …}

curl -X POST http://localhost:8000/api/v1/bookings/8c46ae5f-…/payments \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "X-Client-Type: mobile" \
  -d '{"provider": "esewa", "return_url": "http://localhost:3000/bookings/8c46ae5f-…"}'
# → {"checkout_url": "http://localhost:8000/api/v1/payments/1d08eb85-…/esewa/checkout", …}
```

---

## 7. Database

### `bookings`

| Column | Notes |
| --- | --- |
| `id`, `seq`, `reference` | `reference` is shown to drivers, e.g. `BK-7140`. |
| `user_id`, `parking_id` | Who booked which facility. |
| `kind`, `parent_id` | `initial`, or `extension` linked to its booking. |
| `status` | `pending_payment`, `confirmed`, `expired`, `cancelled`. |
| `hours`, `price_per_hour`, `amount`, `currency` | Price fixed at booking time (NPR). |
| `vehicle_plate` | Optional. |
| `hold_expires_at` | End of the hold while paying. |
| `starts_at`, `ends_at`, `confirmed_at`, `cancelled_at` | Parking time and lifecycle. |
| `paid_payment_id` | The one payment that confirmed it (unique). |

A partial unique index (`uq_bookings_one_pending_hold`) allows only one unpaid hold per driver per
facility.

### `payments`

| Column | Notes |
| --- | --- |
| `id`, `booking_id`, `user_id`, `provider` | One row per attempt. |
| `status`, `amount` | See section 4. |
| `transaction_uuid` | Our id sent to the provider. Unique. |
| `provider_reference` | Khalti `pidx`. Unique per provider. |
| `provider_transaction_id` | eSewa `ref_id` / Khalti `transaction_id`. Unique per provider. |
| `checkout_url`, `provider_expires_at` | Where the driver pays; Khalti's session expiry. |
| `return_url`, `callback_base_url` | Where the driver comes back; the API address the provider redirects to. |
| `completed_at`, `last_checked_at`, `check_count` | Verification history. |
| `failure_reason` | e.g. `amount_mismatch`, `transaction_reused`, `cancelled`. |
| `reconciliation`, `reconciliation_note` | See section 5. |
| `provider_response` | The provider's last answer, without signatures or credentials. |

---

## 8. Configuration

All settings live in `backend/.env` (template: [backend/.env.example](backend/.env.example)). They are
read only by the backend and must never be put in the web or mobile app.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PAYMENTS_ENABLED` | `true` | Master switch for online booking. |
| `BOOKING_HOLD_MINUTES` | `15` | How long a space is held while paying. |
| `BOOKING_MAX_HOURS` | `12` | Longest booking or extension. |
| `BOOKING_ARRIVAL_WINDOW_MINUTES` | `20` | See 3.1 ("how free to book is counted"). |
| `PAYMENT_CALLBACK_BASE_URL` | empty | Public address of the API that providers send drivers back to, e.g. `https://api.parkmandu.gov.np/api/v1`. Empty in development: the address the app used to reach the API is used, which works on a laptop and on a phone on the same Wi-Fi. **Set it in production.** |
| `PAYMENT_RETURN_ORIGINS` | `http://localhost:3000` | Web origins drivers may be returned to (comma separated). |
| `PAYMENT_RETURN_SCHEMES` | `parkmandu,exp,exps` | Mobile app URL schemes (`exp` is Expo Go during development). |
| `WEB_APP_URL` | `http://localhost:3000` | Sent to Khalti as `website_url`. |
| `ESEWA_ENVIRONMENT` | `sandbox` | `sandbox` or `production` (picks the URLs below). |
| `ESEWA_PRODUCT_CODE` | — | Merchant code (`EPAYTEST` in the sandbox). |
| `ESEWA_SECRET_KEY` | — | Merchant secret for signatures. |
| `ESEWA_FORM_URL`, `ESEWA_STATUS_URL` | by environment | Optional overrides. |
| `KHALTI_ENVIRONMENT` | `sandbox` | `sandbox` or `production`. |
| `KHALTI_SECRET_KEY` | — | Merchant "live secret key". Khalti stays off until this is set. |
| `KHALTI_BASE_URL` | by environment | Optional override. |
| `PAYMENT_HTTP_TIMEOUT_SECONDS` | `15` | Timeout for provider calls. |

Default provider URLs:

| | Sandbox | Production |
| --- | --- | --- |
| eSewa form | `https://rc-epay.esewa.com.np/api/epay/main/v2/form` | `https://epay.esewa.com.np/api/epay/main/v2/form` |
| eSewa status | `https://rc.esewa.com.np/api/epay/transaction/status/` | `https://epay.esewa.com.np/api/epay/transaction/status/` |
| Khalti API | `https://dev.khalti.com/api/v2` | `https://khalti.com/api/v2` |

A provider without credentials is reported as disabled by `GET /payments/providers`, and the apps show
it greyed out as "Not available".

After changing `.env`, restart the backend (`docker compose up -d`, or restart `api`, `worker` and
`beat`).

---

## 9. Sandbox testing

### eSewa sandbox

Already configured in `backend/.env.example` with eSewa's public test merchant:

```env
ESEWA_ENVIRONMENT=sandbox
ESEWA_PRODUCT_CODE=EPAYTEST
ESEWA_SECRET_KEY=8gBm/:&EnhH.1/q
```

On eSewa's sandbox page, sign in with one of eSewa's published test accounts (eSewa ID such as
`9806800001`, password `Nepal@123`, token/OTP `123456`). Check eSewa's developer documentation for the
current list, as eSewa occasionally changes it.

### Khalti sandbox

1. Create a merchant account at https://test-admin.khalti.com.
2. Copy the **live secret key** from the Keys page into `backend/.env`:
   ```env
   KHALTI_ENVIRONMENT=sandbox
   KHALTI_SECRET_KEY=<your sandbox key>
   ```
3. Restart the backend. Khalti now shows as available.
4. Pay with one of Khalti's published test wallets (for example Khalti ID `9800000001`, MPIN `1111`,
   OTP `987654`). See Khalti's documentation for the current list.

### Try it end to end

1. Start the backend, web app and/or mobile app (see [README.md](README.md)).
2. Sign in as the demo public user `sita.sharma@example.com` / `ParkMandu@2026`.
3. Open a **paid** parking location, choose hours, choose eSewa or Khalti, and pay with a test account.
4. You return to the booking page showing "Payment successful" with the expiry time.
5. Try cancelling at the provider, paying twice in two tabs, or closing the browser mid-payment and
   pressing **Check payment status**: each outcome is described in sections 4 and 5.

### Automated tests

```bash
cd backend
docker compose exec api pytest -q
```

- [tests/test_feature_units.py](backend/tests/test_feature_units.py): signatures, callback checks,
  status mapping, Khalti paisa amounts, return-URL allow-list (no network or database).
- [tests/test_feature_flows.py](backend/tests/test_feature_flows.py): real database. Covers successful
  and failed eSewa/Khalti payments, cancellation, duplicate callbacks, wrong amounts, reused transactions,
  expired payments and holds, retries and double payment, two drivers racing for the last space, payment
  succeeding while confirmation fails (then reconciled), extensions, free parking, and the HTTP API.
  These tests script the provider's answer instead of moving real money.

---

## 10. Security summary

- **Secrets stay on the server.** eSewa and Khalti keys are only in `backend/.env`. The apps receive a
  checkout URL and nothing else. The eSewa page sent to the browser contains a signature, never the key.
- **The server decides the price.** Apps send only the number of hours; the amount comes from the
  facility's rate in the database.
- **Every payment is verified server-to-server** (eSewa status API, Khalti lookup) before a booking is
  confirmed. Redirect parameters are never trusted on their own. eSewa callback signatures are checked
  in constant time.
- **Exact amount check** in paisa, and the provider transaction id must be new.
- **Idempotent and race-safe:** row locks, a unique confirming payment per booking, unique transaction
  ids, and one unpaid hold per driver per facility. Duplicate callbacks, retries and the background job
  can run in any order.
- **No open redirects:** return URLs must match the configured web origins or app schemes.
- **Ownership checks:** drivers can only see and act on their own bookings; anyone else gets "not found".
- **Rate limits** on booking, payment start, verification and provider return URLs.
- **Strict CSP** on the eSewa checkout page: it can only submit to eSewa.
- **Audit trail:** administrator resolutions are written to the audit log; provider answers are kept
  (minus signatures) on each payment for support.
