from enum import Enum
from typing import Dict, List, Optional
from pydantic import BaseModel, Field


class FileCategory(str, Enum):
    DOCUMENTS = "documents"
    IMAGES = "images"
    VIDEOS = "videos"
    AUDIO = "audio"
    ARCHIVES = "archives"
    CODE = "code"
    OTHER = "other"


class FileMetadata(BaseModel):
    filename: str = Field(..., description="File name with extension")
    relative_path: str = Field(
        ...,
        description="Path relative to the root directory, normalized with forward slashes",
    )
    extension: str = Field(
        ...,
        description="Normalized lowercase file extension including dot, or empty string",
    )
    size_bytes: int = Field(..., ge=0, description="Size in bytes")
    modified_at: str = Field(..., description="ISO 8601 modification timestamp")
    category: FileCategory = Field(..., description="Extension-based category")


class SkippedEntry(BaseModel):
    path: str = Field(..., description="Path of skipped entry")
    reason: str = Field(..., description="Reason entry was skipped")


class ScanRequest(BaseModel):
    target_path: str = Field(
        ...,
        description="Explicit absolute directory path to scan",
        examples=["C:\\Users\\Username\\Documents"],
    )


class ScanResponse(BaseModel):
    scan_id: str = Field(..., description="Unique identifier for the scan")
    target_path: str = Field(..., description="Canonicalized absolute path scanned")
    status: str = Field(..., description="Scan status: 'completed' or 'failed'")
    scanned_at: str = Field(..., description="ISO 8601 scan start timestamp")
    total_files: int = Field(..., ge=0, description="Total files discovered")
    total_scanned_bytes: int = Field(..., ge=0, description="Total size in bytes of all files")
    category_counts: Dict[str, int] = Field(
        ..., description="File count breakdown by category"
    )
    files: List[FileMetadata] = Field(
        default_factory=list, description="Paginated/bounded list of files"
    )
    skipped_entries: List[SkippedEntry] = Field(
        default_factory=list, description="Entries skipped due to permissions or errors"
    )
    limit: int = Field(..., ge=1, description="Pagination page size")
    offset: int = Field(..., ge=0, description="Pagination offset")
    has_more: bool = Field(..., description="Whether more files exist beyond current page")
