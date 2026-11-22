from fastapi import APIRouter

from app.api.v1 import (
    admin,
    applications,
    auth,
    bookings,
    files,
    geo,
    monitoring,
    notifications,
    owner,
    parkings,
    realtime,
    routes,
    suggestions,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(parkings.router)
api_router.include_router(owner.router)
api_router.include_router(applications.router)
api_router.include_router(notifications.router)
api_router.include_router(files.router)
api_router.include_router(geo.router)
api_router.include_router(monitoring.router)
api_router.include_router(admin.router)
api_router.include_router(suggestions.router)
api_router.include_router(realtime.router)
api_router.include_router(bookings.router)
api_router.include_router(routes.router)
