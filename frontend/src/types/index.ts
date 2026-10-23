export type NavScreenId =
  | 'dashboard'
  | 'scanning'
  | 'results'
  | 'duplicates'
  | 'cleanup'
  | 'history'
  | 'settings';

export type FileCategory =
  | 'documents'
  | 'images'
  | 'videos'
  | 'audio'
  | 'archives'
  | 'code'
  | 'other';

/**
 * File metadata returned directly from the backend filesystem scanner.
 * Matches backend app.schemas.scan.FileMetadata.
 */
export interface FileMetadata {
  id?: string;
  filename: string;
  relative_path: string;
  extension: string;
  size_bytes: number;
  modified_at: string;
  category: FileCategory;
}

/**
 * Scanned file with required id for UI tracking.
 */
export interface ScannedFile extends FileMetadata {
  id: string;
}

/**
 * Entry skipped during scanning due to permissions, path safety, or errors.
 * Matches backend app.schemas.scan.SkippedEntry.
 */
export interface SkippedEntry {
  path: string;
  reason: string;
}

/**
 * Scan submission payload.
 * Matches backend app.schemas.scan.ScanRequest.
 */
export interface ScanRequest {
  target_path: string;
}

/**
 * Full scan response with pagination and summaries.
 * Matches backend app.schemas.scan.ScanResponse.
 */
export interface ScanResponse {
  scan_id: string;
  target_path: string;
  status: 'completed' | 'failed' | string;
  scanned_at: string;
  total_files: number;
  total_scanned_bytes: number;
  category_counts: Record<string, number>;
  files: FileMetadata[];
  skipped_entries: SkippedEntry[];
  limit: number;
  offset: number;
  has_more: boolean;
}

/**
 * Item in a duplicate group returned by the backend duplicate detection engine.
 * Matches backend app.schemas.duplicate.DuplicateFileItem.
 */
export interface DuplicateFileItem {
  filename: string;
  relative_path: string;
  size_bytes: number;
  modified_at: string;
  category?: FileCategory | string;
}

/**
 * Exact duplicate group verified by SHA-256.
 * Matches backend app.schemas.duplicate.DuplicateGroup.
 */
export interface DuplicateGroup {
  group_id: string;
  hash: string;
  size_bytes: number;
  file_count: number;
  reclaimable_bytes: number;
  files: DuplicateFileItem[];
}

/**
 * Request payload for duplicate analysis.
 * Matches backend app.schemas.duplicate.DuplicateAnalysisRequest.
 */
export interface DuplicateAnalysisRequest {
  scan_id: string;
}

/**
 * Full response from duplicate analysis API.
 * Matches backend app.schemas.duplicate.DuplicateAnalysisResponse.
 */
export interface DuplicateAnalysisResponse {
  scan_id: string;
  target_path: string;
  analyzed_at: string;
  total_groups: number;
  total_duplicate_files: number;
  reclaimable_bytes: number;
  groups: DuplicateGroup[];
  skipped_files: SkippedEntry[];
}

/**
 * Local AI / Ollama service status.
 * Matches backend app.schemas.ai.AIModelStatus.
 */
export interface AIModelStatus {
  service_available: boolean;
  model_installed: boolean;
  configured_model: string;
  available_models: string[];
  service_url: string;
  message: string;
}

export type PlanActionType =
  | 'MOVE'
  | 'RENAME'
  | 'MOVE_AND_RENAME'
  | 'SKIP'
  | 'DUPLICATE_FLAG';

export interface OrganizationPreferences {
  preset?: string;
  target_folder_prefix?: string;
  custom_category_folders?: Record<string, string>;
  use_ai?: boolean;
  flag_duplicates?: boolean;
}

/**
 * Item in a cleanup plan proposed by the backend planner.
 * Matches backend app.schemas.plan.CleanupPlanItem.
 */
export interface CleanupPlanItem {
  item_id: string;
  id?: string; // Optional alias for UI compatibility
  filename?: string; // Optional alias
  path?: string; // Optional alias
  original_path: string;
  proposed_path: string | null;
  action: PlanActionType | string;
  category: FileCategory;
  size_bytes: number;
  reason: string;
  confidence: number | 'high' | 'medium' | 'low';
  is_ai_suggested?: boolean;
  has_conflict?: boolean;
  selected?: boolean;
}

export interface CleanupPlanSummary {
  total_files: number;
  moves: number;
  renames: number;
  skips: number;
  duplicates_flagged: number;
  ai_suggestions_used: number;
  conflicts_resolved: number;
}

export interface CleanupPlanRequest {
  scan_id: string;
  preferences?: OrganizationPreferences;
}

/**
 * Full cleanup plan response from POST /api/v1/plans or GET /api/v1/plans/{plan_id}.
 * Matches backend app.schemas.plan.CleanupPlanResponse.
 */
export interface CleanupPlanResponse {
  plan_id: string;
  scan_id: string;
  target_path: string;
  created_at: string;
  summary: CleanupPlanSummary;
  items: CleanupPlanItem[];
}

export type OperationStatus =
  | 'completed'
  | 'failed'
  | 'undone'
  | 'skipped';

export type UndoStatus =
  | 'reversible'
  | 'undone'
  | 'blocked'
  | 'unreversible';

export interface ExecutePlanRequest {
  plan_id: string;
  confirm_approval: boolean;
}

export interface ExecutedOperationItem {
  operation_id: string;
  plan_id: string;
  original_path: string;
  destination_path: string | null;
  operation_type: string;
  status: OperationStatus;
  error_message: string | null;
  undo_status: UndoStatus;
  timestamp: string;
  file_size_bytes: number;
}

export interface ExecutionResponse {
  plan_id: string;
  executed_at: string;
  status: 'completed' | 'partially_completed' | 'failed' | string;
  total_planned: number;
  successful_operations: number;
  failed_operations: number;
  skipped_operations: number;
  operations: ExecutedOperationItem[];
}

export interface UndoOperationResponse {
  operation_id: string;
  status: UndoStatus;
  original_path: string;
  destination_path: string;
  message: string;
}

export interface UndoPlanResponse {
  plan_id: string;
  total_operations: number;
  undone_operations: number;
  blocked_operations: number;
  failed_operations: number;
  results: UndoOperationResponse[];
}

export interface JournalQueryResponse {
  total: number;
  limit: number;
  offset: number;
  operations: ExecutedOperationItem[];
}

export interface HistoryOperation {
  id: string;
  timestamp: string;
  operationType: 'SCAN' | 'CLEANUP' | 'DUPLICATE_PURGE' | 'ROLLBACK';
  targetDirectory: string;
  itemsProcessed: number;
  spaceReclaimedBytes: number;
  status: 'completed' | 'failed' | 'undone';
}

