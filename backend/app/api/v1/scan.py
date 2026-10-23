from fastapi import APIRouter, HTTPException, Query, status

from app.schemas.scan import ScanRequest, ScanResponse
from app.services.scanner import scanner_service

router = APIRouter(prefix="/scan", tags=["Scanner"])


@router.post(
    "",
    response_model=ScanResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Start a filesystem scan",
    description="Scan an explicitly provided absolute directory and return metadata with initial page of results.",
)
async def create_scan(
    request: ScanRequest,
    limit: int = Query(default=100, ge=1, le=1000, description="Page size limit"),
    offset: int = Query(default=0, ge=0, description="Page offset"),
) -> ScanResponse:
    try:
        record = scanner_service.scan(request.target_path)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)
        )
    except FileNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(e)
        )
    except NotADirectoryError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)
        )
    except PermissionError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Filesystem scan failed: {str(e)}",
        )

    return scanner_service.paginate(record, limit=limit, offset=offset)


@router.get(
    "/{scan_id}",
    response_model=ScanResponse,
    summary="Get scan results",
    description="Retrieve results and metadata of a previously executed scan by ID with pagination.",
)
async def get_scan(
    scan_id: str,
    limit: int = Query(default=100, ge=1, le=1000, description="Page size limit"),
    offset: int = Query(default=0, ge=0, description="Page offset"),
) -> ScanResponse:
    record = scanner_service.get_scan(scan_id)
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Scan with ID '{scan_id}' not found.",
        )

    return scanner_service.paginate(record, limit=limit, offset=offset)
