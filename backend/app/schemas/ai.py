from typing import List, Optional
from pydantic import BaseModel, Field, field_validator

from app.schemas.scan import FileCategory


class AIModelStatus(BaseModel):
    service_available: bool = Field(
        ..., description="Whether the local Ollama service is reachable"
    )
    model_installed: bool = Field(
        ..., description="Whether the configured model is installed locally"
    )
    configured_model: str = Field(
        ..., description="Configured model name (e.g. gemma:2b)"
    )
    available_models: List[str] = Field(
        default_factory=list,
        description="List of locally installed model names reported by Ollama",
    )
    service_url: str = Field(..., description="Ollama API base URL")
    message: str = Field(
        ..., description="Human-readable status summary and configuration instructions"
    )


class AIClassificationRequest(BaseModel):
    filename: str = Field(
        ..., min_length=1, description="File name with extension to classify"
    )
    file_content: Optional[str] = Field(
        default=None,
        description="Optional text content sample from the file (will be truncated to safety limit)",
    )
    size_bytes: Optional[int] = Field(
        default=None, ge=0, description="Optional size in bytes"
    )
    extension: Optional[str] = Field(
        default=None, description="Optional lowercase extension including dot"
    )


class RawModelClassificationOutput(BaseModel):
    """Internal schema to strictly parse and validate raw JSON returned by Ollama."""
    suggested_category: str = Field(
        ..., description="Category suggested by the model"
    )
    suggested_filename: Optional[str] = Field(
        default=None, description="Optional suggested descriptive filename"
    )
    rationale: str = Field(
        ..., min_length=1, description="Short rationale for the classification"
    )
    confidence: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Confidence score between 0.0 and 1.0 inclusive",
    )

    @field_validator("suggested_category", mode="before")
    @classmethod
    def normalize_category(cls, v: str) -> str:
        if isinstance(v, str):
            clean = v.strip().lower()
            # Verify clean value is a valid FileCategory
            valid_cats = {cat.value for cat in FileCategory}
            if clean in valid_cats:
                return clean
        raise ValueError(
            f"Invalid category '{v}'. Must be one of: {[cat.value for cat in FileCategory]}"
        )

    @field_validator("confidence", mode="before")
    @classmethod
    def clamp_or_validate_confidence(cls, v: float) -> float:
        try:
            val = float(v)
        except (ValueError, TypeError):
            raise ValueError(f"Confidence score '{v}' is not a valid float.")
        if not (0.0 <= val <= 1.0):
            raise ValueError(f"Confidence score {val} must be between 0.0 and 1.0.")
        return round(val, 2)


class AIClassificationResponse(BaseModel):
    suggested_category: FileCategory = Field(
        ..., description="Validated suggested FileCategory"
    )
    suggested_filename: Optional[str] = Field(
        default=None, description="Optional descriptive filename suggested by AI"
    )
    rationale: str = Field(
        ..., min_length=1, description="Short rationale for the classification"
    )
    confidence: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Model confidence score between 0.0 and 1.0",
    )
    model_used: str = Field(
        ..., description="Ollama model name that performed the classification"
    )
    content_analyzed: bool = Field(
        ...,
        description="Whether file text content was analyzed or filename/metadata only",
    )
