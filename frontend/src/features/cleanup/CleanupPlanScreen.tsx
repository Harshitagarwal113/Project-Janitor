import type React from 'react';
import { useState } from 'react';
import { PageContainer } from '../../components/PageContainer';
import { Button } from '../../components/Button';
import { Table } from '../../components/Table';
import type { Column } from '../../components/Table';
import { StatusIndicator } from '../../components/StatusIndicator';
import { ConfirmationDialog } from '../../components/ConfirmationDialog';
import { EmptyState } from '../../components/EmptyState';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { apiClient, ApiClientError } from '../../lib/api';
import { formatBytes } from '../../lib/formatters';
import type {
  CleanupPlanItem,
  CleanupPlanResponse,
  ExecutionResponse,
  NavScreenId,
  ScanResponse,
} from '../../types';
import {
  ListChecks,
  AlertTriangle,
  Play,
  RotateCcw,
  CheckCircle2,
  XCircle,
  FolderSearch,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  History,
} from 'lucide-react';

interface CleanupPlanScreenProps {
  onNavigate: (screen: NavScreenId) => void;
  activeScan: ScanResponse | null;
  activePlan: CleanupPlanResponse | null;
  onPlanCreated: (plan: CleanupPlanResponse) => void;
  onPlanExecuted?: (result: ExecutionResponse) => void;
}

