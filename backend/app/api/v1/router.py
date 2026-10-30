from fastapi import APIRouter

from app.api.v1 import admin, applications, auth, files, geo, monitoring, notifications, parkings

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(parkings.router)
api_router.include_router(applications.router)
api_router.include_router(notifications.router)
api_router.include_router(files.router)
api_router.include_router(geo.router)
api_router.include_router(monitoring.router)
api_router.include_router(admin.router)
