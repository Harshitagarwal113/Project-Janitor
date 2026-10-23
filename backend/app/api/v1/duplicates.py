from fastapi import APIRouter, HTTPException, Query, status

from app.schemas.duplicate import (
    DuplicateAnalysisRequest,
    DuplicateAnalysisResponse,
)
from app.services.duplicate import duplicate_service

router = APIRouter(prefix="/duplicates", tags=["Duplicates"])


@router.post(
    "",
    response_model=DuplicateAnalysisResponse,
    status_code=status.HTTP_200_OK,
    summary="Analyze exact duplicates for a scan",
    description="Perform SHA-256 binary hash duplicate analysis on files from a previously executed scan.",
)
async def analyze_duplicates(
    request: DuplicateAnalysisRequest,
    refresh: bool = Query(default=False, description="Force re-analysis rather than using cached result"),
) -> DuplicateAnalysisResponse:
    if not request.scan_id or not request.scan_id.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Scan identifier must not be empty.",
        )

    try:
        return duplicate_service.analyze_duplicates(
            scan_id=request.scan_id.strip(), force_refresh=refresh
        )
    except KeyError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Duplicate analysis failed: {str(e)}",
        )


@router.get(
    "/{scan_id}",
    response_model=DuplicateAnalysisResponse,
    status_code=status.HTTP_200_OK,
    summary="Get duplicate analysis by scan ID",
    description="Retrieve exact duplicate analysis results for a previously executed scan by ID.",
)
async def get_duplicates_by_scan_id(
    scan_id: str,
    refresh: bool = Query(default=False, description="Force re-analysis rather than using cached result"),
) -> DuplicateAnalysisResponse:
    if not scan_id or not scan_id.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Scan identifier must not be empty.",
        )

    try:
        return duplicate_service.analyze_duplicates(
            scan_id=scan_id.strip(), force_refresh=refresh
        )
    except KeyError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Duplicate analysis failed: {str(e)}",
        )