export const CleanupPlanScreen: React.FC<CleanupPlanScreenProps> = ({
  onNavigate,
  activeScan,
  activePlan,
  onPlanCreated,
  onPlanExecuted,
}) => {
  // Plan generation parameters
  const [preset, setPreset] = useState<'category' | 'flat' | 'date'>('category');
  const [useAi, setUseAi] = useState<boolean>(true);
  const [flagDuplicates, setFlagDuplicates] = useState<boolean>(true);

  // Loading & error state
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Execution & Confirmation modal state
  const [isConfirmOpen, setIsConfirmOpen] = useState<boolean>(false);
  const [hasConfirmedApproval, setHasConfirmedApproval] = useState<boolean>(false);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [executionResult, setExecutionResult] = useState<ExecutionResponse | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);

  // Table filtering
  const [filterAction, setFilterAction] = useState<string>('all');

  // Trigger Plan Generation
  const handleGeneratePlan = async () => {
    if (!activeScan) return;
    setIsGenerating(true);
    setGenerateError(null);
    setExecutionResult(null);
    setExecutionError(null);

    try {
      const plan = await apiClient.createCleanupPlan(activeScan.scan_id, {
        preset,
        use_ai: useAi,
        flag_duplicates: flagDuplicates,
      });
      onPlanCreated(plan);
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setGenerateError(err.detail);
      } else if (err instanceof Error) {
        setGenerateError(err.message);
      } else {
        setGenerateError('Failed to generate cleanup plan.');
      }
    } finally {
      setIsGenerating(false);
    }
  };

  // Trigger Approved Plan Execution
  const handleExecuteConfirmed = async () => {
    if (!activePlan) return;
    setIsExecuting(true);
    setExecutionError(null);

    try {
      const result = await apiClient.executePlan(activePlan.plan_id, true);
      setExecutionResult(result);
      setIsConfirmOpen(false);
      setHasConfirmedApproval(false);
      if (onPlanExecuted) {
        onPlanExecuted(result);
      }
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setExecutionError(err.detail);
      } else if (err instanceof Error) {
        setExecutionError(err.message);
      } else {
        setExecutionError('Plan execution failed unexpectedly.');
      }
    } finally {
      setIsExecuting(false);
    }
  };

  // State 1: No active scan available
  if (!activeScan) {
    return (
      <PageContainer
        title="Cleanup Plan Review"
        subtitle="Inspect and selectively approve proposed file management operations prior to execution"
      >
        <EmptyState
          icon={<FolderSearch className="w-6 h-6 text-neutral-400" />}
          title="No Active Scan Found"
          description="Scan a directory first before generating a dry-run cleanup plan."
          action={
            <Button
              variant="primary"
              size="sm"
              leftIcon={<FolderSearch className="w-3.5 h-3.5" />}
              onClick={() => onNavigate('scanning')}
            >
              Go to Folder Scanner
            </Button>
          }
        />
      </PageContainer>
    );
  }

  // Executable items (backend only executes MOVE, RENAME, MOVE_AND_RENAME)
  const executableItems = activePlan
    ? activePlan.items.filter(
        (i) =>
          i.action === 'MOVE' ||
          i.action === 'RENAME' ||
          i.action === 'MOVE_AND_RENAME'
      )
    : [];

  const totalExecutableBytes = executableItems.reduce(
    (acc, i) => acc + (i.size_bytes || 0),
    0
  );

  // Filtered items for display
  const displayedItems = activePlan
    ? activePlan.items.filter((item) => {
        if (filterAction === 'all') return true;
        if (filterAction === 'executable')
          return (
            item.action === 'MOVE' ||
            item.action === 'RENAME' ||
            item.action === 'MOVE_AND_RENAME'
          );
        if (filterAction === 'skips') return item.action === 'SKIP';
        if (filterAction === 'duplicates') return item.action === 'DUPLICATE_FLAG';
        return item.action === filterAction;
      })
    : [];

  const columns: Column<CleanupPlanItem>[] = [
    {
      key: 'action',
      header: 'Proposed Action',
      width: '16%',
      render: (item) => {
        if (item.action === 'MOVE') {
          return <StatusIndicator label="PROPOSED MOVE" variant="neutral" />;
        }
        if (item.action === 'RENAME') {
          return <StatusIndicator label="PROPOSED RENAME" variant="neutral" />;
        }
        if (item.action === 'MOVE_AND_RENAME') {
          return <StatusIndicator label="MOVE & RENAME" variant="neutral" />;
        }
        if (item.action === 'DUPLICATE_FLAG') {
          return <StatusIndicator label="DUPLICATE FLAG" variant="neutral" />;
        }
        return <StatusIndicator label="SKIP (RETAIN)" variant="neutral" />;
      },
    },
    {
      key: 'paths',
      header: 'Source & Proposed Destination',
      width: '42%',
      render: (item) => (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-neutral-800">
            <span className="text-neutral-400 font-sans text-[10px] uppercase shrink-0">
              Source:
            </span>
            <span className="truncate block font-medium" title={item.original_path}>
              {item.original_path}
            </span>
          </div>
          {item.proposed_path ? (
            <div className="flex items-center gap-1.5 font-mono text-[11px] text-neutral-600 pl-2 border-l border-neutral-200">
              <span className="text-neutral-400 font-sans text-[10px] uppercase shrink-0">
                Target:
              </span>
              <span className="truncate block text-neutral-900" title={item.proposed_path}>
                {item.proposed_path}
              </span>
            </div>
          ) : (
            <div className="text-[10px] text-neutral-400 italic pl-2 border-l border-neutral-200">
              {item.action === 'DUPLICATE_FLAG'
                ? 'Flagged copy — retained in place for manual review'
                : 'No destination change — kept in original folder'}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'reason',
      header: 'Rationale & Confidence',
      width: '28%',
      render: (item) => {
        const confidencePct =
          typeof item.confidence === 'number'
            ? `${Math.round(item.confidence * 100)}%`
            : item.confidence;

        return (
          <div className="space-y-1">
            <span className="text-xs text-neutral-700 block truncate" title={item.reason}>
              {item.reason}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-neutral-500 bg-neutral-100 px-1.5 py-0.2 rounded border border-neutral-200">
                Confidence: {confidencePct}
              </span>
              {item.is_ai_suggested && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-neutral-800 bg-neutral-100 px-1.5 py-0.2 rounded border border-neutral-200">
                  <Sparkles className="w-2.5 h-2.5" />
                  AI Suggestion
                </span>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: 'size_bytes',
      header: 'Size',
      align: 'right',
      width: '14%',
      render: (item) => (
        <span className="font-mono text-neutral-800 text-xs">
          {formatBytes(item.size_bytes)}
        </span>
      ),
    },
  ];

  return (
    <PageContainer
      title="Cleanup Plan Review"
      subtitle="Inspect and selectively approve proposed file management operations prior to execution"
      actions={
        <div className="flex items-center gap-2">
          {activePlan && (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
              onClick={handleGeneratePlan}
              disabled={isGenerating || isExecuting}
            >
              Regenerate Plan
            </Button>
          )}
          {activePlan && executableItems.length > 0 && !executionResult && (
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Play className="w-3.5 h-3.5" />}
              disabled={isExecuting}
              onClick={() => {
                setHasConfirmedApproval(false);
                setIsConfirmOpen(true);
              }}
            >
              Review & Approve ({executableItems.length} Actions)
            </Button>
          )}
        </div>
      }
    >
      {/* Execution Error Banner */}
      {executionError && (
        <div className="border border-neutral-300 bg-neutral-50 rounded-md p-4 mb-4 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-neutral-800 shrink-0 mt-0.5" />
          <div className="text-xs">
            <span className="font-semibold text-neutral-900 block mb-0.5">
              Plan Execution Failed
            </span>
            <span className="text-neutral-700">{executionError}</span>
          </div>
        </div>
      )}

      {/* Execution Result Banner */}
      {executionResult && (
        <div className="border border-neutral-300 bg-white rounded-md p-5 mb-5 shadow-xs">
          <div className="flex items-center justify-between pb-3 border-b border-neutral-200 mb-3">
            <div className="flex items-center gap-2">
              {executionResult.status === 'completed' ? (
                <CheckCircle2 className="w-4 h-4 text-neutral-900" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-neutral-700" />
              )}
              <span className="font-semibold text-neutral-900 text-sm">
                Execution Complete:{' '}
                <span className="uppercase text-xs font-mono">
                  {executionResult.status.replace('_', ' ')}
                </span>
              </span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<History className="w-3.5 h-3.5" />}
              onClick={() => onNavigate('history')}
            >
              View Operations History
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs mb-3">
            <div className="p-2.5 rounded bg-neutral-50 border border-neutral-200">
              <span className="text-neutral-400 block text-[11px]">Total Planned</span>
              <span className="font-mono font-bold text-neutral-900">
                {executionResult.total_planned}
              </span>
            </div>
            <div className="p-2.5 rounded bg-neutral-50 border border-neutral-200">
              <span className="text-neutral-400 block text-[11px]">Successful</span>
              <span className="font-mono font-bold text-neutral-900">
                {executionResult.successful_operations}
              </span>
            </div>
            <div className="p-2.5 rounded bg-neutral-50 border border-neutral-200">
              <span className="text-neutral-400 block text-[11px]">Failed</span>
              <span className="font-mono font-bold text-neutral-900">
                {executionResult.failed_operations}
              </span>
            </div>
            <div className="p-2.5 rounded bg-neutral-50 border border-neutral-200">
              <span className="text-neutral-400 block text-[11px]">Skipped</span>
              <span className="font-mono font-bold text-neutral-900">
                {executionResult.skipped_operations}
              </span>
            </div>
          </div>

          {/* Partial failure items inspection */}
          {executionResult.failed_operations > 0 && (
            <div className="mt-3 pt-3 border-t border-neutral-100 text-xs">
              <span className="font-semibold text-neutral-900 block mb-1">
                Failed Operations Detail:
              </span>
              <div className="space-y-1 font-mono text-[11px] text-neutral-700">
                {executionResult.operations
                  .filter((op) => op.status === 'failed')
                  .map((op) => (
                    <div
                      key={op.operation_id}
                      className="p-2 bg-neutral-50 border border-neutral-200 rounded flex items-center justify-between"
                    >
                      <span>{op.original_path}</span>
                      <span className="text-neutral-500">{op.error_message || 'Blocked'}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Generation Error */}
      {generateError && (
        <div className="border border-neutral-300 bg-neutral-50 rounded-md p-4 mb-4 flex items-center gap-3">
          <XCircle className="w-4 h-4 text-neutral-800 shrink-0" />
          <div className="text-xs">
            <span className="font-semibold text-neutral-900 block">Plan Generation Failed</span>
            <span className="text-neutral-600">{generateError}</span>
          </div>
        </div>
      )}

      {/* Loading state during plan creation */}
      {isGenerating && (
        <div className="border border-neutral-200 rounded-md bg-white p-12 text-center my-6">
          <LoadingIndicator size="lg" label="Generating Proposed Cleanup Plan..." />
          <p className="text-xs text-neutral-500 font-mono mt-3">
            Applying organization rules, verifying paths within {activeScan.target_path}...
          </p>
        </div>
      )}

      {/* If No Plan Yet: Configuration & Generation Prompt */}
      {!activePlan && !isGenerating && (
        <div className="border border-neutral-200 rounded-md bg-white p-6 max-w-2xl mx-auto my-8">
          <div className="flex items-center gap-2.5 pb-3 border-b border-neutral-200 mb-5">
            <ListChecks className="w-5 h-5 text-neutral-700" />
            <div>
              <h3 className="text-sm font-semibold text-neutral-900">
                Configure Proposed Cleanup Plan
              </h3>
              <p className="text-xs text-neutral-500">
                Set organization rules for target folder: {activeScan.target_path}
              </p>
            </div>
          </div>

          <div className="space-y-5 text-xs">
            <div>
              <label className="font-medium text-neutral-800 block mb-2">
                Organization Structure Preset
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => setPreset('category')}
                  className={`p-3 rounded-md border text-left cursor-pointer transition-colors ${
                    preset === 'category'
                      ? 'border-neutral-900 bg-neutral-50'
                      : 'border-neutral-200 hover:border-neutral-400 bg-white'
                  }`}
                >
                  <span className="font-semibold text-neutral-900 block mb-1">By Category</span>
                  <span className="text-neutral-500 text-[11px] block">
                    Group files into Documents, Images, Code, Audio folders
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setPreset('date')}
                  className={`p-3 rounded-md border text-left cursor-pointer transition-colors ${
                    preset === 'date'
                      ? 'border-neutral-900 bg-neutral-50'
                      : 'border-neutral-200 hover:border-neutral-400 bg-white'
                  }`}
                >
                  <span className="font-semibold text-neutral-900 block mb-1">By Year / Month</span>
                  <span className="text-neutral-500 text-[11px] block">
                    Sort into chronological folders based on modification dates
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setPreset('flat')}
                  className={`p-3 rounded-md border text-left cursor-pointer transition-colors ${
                    preset === 'flat'
                      ? 'border-neutral-900 bg-neutral-50'
                      : 'border-neutral-200 hover:border-neutral-400 bg-white'
                  }`}
                >
                  <span className="font-semibold text-neutral-900 block mb-1">Flat Root</span>
                  <span className="text-neutral-500 text-[11px] block">
                    Normalize filenames while retaining existing folder structure
                  </span>
                </button>
              </div>
            </div>

            <div className="space-y-3 pt-3 border-t border-neutral-100">
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={useAi}
                  onChange={(e) => setUseAi(e.target.checked)}
                  className="rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900 h-3.5 w-3.5 mt-0.5 cursor-pointer"
                />
                <div>
                  <span className="font-medium text-neutral-900 block">
                    Enable Local Gemma AI Classification
                  </span>
                  <span className="text-neutral-500 text-[11px]">
                    Uses local Ollama service for contextual classification when available.
                    Falls back to deterministic rules if offline.
                  </span>
                </div>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={flagDuplicates}
                  onChange={(e) => setFlagDuplicates(e.target.checked)}
                  className="rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900 h-3.5 w-3.5 mt-0.5 cursor-pointer"
                />
                <div>
                  <span className="font-medium text-neutral-900 block">
                    Flag Exact Duplicate Copies for Review
                  </span>
                  <span className="text-neutral-500 text-[11px]">
                    Identifies redundant copies without moving or deleting them automatically.
                  </span>
                </div>
              </label>
            </div>

            <div className="bg-neutral-50 border border-neutral-200 rounded p-3 text-[11px] text-neutral-600 flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-neutral-700 shrink-0 mt-0.5" />
              <span>
                Deterministic Safety Guarantee: The cleanup planner only produces dry-run
                recommendations. Files are never altered until you explicitly review and approve the
                exact operations.
              </span>
            </div>

            <div className="pt-2 flex justify-end">
              <Button
                variant="primary"
                size="md"
                leftIcon={<Play className="w-3.5 h-3.5" />}
                onClick={handleGeneratePlan}
              >
                Generate Proposed Plan (Dry Run)
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* If Plan Exists: Review & Execution Table */}
      {activePlan && !isGenerating && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Plan Status Banner — Clearly Distinguish Proposed Actions from Completed Operations */}
          <div className="border border-neutral-200 bg-white rounded-md p-4 mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs shadow-xs">
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <span className="text-neutral-400 block text-[11px]">Total Scanned</span>
                <span className="font-bold text-neutral-900 text-sm font-mono">
                  {activePlan.summary.total_files} files
                </span>
              </div>
              <div className="h-6 w-px bg-neutral-200 hidden sm:block" />
              <div>
                <span className="text-neutral-400 block text-[11px]">Proposed Moves</span>
                <span className="font-bold text-neutral-900 text-sm font-mono">
                  {activePlan.summary.moves}
                </span>
              </div>
              <div className="h-6 w-px bg-neutral-200 hidden sm:block" />
              <div>
                <span className="text-neutral-400 block text-[11px]">Proposed Renames</span>
                <span className="font-bold text-neutral-900 text-sm font-mono">
                  {activePlan.summary.renames}
                </span>
              </div>
              <div className="h-6 w-px bg-neutral-200 hidden sm:block" />
              <div>
                <span className="text-neutral-400 block text-[11px]">Retained in Place</span>
                <span className="font-bold text-neutral-900 text-sm font-mono">
                  {activePlan.summary.skips}
                </span>
              </div>
              <div className="h-6 w-px bg-neutral-200 hidden sm:block" />
              <div>
                <span className="text-neutral-400 block text-[11px]">Duplicates Flagged</span>
                <span className="font-bold text-neutral-900 text-sm font-mono">
                  {activePlan.summary.duplicates_flagged}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="px-2 py-1 rounded bg-neutral-100 text-neutral-800 border border-neutral-300 font-semibold text-[11px] tracking-wide">
                PROPOSED DRY-RUN
              </span>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="flex items-center justify-between mb-3 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-neutral-500 mr-1">Filter View:</span>
              <button
                type="button"
                onClick={() => setFilterAction('all')}
                className={`px-2.5 py-1 rounded text-xs cursor-pointer border ${
                  filterAction === 'all'
                    ? 'bg-neutral-900 text-white border-neutral-900 font-medium'
                    : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50'
                }`}
              >
                All ({activePlan.items.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterAction('executable')}
                className={`px-2.5 py-1 rounded text-xs cursor-pointer border ${
                  filterAction === 'executable'
                    ? 'bg-neutral-900 text-white border-neutral-900 font-medium'
                    : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50'
                }`}
              >
                Pending Moves & Renames ({executableItems.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterAction('skips')}
                className={`px-2.5 py-1 rounded text-xs cursor-pointer border ${
                  filterAction === 'skips'
                    ? 'bg-neutral-900 text-white border-neutral-900 font-medium'
                    : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50'
                }`}
              >
                Retained ({activePlan.summary.skips})
              </button>
              <button
                type="button"
                onClick={() => setFilterAction('duplicates')}
                className={`px-2.5 py-1 rounded text-xs cursor-pointer border ${
                  filterAction === 'duplicates'
                    ? 'bg-neutral-900 text-white border-neutral-900 font-medium'
                    : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50'
                }`}
              >
                Duplicates ({activePlan.summary.duplicates_flagged})
              </button>
            </div>

            <span className="text-neutral-500 font-mono text-[11px]">
              {displayedItems.length} items listed
            </span>
          </div>

          {/* Main Plan Items Table */}
          <div className="flex-1 overflow-hidden flex flex-col">
            <Table<CleanupPlanItem>
              columns={columns}
              data={displayedItems}
              keyExtractor={(item) => item.item_id || item.original_path}
            />
          </div>
        </div>
      )}

      {/* Explicit Review and Confirmation Step Modal */}
      <ConfirmationDialog
        isOpen={isConfirmOpen}
        title="Approve Cleanup Plan Execution"
        description="Review the exact operations below before approving execution. Project Janitor will only perform the listed move and rename operations deterministically. Skipped items and duplicate flags remain untouched."
        confirmLabel={isExecuting ? 'Executing...' : 'Approve & Execute Plan'}
        cancelLabel="Return to Review"
        isDestructive={false}
        isLoading={isExecuting}
        confirmDisabled={!hasConfirmedApproval || isExecuting}
        maxWidth="max-w-2xl"
        onConfirm={handleExecuteConfirmed}
        onCancel={() => {
          if (!isExecuting) {
            setIsConfirmOpen(false);
            setHasConfirmedApproval(false);
          }
        }}
      >
        <div className="space-y-3">
          <div className="bg-neutral-50 border border-neutral-200 rounded p-3 text-xs">
            <div className="flex justify-between items-center mb-1 font-semibold text-neutral-900">
              <span>Operations Awaiting Approval:</span>
              <span className="font-mono">
                {executableItems.length} operations ({formatBytes(totalExecutableBytes)})
              </span>
            </div>
            <span className="text-[11px] text-neutral-500 block">
              Every operation is recorded in the SQLite journal for transactional undo.
            </span>
          </div>

          {/* Exact operations awaiting approval */}
          <div className="border border-neutral-200 rounded max-h-56 overflow-y-auto divide-y divide-neutral-100 text-xs font-mono">
            {executableItems.map((item, idx) => (
              <div key={idx} className="p-2.5 flex items-start gap-2 hover:bg-neutral-50">
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-neutral-200 text-neutral-800 font-bold shrink-0">
                  {item.action}
                </span>
                <div className="min-w-0 flex-1 text-[11px]">
                  <div className="text-neutral-700 truncate" title={item.original_path}>
                    {item.original_path}
                  </div>
                  <div className="flex items-center gap-1 text-neutral-900 font-medium truncate mt-0.5">
                    <ArrowRight className="w-3 h-3 text-neutral-400 shrink-0" />
                    <span className="truncate" title={item.proposed_path || ''}>
                      {item.proposed_path}
                    </span>
                  </div>
                </div>
                <span className="text-neutral-500 shrink-0 text-[10px]">
                  {formatBytes(item.size_bytes)}
                </span>
              </div>
            ))}
          </div>

          {/* Explicit User Approval Checkbox */}
          <label className="flex items-start gap-2 pt-2 border-t border-neutral-100 cursor-pointer select-none text-xs">
            <input
              type="checkbox"
              checked={hasConfirmedApproval}
              onChange={(e) => setHasConfirmedApproval(e.target.checked)}
              className="rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900 h-3.5 w-3.5 mt-0.5 cursor-pointer"
            />
            <span className="font-semibold text-neutral-900">
              I have inspected and explicitly approve the execution of these exact {executableItems.length} filesystem operations.
            </span>
          </label>
        </div>
      </ConfirmationDialog>
    </PageContainer>
  );
};
