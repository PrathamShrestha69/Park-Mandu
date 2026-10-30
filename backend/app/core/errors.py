from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from starlette.exceptions import HTTPException as StarletteHTTPException


class AppError(Exception):
    """Domain error rendered as {"error": {"code", "message", "fields"}}."""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        fields: dict[str, str] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message
        self.fields = fields
        self.headers = headers


def not_found(entity: str = "Resource") -> AppError:
    return AppError(status.HTTP_404_NOT_FOUND, "not_found", f"{entity} not found.")


def forbidden(message: str = "You do not have permission to perform this action.") -> AppError:
    return AppError(status.HTTP_403_FORBIDDEN, "forbidden", message)


def conflict(message: str, code: str = "conflict") -> AppError:
    return AppError(status.HTTP_409_CONFLICT, code, message)


def unprocessable(message: str, fields: dict[str, str] | None = None) -> AppError:
    return AppError(status.HTTP_422_UNPROCESSABLE_ENTITY, "validation_error", message, fields)


def _body(code: str, message: str, fields: dict[str, str] | None = None) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "fields": fields or {}}}


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=_body(exc.code, exc.message, exc.fields),
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        fields: dict[str, str] = {}
        for err in exc.errors():
            loc = [str(part) for part in err.get("loc", ()) if part not in ("body", "query", "path")]
            key = ".".join(loc) or "non_field"
            message = str(err.get("msg", "Invalid value")).removeprefix("Value error, ")
            fields.setdefault(key, message)
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=jsonable_encoder(_body("validation_error", "Please check the highlighted fields.", fields)),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {401: "unauthorized", 403: "forbidden", 404: "not_found", 405: "method_not_allowed"}.get(
            exc.status_code, "http_error"
        )
        return JSONResponse(
            status_code=exc.status_code,
            content=_body(code, str(exc.detail)),
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(RateLimitExceeded)
    async def _rate_limited(_: Request, exc: RateLimitExceeded) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content=_body("rate_limited", f"Too many requests. Limit: {exc.detail}. Please try again shortly."),
            headers={"Retry-After": "60"},
        )
