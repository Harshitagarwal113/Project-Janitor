from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field


class OperationStatus(str, Enum):
    COMPLETED = "completed"
    FAILED = "failed"
    UNDONE = "undone"
    SKIPPED = "skipped"


class UndoStatus(str, Enum):
    REVERSIBLE = "reversible"
    UNDONE = "undone"
    BLOCKED = "blocked"
    UNREVERSIBLE = "unreversible"


class ExecutePlanRequest(BaseModel):
    plan_id: str = Field(
        ...,
        min_length=1,
        description="Unique identifier of the approved cleanup plan to execute",
        examples=["550e8400-e29b-41d4-a716-446655440000"],
    )
    confirm_approval: bool = Field(
        ...,
        description="Explicit user approval confirmation. Must be explicitly True.",
    )


class ExecutedOperationItem(BaseModel):
    operation_id: str = Field(..., description="Unique operation identifier")
    plan_id: str = Field(..., description="Associated cleanup plan identifier")
    original_path: str = Field(..., description="Original relative file path")
    destination_path: Optional[str] = Field(
        default=None, description="Destination relative file path"
    )
    operation_type: str = Field(
        ..., description="Operation type: MOVE, RENAME, MOVE_AND_RENAME"
    )
    status: OperationStatus = Field(..., description="Execution status")
    error_message: Optional[str] = Field(
        default=None, description="Error message if operation failed"
    )
    undo_status: UndoStatus = Field(
        ..., description="Reversibility state: reversible, undone, blocked, unreversible"
    )
    timestamp: str = Field(..., description="ISO 8601 execution timestamp")
    file_size_bytes: int = Field(default=0, ge=0, description="File size in bytes")


class ExecutionResponse(BaseModel):
    plan_id: str = Field(..., description="Plan identifier that was executed")
    executed_at: str = Field(..., description="ISO 8601 timestamp of execution")
    status: str = Field(
        ...,
        description="Execution overall status: 'completed', 'partially_completed', 'failed'",
    )
    total_planned: int = Field(..., ge=0, description="Total executable operations planned")
    successful_operations: int = Field(..., ge=0, description="Number of successful operations")
    failed_operations: int = Field(..., ge=0, description="Number of failed operations")
    skipped_operations: int = Field(..., ge=0, description="Number of skipped operations")
    operations: List[ExecutedOperationItem] = Field(
        default_factory=list, description="Detailed records of executed operations"
    )


class UndoOperationResponse(BaseModel):
    operation_id: str = Field(..., description="Identifier of the undone operation")
    status: UndoStatus = Field(..., description="Result status: undone, blocked, failed")
    original_path: str = Field(..., description="Restored original relative path")
    destination_path: str = Field(..., description="Source destination relative path")
    message: str = Field(..., description="Human-readable result or error description")


class UndoPlanResponse(BaseModel):
    plan_id: str = Field(..., description="Identifier of the plan whose operations were undone")
    total_operations: int = Field(..., ge=0, description="Total reversible operations in plan")
    undone_operations: int = Field(..., ge=0, description="Number of operations successfully undone")
    blocked_operations: int = Field(..., ge=0, description="Number of operations blocked")
    failed_operations: int = Field(..., ge=0, description="Number of operations failed")
    results: List[UndoOperationResponse] = Field(
        default_factory=list, description="Individual undo operation results"
    )


class JournalQueryResponse(BaseModel):
    total: int = Field(..., ge=0, description="Total matching journal records")
    limit: int = Field(..., ge=1, description="Page limit")
    offset: int = Field(..., ge=0, description="Page offset")
    operations: List[ExecutedOperationItem] = Field(
        default_factory=list, description="Paginated journal records"
    )
