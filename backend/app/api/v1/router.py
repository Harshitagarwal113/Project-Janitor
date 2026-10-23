from fastapi import APIRouter

from app.api.v1.ai import router as ai_router
from app.api.v1.duplicates import router as duplicates_router
from app.api.v1.operations import router as operations_router
from app.api.v1.plans import router as plans_router
from app.api.v1.scan import router as scan_router

api_router = APIRouter()
api_router.include_router(scan_router)
api_router.include_router(duplicates_router)
api_router.include_router(ai_router)
api_router.include_router(plans_router)
api_router.include_router(operations_router)


