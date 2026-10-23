from fastapi import APIRouter, HTTPException, status

from app.schemas.ai import (
    AIClassificationRequest,
    AIClassificationResponse,
    AIModelStatus,
)
from app.services.ollama import (
    OllamaModelNotFoundError,
    OllamaResponseValidationError,
    OllamaServiceError,
    OllamaServiceUnavailableError,
    OllamaTimeoutError,
    ollama_service,
)

router = APIRouter(prefix="/ai", tags=["Local AI"])


@router.get(
    "/status",
    response_model=AIModelStatus,
    status_code=status.HTTP_200_OK,
    summary="Get Ollama service and model availability status",
    description="Check whether local Ollama service is reachable and whether the configured Gemma model is installed.",
)
async def get_ai_status() -> AIModelStatus:
    return await ollama_service.get_service_status()


@router.post(
    "/classify",
    response_model=AIClassificationResponse,
    status_code=status.HTTP_200_OK,
    summary="Classify a file using local Ollama model",
    description="Analyze file metadata and safe content sample to produce validated structured category and filename suggestions.",
)
async def classify_file(
    request: AIClassificationRequest,
) -> AIClassificationResponse:
    try:
        return await ollama_service.classify_file(request)
    except OllamaServiceUnavailableError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(e),
        )
    except OllamaModelNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(e),
        )
    except OllamaTimeoutError as e:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=str(e),
        )
    except OllamaResponseValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Model returned invalid output: {str(e)}",
        )
    except OllamaServiceError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unexpected error during AI classification: {str(e)}",
        )
