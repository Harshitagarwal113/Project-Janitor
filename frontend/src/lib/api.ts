import type {
  AIModelStatus,
  CleanupPlanRequest,
  CleanupPlanResponse,
  DuplicateAnalysisRequest,
  DuplicateAnalysisResponse,
  ExecutedOperationItem,
  ExecutePlanRequest,
  ExecutionResponse,
  JournalQueryResponse,
  OrganizationPreferences,
  ScanRequest,
  ScanResponse,
  UndoOperationResponse,
  UndoPlanResponse,
} from '../types';


/**
 * Backend API Base URL configuration.
 * Configured via Vite environment variable VITE_API_BASE_URL with local fallback.
 * Default: http://127.0.0.1:8000
 */
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

export class ApiClientError extends Error {
  public statusCode: number;
  public detail: string;

  constructor(statusCode: number, detail: string) {
    super(detail);
    this.name = 'ApiClientError';
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

/**
 * Helper to process HTTP responses with JSON error parsing.
 */
async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorDetail = `Request failed with status ${response.status}`;
    try {
      const errorJson = await response.json();
      if (errorJson && typeof errorJson.detail === 'string') {
        errorDetail = errorJson.detail;
      } else if (errorJson && typeof errorJson.message === 'string') {
        errorDetail = errorJson.message;
      }
    } catch {
      // Use fallback errorDetail if JSON parsing fails
    }
    throw new ApiClientError(response.status, errorDetail);
  }

  return response.json() as Promise<T>;
}

/**
 * Helper to wrap network fetch and translate connection failures.
 */
async function safeFetch(url: string, options: RequestInit): Promise<Response> {
  try {
    return await fetch(url, options);
  } catch (err: unknown) {
    const errorMsg =
      err instanceof Error ? err.message : 'Unknown network failure';
    throw new ApiClientError(
      0,
      `Unable to reach backend service at ${API_BASE_URL} (${errorMsg}). Please verify that the Project Janitor backend server is running.`
    );
  }
}

