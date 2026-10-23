from fastapi import APIRouter, HTTPException, status

from app.schemas.plan import (
    CleanupPlanRequest,
    CleanupPlanResponse,
)
from app.services.plan import cleanup_plan_service

router = APIRouter(prefix="/plans", tags=["Cleanup Plans"])


@router.post(
    "",
    response_model=CleanupPlanResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Generate a proposed cleanup plan",
    description="Generate a dry-run filesystem cleanup plan using scan metadata, duplicate detection, and optional local Gemma AI classification. NEVER executes or modifies files.",
)
async def create_cleanup_plan(
    request: CleanupPlanRequest,
) -> CleanupPlanResponse:
    if not request.scan_id or not request.scan_id.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Scan identifier must not be empty.",
        )

    try:
        return await cleanup_plan_service.generate_plan(request)
    except KeyError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate cleanup plan: {str(e)}",
        )


@router.get(
    "/{plan_id}",
    response_model=CleanupPlanResponse,
    status_code=status.HTTP_200_OK,
    summary="Get cleanup plan by ID",
    description="Retrieve a previously generated dry-run cleanup plan by its unique identifier.",
)
async def get_cleanup_plan(
    plan_id: str,
) -> CleanupPlanResponse:
    if not plan_id or not plan_id.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Plan identifier must not be empty.",
        )

    plan = cleanup_plan_service.get_plan(plan_id.strip())
    if not plan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Cleanup plan with ID '{plan_id}' not found.",
        )

    return plan
