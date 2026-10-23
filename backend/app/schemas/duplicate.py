from typing import List, Optional
from pydantic import BaseModel, Field

from app.schemas.scan import SkippedEntry


class DuplicateFileItem(BaseModel):
    filename: str = Field(..., description="File name with extension")
    relative_path: str = Field(
        ...,
        description="Path relative to the root directory, normalized with forward slashes",
    )
    size_bytes: int = Field(..., ge=0, description="Size in bytes")
    modified_at: str = Field(..., description="ISO 8601 modification timestamp")
    category: Optional[str] = Field(
        default=None, description="Extension-based category if available"
    )


class DuplicateGroup(BaseModel):
    group_id: str = Field(
        ..., description="Unique identifier for the duplicate group"
    )
    hash: str = Field(..., description="Verified SHA-256 hex digest of file contents")
    size_bytes: int = Field(
        ..., ge=0, description="Size of each individual file in the group in bytes"
    )
    file_count: int = Field(
        ..., ge=2, description="Number of exact duplicate files in this group"
    )
    reclaimable_bytes: int = Field(
        ...,
        ge=0,
        description="Conservative reclaimable bytes: (file_count - 1) * size_bytes",
    )
    files: List[DuplicateFileItem] = Field(
        ..., min_length=2, description="Files belonging to this duplicate group"
    )


class DuplicateAnalysisRequest(BaseModel):
    scan_id: str = Field(
        ...,
        description="Valid scan identifier from a previously executed scan",
        examples=["550e8400-e29b-41d4-a716-446655440000"],
    )


class DuplicateAnalysisResponse(BaseModel):
    scan_id: str = Field(..., description="Identifier of the analyzed scan")
    target_path: str = Field(
        ..., description="Canonicalized absolute path of the scanned directory"
    )
    analyzed_at: str = Field(..., description="ISO 8601 analysis timestamp")
    total_groups: int = Field(
        ..., ge=0, description="Total number of duplicate groups detected"
    )
    total_duplicate_files: int = Field(
        ..., ge=0, description="Total count of duplicate files across all groups"
    )
    reclaimable_bytes: int = Field(
        ..., ge=0, description="Total conservative reclaimable bytes across all groups"
    )
    groups: List[DuplicateGroup] = Field(
        default_factory=list, description="List of exact duplicate groups"
    )
    skipped_files: List[SkippedEntry] = Field(
        default_factory=list,
        description="Files skipped during hashing due to errors or mutations",
    )