export const apiClient = {
  /**
   * Health check endpoint to verify backend connectivity.
   */
  async getHealth(): Promise<{ status: string; service: string }> {
    const url = `${API_BASE_URL}/health`;
    const response = await safeFetch(url, { method: 'GET' });
    return handleResponse<{ status: string; service: string }>(response);
  },

  /**
   * Submit an absolute directory path to scan.
   * Calls POST /api/v1/scan
   */
  async startScan(
    targetPath: string,
    limit = 100,
    offset = 0
  ): Promise<ScanResponse> {
    const trimmedPath = targetPath.trim();
    if (!trimmedPath) {
      throw new ApiClientError(400, 'Please enter a valid directory path.');
    }

    const payload: ScanRequest = {
      target_path: trimmedPath,
    };

    const queryParams = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });

    const url = `${API_BASE_URL}/api/v1/scan?${queryParams.toString()}`;
    const response = await safeFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    return handleResponse<ScanResponse>(response);
  },

  /**
   * Retrieve paginated results for an existing scan by scan_id.
   * Calls GET /api/v1/scan/{scan_id}
   */
  async getScanResults(
    scanId: string,
    limit = 100,
    offset = 0
  ): Promise<ScanResponse> {
    if (!scanId || !scanId.trim()) {
      throw new ApiClientError(400, 'Scan identifier must not be empty.');
    }

    const queryParams = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });

    const url = `${API_BASE_URL}/api/v1/scan/${encodeURIComponent(
      scanId.trim()
    )}?${queryParams.toString()}`;

    const response = await safeFetch(url, {
      method: 'GET',
    });

    return handleResponse<ScanResponse>(response);
  },

  /**
   * Request exact SHA-256 duplicate analysis for a completed scan.
   * Calls POST /api/v1/duplicates
   */
  async analyzeDuplicates(
    scanId: string,
    refresh = false
  ): Promise<DuplicateAnalysisResponse> {
    if (!scanId || !scanId.trim()) {
      throw new ApiClientError(400, 'Scan identifier must not be empty.');
    }

    const payload: DuplicateAnalysisRequest = {
      scan_id: scanId.trim(),
    };

    const queryParams = refresh ? '?refresh=true' : '';
    const url = `${API_BASE_URL}/api/v1/duplicates${queryParams}`;
    const response = await safeFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    return handleResponse<DuplicateAnalysisResponse>(response);
  },

  /**
   * Retrieve exact duplicate analysis results by scan ID.
   * Calls GET /api/v1/duplicates/{scan_id}
   */
  async getDuplicateAnalysis(
    scanId: string,
    refresh = false
  ): Promise<DuplicateAnalysisResponse> {
    if (!scanId || !scanId.trim()) {
      throw new ApiClientError(400, 'Scan identifier must not be empty.');
    }

    const queryParams = refresh ? '?refresh=true' : '';
    const url = `${API_BASE_URL}/api/v1/duplicates/${encodeURIComponent(
      scanId.trim()
    )}${queryParams}`;

    const response = await safeFetch(url, {
      method: 'GET',
    });

    return handleResponse<DuplicateAnalysisResponse>(response);
  },

  /**
   * Check local Ollama AI status and configured Gemma model presence.
   * Calls GET /api/v1/ai/status
   */
  async getAIStatus(): Promise<AIModelStatus> {
    const url = `${API_BASE_URL}/api/v1/ai/status`;
    const response = await safeFetch(url, { method: 'GET' });
    return handleResponse<AIModelStatus>(response);
  },

  /**
   * Request dry-run cleanup plan generation for an existing scan.
   * Calls POST /api/v1/plans
   */
  async createCleanupPlan(
    scanId: string,
    preferences?: OrganizationPreferences
  ): Promise<CleanupPlanResponse> {
    if (!scanId || !scanId.trim()) {
      throw new ApiClientError(400, 'Scan identifier must not be empty.');
    }

    const payload: CleanupPlanRequest = {
      scan_id: scanId.trim(),
      preferences,
    };

    const url = `${API_BASE_URL}/api/v1/plans`;
    const response = await safeFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    return handleResponse<CleanupPlanResponse>(response);
  },

  /**
   * Retrieve an existing cleanup plan by plan_id.
   * Calls GET /api/v1/plans/{plan_id}
   */
  async getCleanupPlan(planId: string): Promise<CleanupPlanResponse> {
    if (!planId || !planId.trim()) {
      throw new ApiClientError(400, 'Plan identifier must not be empty.');
    }

    const url = `${API_BASE_URL}/api/v1/plans/${encodeURIComponent(planId.trim())}`;
    const response = await safeFetch(url, { method: 'GET' });
    return handleResponse<CleanupPlanResponse>(response);
  },

  /**
   * Execute an approved cleanup plan.
   * Calls POST /api/v1/operations/execute
   */
  async executePlan(
    planId: string,
    confirmApproval = true
  ): Promise<ExecutionResponse> {
    if (!planId || !planId.trim()) {
      throw new ApiClientError(400, 'Plan identifier must not be empty.');
    }

    const payload: ExecutePlanRequest = {
      plan_id: planId.trim(),
      confirm_approval: confirmApproval,
    };

    const url = `${API_BASE_URL}/api/v1/operations/execute`;
    const response = await safeFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    return handleResponse<ExecutionResponse>(response);
  },

  /**
   * Query the SQLite operations journal.
   * Calls GET /api/v1/operations
   */
  async listOperations(
    planId?: string,
    limit = 100,
    offset = 0
  ): Promise<JournalQueryResponse> {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    if (planId) {
      params.set('plan_id', planId);
    }

    const url = `${API_BASE_URL}/api/v1/operations?${params.toString()}`;
    const response = await safeFetch(url, { method: 'GET' });
    return handleResponse<JournalQueryResponse>(response);
  },

  /**
   * Retrieve a single operation journal record.
   * Calls GET /api/v1/operations/{operation_id}
   */
  async getOperation(operationId: string): Promise<ExecutedOperationItem> {
    if (!operationId || !operationId.trim()) {
      throw new ApiClientError(400, 'Operation identifier must not be empty.');
    }

    const url = `${API_BASE_URL}/api/v1/operations/${encodeURIComponent(
      operationId.trim()
    )}`;
    const response = await safeFetch(url, { method: 'GET' });
    return handleResponse<ExecutedOperationItem>(response);
  },

  /**
   * Undo a single completed reversible operation.
   * Calls POST /api/v1/operations/{operation_id}/undo
   */
  async undoOperation(operationId: string): Promise<UndoOperationResponse> {
    if (!operationId || !operationId.trim()) {
      throw new ApiClientError(400, 'Operation identifier must not be empty.');
    }

    const url = `${API_BASE_URL}/api/v1/operations/${encodeURIComponent(
      operationId.trim()
    )}/undo`;
    const response = await safeFetch(url, {
      method: 'POST',
    });

    return handleResponse<UndoOperationResponse>(response);
  },

  /**
   * Undo all eligible reversible operations belonging to a plan.
   * Calls POST /api/v1/operations/undo-plan/{plan_id}
   */
  async undoPlan(planId: string): Promise<UndoPlanResponse> {
    if (!planId || !planId.trim()) {
      throw new ApiClientError(400, 'Plan identifier must not be empty.');
    }

    const url = `${API_BASE_URL}/api/v1/operations/undo-plan/${encodeURIComponent(
      planId.trim()
    )}`;
    const response = await safeFetch(url, {
      method: 'POST',
    });

    return handleResponse<UndoPlanResponse>(response);
  },
};

