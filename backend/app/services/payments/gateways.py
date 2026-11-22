"""eSewa ePay v2 and Khalti ePayment (KPG-2) clients. Server side only: secrets never leave the API.

eSewa
  * The driver's browser POSTs a signed form to eSewa. The signature is
    base64(HMAC-SHA256(secret, "total_amount=<..>,transaction_uuid=<..>,product_code=<..>")).
  * eSewa sends the driver back to success_url with ?data=<base64 JSON>, itself signed over the fields
    named in its `signed_field_names`. That signature is checked, and then the payment is confirmed
    with eSewa's transaction status API. Only that server-to-server answer confirms a booking.

Khalti
  * The API asks Khalti for a payment session (POST /epayment/initiate/, amount in paisa) and sends the
    driver to the returned payment_url.
  * Khalti sends the driver back to return_url with ?pidx=...; the payment is then confirmed with
    POST /epayment/lookup/. The query string on the return URL is never trusted on its own.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Literal

import httpx

from app.core.config import settings

log = logging.getLogger(__name__)

ProviderState = Literal["completed", "pending", "failed", "cancelled", "expired", "refunded", "not_found"]

ESEWA_URLS = {
    "sandbox": (
        "https://rc-epay.esewa.com.np/api/epay/main/v2/form",
        "https://rc.esewa.com.np/api/epay/transaction/status/",
    ),
    "production": (
        "https://epay.esewa.com.np/api/epay/main/v2/form",
        "https://epay.esewa.com.np/api/epay/transaction/status/",
    ),
}
KHALTI_URLS = {"sandbox": "https://dev.khalti.com/api/v2", "production": "https://khalti.com/api/v2"}

# Khalti does not accept payments under Rs 10 (1000 paisa).
KHALTI_MIN_PAISA = 1000


class GatewayError(Exception):
    """The provider could not be reached or answered something unusable. Safe to retry later."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class SignatureError(Exception):
    """A callback's signature or contents do not match: it was not sent by the provider for this payment."""


@dataclass(frozen=True)
class ProviderResult:
    state: ProviderState
    amount: Decimal | None = None  # in rupees, as the provider reports it
    transaction_id: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


def to_paisa(amount: Decimal) -> int:
    return int((amount * 100).quantize(Decimal(1)))


def amount_text(amount: Decimal) -> str:
    """How amounts are written in the eSewa form. The signature covers exactly this text."""
    amount = amount.quantize(Decimal("0.01"))
    return str(int(amount)) if amount == amount.to_integral_value() else f"{amount:.2f}"


def parse_amount(value: object) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value).replace(",", "")).quantize(Decimal("0.01"))
    except InvalidOperation:
        return None


def _client() -> httpx.Client:
    return httpx.Client(timeout=settings.payment_http_timeout_seconds, follow_redirects=False)


# --------------------------------------------------------------------------- eSewa


class Esewa:
    def __init__(self, *, product_code: str, secret_key: str, form_url: str, status_url: str) -> None:
        self.product_code = product_code
        self._secret = secret_key.encode()
        self.form_url = form_url
        self.status_url = status_url

    @classmethod
    def from_settings(cls) -> Esewa:
        if not settings.esewa_enabled:
            raise GatewayError("provider_disabled", "eSewa is not configured on this server.")
        form_url, status_url = ESEWA_URLS[settings.esewa_environment]
        return cls(
            product_code=settings.esewa_product_code or "",
            secret_key=settings.esewa_secret_key or "",
            form_url=settings.esewa_form_url or form_url,
            status_url=settings.esewa_status_url or status_url,
        )

    def sign(self, message: str) -> str:
        return base64.b64encode(hmac.new(self._secret, message.encode(), hashlib.sha256).digest()).decode()

    def form_fields(
        self, *, transaction_uuid: str, amount: Decimal, success_url: str, failure_url: str
    ) -> dict[str, str]:
        total = amount_text(amount)
        signed = "total_amount,transaction_uuid,product_code"
        message = f"total_amount={total},transaction_uuid={transaction_uuid},product_code={self.product_code}"
        return {
            "amount": total,
            "tax_amount": "0",
            "product_service_charge": "0",
            "product_delivery_charge": "0",
            "total_amount": total,
            "transaction_uuid": transaction_uuid,
            "product_code": self.product_code,
            "success_url": success_url,
            "failure_url": failure_url,
            "signed_field_names": signed,
            "signature": self.sign(message),
        }

    def decode_callback(self, data: str, *, transaction_uuid: str) -> dict[str, Any]:
        """Decodes and authenticates the `data` eSewa appends to success_url. Raises SignatureError."""
        try:
            normalised = data.strip().replace("-", "+").replace("_", "/").replace(" ", "+")
            payload = json.loads(base64.b64decode(normalised + "=" * (-len(normalised) % 4), validate=True))
        except (binascii.Error, ValueError, UnicodeDecodeError) as exc:
            raise SignatureError("Callback data is not valid base64 JSON.") from exc
        if not isinstance(payload, dict):
            raise SignatureError("Callback data is not an object.")
        names = str(payload.get("signed_field_names", "")).split(",")
        if not names or "transaction_uuid" not in names or "total_amount" not in names:
            raise SignatureError("Callback does not sign the transaction and amount.")
        message = ",".join(f"{name}={payload.get(name, '')}" for name in names)
        if not hmac.compare_digest(self.sign(message), str(payload.get("signature", ""))):
            raise SignatureError("Callback signature does not match.")
        if payload.get("transaction_uuid") != transaction_uuid or payload.get("product_code") != self.product_code:
            raise SignatureError("Callback belongs to another transaction.")
        return payload

    def check_status(self, *, transaction_uuid: str, amount: Decimal) -> ProviderResult:
        params = {
            "product_code": self.product_code,
            "total_amount": amount_text(amount),
            "transaction_uuid": transaction_uuid,
        }
        try:
            with _client() as client:
                response = client.get(self.status_url, params=params)
        except httpx.HTTPError as exc:
            raise GatewayError("provider_unreachable", f"eSewa could not be reached: {exc}") from exc
        try:
            body = response.json()
        except ValueError as exc:
            raise GatewayError("provider_bad_response", f"eSewa answered {response.status_code} without JSON.") from exc
        if response.status_code >= 500 or not isinstance(body, dict):
            raise GatewayError("provider_error", f"eSewa status check failed ({response.status_code}).")
        status = str(body.get("status", "")).upper()
        if response.status_code == 404 or status == "NOT_FOUND":
            return ProviderResult("not_found", raw=_safe(body))
        if not status:
            raise GatewayError("provider_bad_response", f"eSewa answered {response.status_code} without a status.")
        state: ProviderState = {
            "COMPLETE": "completed",
            "PENDING": "pending",
            "AMBIGUOUS": "pending",
            "CANCELED": "cancelled",
            "FULL_REFUND": "refunded",
            "PARTIAL_REFUND": "refunded",
        }.get(status, "pending")
        if body.get("transaction_uuid") not in (None, transaction_uuid):
            raise GatewayError("provider_bad_response", "eSewa answered for another transaction.")
        return ProviderResult(
            state,
            amount=parse_amount(body.get("total_amount")),
            transaction_id=(str(body["ref_id"]) if body.get("ref_id") else None),
            raw=_safe(body),
        )


