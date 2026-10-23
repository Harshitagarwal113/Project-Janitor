from enum import Enum
from typing import Dict, List, Optional
from pydantic import BaseModel, Field

from app.schemas.scan import FileCategory


class PlanActionType(str, Enum):
    MOVE = "MOVE"
    RENAME = "RENAME"
    MOVE_AND_RENAME = "MOVE_AND_RENAME"
    SKIP = "SKIP"
    DUPLICATE_FLAG = "DUPLICATE_FLAG"


class OrganizationPreferences(BaseModel):
    preset: str = Field(
        default="category",
        description="Organization structure preset: 'category' (organize by category folders) or 'extension' (organize by extension)",
    )
    target_folder_prefix: str = Field(
        default="",
        description="Optional parent folder within the scan root for organized files (e.g. 'Organized')",
    )
    custom_category_folders: Optional[Dict[str, str]] = Field(
        default=None,
        description="Optional custom folder names per category (e.g. {'documents': 'Docs'})",
    )
    use_ai: bool = Field(
        default=False,
        description="Whether to consult local Gemma AI model for ambiguous files if available",
    )
    flag_duplicates: bool = Field(
        default=True,
        description="Whether to query duplicate analysis and flag redundant copies for review",
    )


class CleanupPlanItem(BaseModel):
    item_id: str = Field(..., description="Unique identifier for this plan item")
    original_path: str = Field(
        ..., description="Current relative path of the file from scan root"
    )
    proposed_path: Optional[str] = Field(
        default=None,
        description="Proposed relative path within the scan root, or None if skipped/flagged",
    )
    action: PlanActionType = Field(
        ..., description="Proposed action type: MOVE, RENAME, MOVE_AND_RENAME, SKIP, DUPLICATE_FLAG"
    )
    category: FileCategory = Field(
        ..., description="File category (e.g. documents, images, code)"
    )
    size_bytes: int = Field(..., ge=0, description="Size in bytes")
    reason: str = Field(
        ..., description="Human-readable explanation of why this action was proposed"
    )
    confidence: float = Field(
        default=1.0,
        ge=0.0,
        le=1.0,
        description="Confidence score between 0.0 and 1.0",
    )
    is_ai_suggested: bool = Field(
        default=False,
        description="Whether this recommendation was suggested by local AI",
    )
    has_conflict: bool = Field(
        default=False,
        description="Whether a destination naming conflict was detected and resolved",
    )


class CleanupPlanSummary(BaseModel):
    total_files: int = Field(..., ge=0, description="Total scanned files considered")
    moves: int = Field(..., ge=0, description="Total proposed moves")
    renames: int = Field(..., ge=0, description="Total proposed renames")
    skips: int = Field(..., ge=0, description="Total files proposed to be skipped")
    duplicates_flagged: int = Field(
        ..., ge=0, description="Total duplicate files flagged for manual review"
    )
    ai_suggestions_used: int = Field(
        ..., ge=0, description="Number of items where AI suggestions were applied"
    )
    conflicts_resolved: int = Field(
        ..., ge=0, description="Number of filename/destination collisions resolved"
    )


class CleanupPlanRequest(BaseModel):
    scan_id: str = Field(
        ...,
        description="Valid scan identifier from a previously executed scan",
        examples=["550e8400-e29b-41d4-a716-446655440000"],
    )
    preferences: Optional[OrganizationPreferences] = Field(
        default=None, description="Organization preferences and presets"
    )


class CleanupPlanResponse(BaseModel):
    plan_id: str = Field(..., description="Unique identifier for the generated cleanup plan")
    scan_id: str = Field(..., description="Identifier of the source scan")
    target_path: str = Field(
        ..., description="Canonicalized absolute path of the authorized scan root"
    )
    created_at: str = Field(..., description="ISO 8601 creation timestamp")
    summary: CleanupPlanSummary = Field(..., description="Summary statistics of proposed actions")
    items: List[CleanupPlanItem] = Field(
        default_factory=list, description="Ordered list of proposed plan operations"
    )
