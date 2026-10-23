from typing import Optional
from fastapi import APIRouter, HTTPException, Query, status

from app.schemas.operation import (
    ExecutedOperationItem,
    ExecutePlanRequest,
    ExecutionResponse,
    JournalQueryResponse,
    OperationStatus,
    UndoOperationResponse,
    UndoPlanResponse,
    UndoStatus,
)
from app.services.executor import execution_service
from app.services.journal import operation_journal

router = APIRouter(prefix="/operations", tags=["Operations & Undo"])


@router.post(
    "/execute",
    response_model=ExecutionResponse,
    status_code=status.HTTP_200_OK,
    summary="Execute an approved cleanup plan",
    description="Perform approved file moves and renames from a validated plan. Requires explicit confirmation approval.",
)
async def execute_plan(
    request: ExecutePlanRequest,
) -> ExecutionResponse:
    if not request.plan_id or not request.plan_id.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Plan identifier must not be empty.",
        )

    if not request.confirm_approval:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Explicit approval confirmation is required to execute a cleanup plan.",
        )

    try:
        return execution_service.execute_plan(request)
    except KeyError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )
    except ValueError as e:
        # Pre-execution revalidation failed (e.g. stale plan, file missing, or destination conflict)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Execution failed: {str(e)}",
        )


@router.get(
    "",
    response_model=JournalQueryResponse,
    status_code=status.HTTP_200_OK,
    summary="Query operations journal",
    description="Retrieve paginated records from the persistent SQLite operations journal.",
)
async def list_operations(
    plan_id: Optional[str] = Query(default=None, description="Filter records by plan ID"),
    limit: int = Query(default=100, ge=1, le=1000, description="Page limit"),
    offset: int = Query(default=0, ge=0, description="Page offset"),
) -> JournalQueryResponse:
    total, items = operation_journal.list_operations(
        plan_id=plan_id, limit=limit, offset=offset
    )
    return JournalQueryResponse(
        total=total,
        limit=limit,
        offset=offset,
        operations=items,
    )


@router.get(
    "/{operation_id}",
    response_model=ExecutedOperationItem,
    status_code=status.HTTP_200_OK,
    summary="Get single operation journal record",
    description="Retrieve a specific executed operation record by operation ID.",
)
async def get_operation(
    operation_id: str,
) -> ExecutedOperationItem:
    if not operation_id or not operation_id.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Operation identifier must not be empty.",
        )

    record = operation_journal.get_operation(operation_id.strip())
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Operation with ID '{operation_id}' not found in journal.",
        )

    return ExecutedOperationItem(
        operation_id=record["operation_id"],
        plan_id=record["plan_id"],
        original_path=record["original_path"],
        destination_path=record["destination_path"],
        operation_type=record["operation_type"],
        status=OperationStatus(record["status"]),
        error_message=record["error_message"],
        undo_status=UndoStatus(record["undo_status"]),
        timestamp=record["timestamp"],
        file_size_bytes=record["file_size_bytes"],
    )


@router.post(
    "/{operation_id}/undo",
    response_model=UndoOperationResponse,
    status_code=status.HTTP_200_OK,
    summary="Undo a specific completed operation",
    description="Safely reverse a completed move or rename operation if preconditions are met.",
)
async def undo_operation(
    operation_id: str,
) -> UndoOperationResponse:
    if not operation_id or not operation_id.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Operation identifier must not be empty.",
        )

    try:
        return execution_service.undo_operation(operation_id.strip())
    except KeyError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to undo operation: {str(e)}",
        )


@router.post(
    "/undo-plan/{plan_id}",
    response_model=UndoPlanResponse,
    status_code=status.HTTP_200_OK,
    summary="Undo all reversible operations in a plan",
    description="Safely reverse all eligible operations belonging to a plan in reverse chronological order.",
)
async def undo_plan(
    plan_id: str,
) -> UndoPlanResponse:
    if not plan_id or not plan_id.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Plan identifier must not be empty.",
        )

    try:
        return execution_service.undo_plan(plan_id.strip())
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to undo plan operations: {str(e)}",
        )