# --------------------------------------------------------------------------- Khalti

KHALTI_STATES: dict[str, ProviderState] = {
    "Completed": "completed",
    "Pending": "pending",
    "Initiated": "pending",
    "User canceled": "cancelled",
    "Expired": "expired",
    "Refunded": "refunded",
    "Partially Refunded": "refunded",
}


@dataclass(frozen=True)
class KhaltiSession:
    pidx: str
    payment_url: str
    expires_at: datetime | None


class Khalti:
    def __init__(self, *, secret_key: str, base_url: str) -> None:
        self._headers = {"Authorization": f"Key {secret_key}", "Content-Type": "application/json"}
        self.base_url = base_url.rstrip("/")

    @classmethod
    def from_settings(cls) -> Khalti:
        if not settings.khalti_enabled:
            raise GatewayError("provider_disabled", "Khalti is not configured on this server.")
        return cls(
            secret_key=settings.khalti_secret_key or "",
            base_url=settings.khalti_base_url or KHALTI_URLS[settings.khalti_environment],
        )

    def _post(self, path: str, body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        try:
            with _client() as client:
                response = client.post(f"{self.base_url}{path}", json=body, headers=self._headers)
        except httpx.HTTPError as exc:
            raise GatewayError("provider_unreachable", f"Khalti could not be reached: {exc}") from exc
        try:
            data = response.json()
        except ValueError as exc:
            raise GatewayError(
                "provider_bad_response", f"Khalti answered {response.status_code} without JSON."
            ) from exc
        if response.status_code == 401:
            log.error("Khalti rejected the merchant secret key (KHALTI_SECRET_KEY).")
            raise GatewayError("provider_auth_failed", "Khalti rejected this server's credentials.")
        if response.status_code >= 500:
            raise GatewayError("provider_error", f"Khalti failed ({response.status_code}).")
        return response.status_code, data if isinstance(data, dict) else {}

    def initiate(
        self,
        *,
        amount: Decimal,
        purchase_order_id: str,
        purchase_order_name: str,
        return_url: str,
        website_url: str,
        customer: dict[str, str],
    ) -> KhaltiSession:
        paisa = to_paisa(amount)
        status, data = self._post(
            "/epayment/initiate/",
            {
                "return_url": return_url,
                "website_url": website_url,
                "amount": paisa,
                "purchase_order_id": purchase_order_id,
                "purchase_order_name": purchase_order_name[:100],
                "customer_info": customer,
            },
        )
        if status != 200 or not data.get("pidx") or not data.get("payment_url"):
            detail = data.get("detail") or data.get("error_key") or data
            raise GatewayError("provider_rejected", f"Khalti refused the payment: {detail}")
        expires = data.get("expires_at")
        return KhaltiSession(
            pidx=str(data["pidx"]),
            payment_url=str(data["payment_url"]),
            expires_at=datetime.fromisoformat(expires) if isinstance(expires, str) else None,
        )

    def lookup(self, pidx: str) -> ProviderResult:
        status, data = self._post("/epayment/lookup/", {"pidx": pidx})
        if status in (400, 404):
            return ProviderResult("not_found", raw=_safe(data))
        if status != 200:
            raise GatewayError("provider_error", f"Khalti lookup failed ({status}).")
        if data.get("pidx") not in (None, pidx):
            raise GatewayError("provider_bad_response", "Khalti answered for another payment.")
        paisa = data.get("total_amount")
        return ProviderResult(
            KHALTI_STATES.get(str(data.get("status")), "pending"),
            amount=(Decimal(int(paisa)) / 100).quantize(Decimal("0.01")) if isinstance(paisa, int | float) else None,
            transaction_id=str(data["transaction_id"]) if data.get("transaction_id") else None,
            raw=_safe(data),
        )


def _safe(body: dict[str, Any]) -> dict[str, Any]:
    """What is kept of a provider answer: small, flat, never a credential."""
    return {k: v for k, v in body.items() if isinstance(v, str | int | float | bool | type(None)) and k != "signature"}
