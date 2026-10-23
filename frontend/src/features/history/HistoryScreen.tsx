import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { PageContainer } from '../../components/PageContainer';
import { Table } from '../../components/Table';
import type { Column } from '../../components/Table';
import { Button } from '../../components/Button';
import { StatusIndicator } from '../../components/StatusIndicator';
import { EmptyState } from '../../components/EmptyState';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { ConfirmationDialog } from '../../components/ConfirmationDialog';
import { apiClient, ApiClientError } from '../../lib/api';
import { formatBytes, formatDate } from '../../lib/formatters';
import type {
  CleanupPlanResponse,
  ExecutedOperationItem,
  NavScreenId,
  UndoOperationResponse,
  UndoPlanResponse,
} from '../../types';
import {
  History,
  RotateCcw,
  RefreshCw,
  Search,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';

interface HistoryScreenProps {
  onNavigate: (screen: NavScreenId) => void;
  activePlan?: CleanupPlanResponse | null;
}

export const HistoryScreen: React.FC<HistoryScreenProps> = ({
  onNavigate,
  activePlan,
}) => {
  const [operations, setOperations] = useState<ExecutedOperationItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Single Undo state
  const [undoTarget, setUndoTarget] = useState<ExecutedOperationItem | null>(null);
  const [isUndoing, setIsUndoing] = useState<boolean>(false);
  const [undoSuccessMsg, setUndoSuccessMsg] = useState<string | null>(null);
  const [undoBlockedMsg, setUndoBlockedMsg] = useState<string | null>(null);

  // Plan Undo state
  const [isPlanUndoOpen, setIsPlanUndoOpen] = useState<boolean>(false);
  const [isUndoingPlan, setIsUndoingPlan] = useState<boolean>(false);
  const [planUndoResult, setPlanUndoResult] = useState<UndoPlanResponse | null>(null);

  // Load operations from backend journal
  const loadOperations = useCallback(async () => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const response = await apiClient.listOperations(undefined, 200, 0);
      setOperations(response.operations || []);
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setFetchError(err.detail);
      } else if (err instanceof Error) {
        setFetchError(err.message);
      } else {
        setFetchError('Unable to load operations history from backend.');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOperations();
  }, [loadOperations]);

  // Execute single operation undo
  const handleConfirmUndo = async () => {
    if (!undoTarget) return;
    setIsUndoing(true);
    setUndoBlockedMsg(null);
    setUndoSuccessMsg(null);

    try {
      const response: UndoOperationResponse = await apiClient.undoOperation(
        undoTarget.operation_id
      );

      if (response.status === 'undone') {
        setUndoSuccessMsg(
          response.message ||
            `Successfully reverted operation. File restored to ${response.original_path}`
        );
        // Update local item status
        setOperations((prev) =>
          prev.map((op) =>
            op.operation_id === undoTarget.operation_id
              ? { ...op, status: 'undone', undo_status: 'undone' }
              : op
          )
        );
        setUndoTarget(null);
      } else if (response.status === 'blocked') {
        setUndoBlockedMsg(
          response.message ||
            'Undo operation was blocked by backend filesystem safety rules.'
        );
        setUndoTarget(null);
      }
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setUndoBlockedMsg(err.detail);
      } else if (err instanceof Error) {
        setUndoBlockedMsg(err.message);
      } else {
        setUndoBlockedMsg('Undo failed due to an unexpected server response.');
      }
      setUndoTarget(null);
    } finally {
      setIsUndoing(false);
    }
  };

  // Execute plan-level undo
  const handleConfirmPlanUndo = async () => {
    if (!activePlan?.plan_id) return;
    setIsUndoingPlan(true);
    setUndoBlockedMsg(null);
    setUndoSuccessMsg(null);

    try {
      const response: UndoPlanResponse = await apiClient.undoPlan(activePlan.plan_id);
      setPlanUndoResult(response);
      setIsPlanUndoOpen(false);
      // Reload journal from server to reflect all state updates
      await loadOperations();
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setUndoBlockedMsg(err.detail);
      } else if (err instanceof Error) {
        setUndoBlockedMsg(err.message);
      } else {
        setUndoBlockedMsg('Plan-level undo failed.');
      }
      setIsPlanUndoOpen(false);
    } finally {
      setIsUndoingPlan(false);
    }
  };

  // Filter operations by query
  const filteredOperations = operations.filter((item) => {
    const q = searchQuery.toLowerCase();
    return (
      item.original_path.toLowerCase().includes(q) ||
      (item.destination_path && item.destination_path.toLowerCase().includes(q)) ||
      item.operation_type.toLowerCase().includes(q) ||
      item.status.toLowerCase().includes(q)
    );
  });

  const columns: Column<ExecutedOperationItem>[] = [
    {
      key: 'timestamp',
      header: 'Timestamp',
      width: '16%',
      render: (item) => (
        <span className="font-mono text-neutral-600 text-[11px]">
          {formatDate(item.timestamp)}
        </span>
      ),
    },
    {
      key: 'operation_type',
      header: 'Operation',
      width: '12%',
      render: (item) => (
        <StatusIndicator label={item.operation_type} variant="neutral" />
      ),
    },
    {
      key: 'paths',
      header: 'Source & Destination Locations',
      width: '40%',
      render: (item) => (
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-neutral-800">
            <span className="text-neutral-400 font-sans text-[10px] uppercase shrink-0">
              Src:
            </span>
            <span className="truncate block font-medium" title={item.original_path}>
              {item.original_path}
            </span>
          </div>
          {item.destination_path && (
            <div className="flex items-center gap-1.5 font-mono text-[11px] text-neutral-600 pl-2 border-l border-neutral-200">
              <span className="text-neutral-400 font-sans text-[10px] uppercase shrink-0">
                Dst:
              </span>
              <span className="truncate block text-neutral-900" title={item.destination_path}>
                {item.destination_path}
              </span>
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Outcome Status',
      width: '14%',
      render: (item) => {
        if (item.status === 'undone') {
          return (
            <span className="inline-flex items-center gap-1 text-[11px] text-neutral-500 font-medium">
              <RotateCcw className="w-3 h-3 text-neutral-400" />
              Reverted (Undone)
            </span>
          );
        }
        if (item.status === 'failed') {
          return (
            <span
              className="text-[11px] text-neutral-900 font-medium truncate block"
              title={item.error_message || 'Failed'}
            >
              Failed: {item.error_message || 'Error'}
            </span>
          );
        }
        if (item.status === 'skipped') {
          return <span className="text-[11px] text-neutral-400 italic">Skipped</span>;
        }
        return <StatusIndicator label="Completed" variant="success" />;
      },
    },
    {
      key: 'size',
      header: 'Size',
      align: 'right',
      width: '8%',
      render: (item) => (
        <span className="font-mono text-neutral-700 text-xs">
          {item.file_size_bytes > 0 ? formatBytes(item.file_size_bytes) : '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Undo Action',
      align: 'center',
      width: '10%',
      render: (item) => {
        // Requirement 13: Enable undo only when backend confirms operation is eligible
        const isEligible =
          item.status === 'completed' && item.undo_status === 'reversible';

        if (item.status === 'undone') {
          return <span className="text-[11px] text-neutral-400 italic">Restored</span>;
        }

        if (item.undo_status === 'blocked') {
          // Requirement 14: Display backend-provided reasons when undo is blocked
          return (
            <span
              className="text-[11px] text-neutral-500 font-mono cursor-help"
              title={item.error_message || 'Blocked: File was altered or original path is occupied'}
            >
              Blocked
            </span>
          );
        }

        if (!isEligible) {
          return <span className="text-[11px] text-neutral-400">—</span>;
        }

        return (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<RotateCcw className="w-3 h-3 text-neutral-600" />}
            onClick={() => setUndoTarget(item)}
          >
            Undo
          </Button>
        );
      },
    },
  ];

  return (
    <PageContainer
      title="Audit & Operations History"
      subtitle="Transactional journal of executed filesystem modifications with safe rollback support"
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />}
            onClick={loadOperations}
            disabled={isLoading}
          >
            Refresh
          </Button>

          {activePlan && (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
              onClick={() => setIsPlanUndoOpen(true)}
              disabled={isLoading || isUndoingPlan}
            >
              Undo Active Plan
            </Button>
          )}
        </div>
      }
    >
      {/* Success Notification */}
      {undoSuccessMsg && (
        <div className="border border-neutral-300 bg-neutral-50 rounded-md p-3 mb-4 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-neutral-900" />
            <span className="font-medium text-neutral-900">{undoSuccessMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setUndoSuccessMsg(null)}
            className="text-neutral-400 hover:text-neutral-900 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Blocked / Error Notification */}
      {undoBlockedMsg && (
        <div className="border border-neutral-300 bg-neutral-50 rounded-md p-4 mb-4 flex items-start gap-3 text-xs">
          <ShieldAlert className="w-4 h-4 text-neutral-900 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold text-neutral-900 block mb-0.5">
              Undo Blocked by Safety Guardrail:
            </span>
            <span className="text-neutral-700">{undoBlockedMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setUndoBlockedMsg(null)}
            className="text-neutral-400 hover:text-neutral-900 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Plan Undo Result Banner */}
      {planUndoResult && (
        <div className="border border-neutral-200 bg-white rounded-md p-4 mb-4 text-xs shadow-xs">
          <div className="flex items-center justify-between pb-2 border-b border-neutral-100 mb-2">
            <div className="flex items-center gap-2 font-semibold text-neutral-900">
              <RotateCcw className="w-4 h-4 text-neutral-800" />
              <span>Plan Reversal Complete</span>
            </div>
            <button
              type="button"
              onClick={() => setPlanUndoResult(null)}
              className="text-neutral-400 hover:text-neutral-900 cursor-pointer text-[11px]"
            >
              Dismiss
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
            <div className="p-2 bg-neutral-50 rounded border border-neutral-200">
              Total Operations: {planUndoResult.total_operations}
            </div>
            <div className="p-2 bg-neutral-50 rounded border border-neutral-200">
              Undone: {planUndoResult.undone_operations}
            </div>
            <div className="p-2 bg-neutral-50 rounded border border-neutral-200">
              Blocked: {planUndoResult.blocked_operations}
            </div>
            <div className="p-2 bg-neutral-50 rounded border border-neutral-200">
              Failed: {planUndoResult.failed_operations}
            </div>
          </div>
        </div>
      )}

      {/* Search & Filter Bar */}
      <div className="flex items-center justify-between mb-4">
        <div className="relative max-w-sm w-full">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search operations by path, type, or status..."
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-neutral-200 rounded-md bg-white text-neutral-900 focus:outline-hidden focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
          />
        </div>
        <span className="text-xs text-neutral-500 font-mono">
          {filteredOperations.length} recorded operations
        </span>
      </div>

      {/* Main Content Area */}
      {isLoading ? (
        <div className="border border-neutral-200 rounded-md bg-white p-12 text-center my-4">
          <LoadingIndicator size="md" label="Loading journal history from backend..." />
        </div>
      ) : fetchError ? (
        <div className="border border-neutral-300 bg-neutral-50 rounded-md p-6 max-w-lg mx-auto my-8 text-center text-xs">
          <AlertTriangle className="w-6 h-6 text-neutral-800 mx-auto mb-2" />
          <h3 className="font-semibold text-neutral-900 mb-1">Failed to Query Operations</h3>
          <p className="text-neutral-600 mb-4">{fetchError}</p>
          <Button variant="primary" size="sm" onClick={loadOperations}>
            Retry Request
          </Button>
        </div>
      ) : operations.length === 0 ? (
        <EmptyState
          icon={<History className="w-6 h-6 text-neutral-400" />}
          title="No Operations Recorded"
          description="No filesystem modifications have been executed yet. Generate and approve a cleanup plan to perform organized moves."
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onNavigate('cleanup')}
            >
              View Cleanup Plan
            </Button>
          }
        />
      ) : filteredOperations.length === 0 ? (
        <EmptyState
          icon={<History className="w-5 h-5 text-neutral-400" />}
          title="No Matching Entries"
          description={`No recorded operations match your filter "${searchQuery}".`}
          action={
            <Button variant="secondary" size="sm" onClick={() => setSearchQuery('')}>
              Clear Filter
            </Button>
          }
        />
      ) : (
        <div className="flex-1 overflow-hidden flex flex-col">
          <Table<ExecutedOperationItem>
            columns={columns}
            data={filteredOperations}
            keyExtractor={(item) => item.operation_id}
          />
        </div>
      )}

      {/* Confirmation Dialog for Single Operation Undo */}
      <ConfirmationDialog
        isOpen={undoTarget !== null}
        title="Confirm Operation Rollback"
        description="Are you sure you want to revert this operation? Project Janitor will restore the file back to its original location:"
        confirmLabel={isUndoing ? 'Reverting...' : 'Execute Rollback'}
        cancelLabel="Keep As Is"
        isDestructive={false}
        isLoading={isUndoing}
        maxWidth="max-w-xl"
        onConfirm={handleConfirmUndo}
        onCancel={() => {
          if (!isUndoing) setUndoTarget(null);
        }}
      >
        {undoTarget && (
          <div className="bg-neutral-50 border border-neutral-200 rounded p-3 text-xs font-mono space-y-2">
            <div>
              <span className="text-neutral-400 text-[10px] uppercase block font-sans">
                Current Location:
              </span>
              <span className="text-neutral-800 truncate block">
                {undoTarget.destination_path}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-neutral-400">
              <ArrowRight className="w-3 h-3" />
              <span className="text-[11px] font-sans">Will be safely moved back to:</span>
            </div>
            <div>
              <span className="text-neutral-400 text-[10px] uppercase block font-sans">
                Original Restored Location:
              </span>
              <span className="text-neutral-900 font-semibold truncate block">
                {undoTarget.original_path}
              </span>
            </div>
          </div>
        )}
      </ConfirmationDialog>

      {/* Confirmation Dialog for Plan-Level Undo */}
      <ConfirmationDialog
        isOpen={isPlanUndoOpen}
        title="Confirm Reversal of Active Plan"
        description="Are you sure you want to revert all eligible operations belonging to the active plan? Each file will be moved back to its original position unless its target has been altered."
        confirmLabel={isUndoingPlan ? 'Undoing Plan...' : 'Undo All in Plan'}
        cancelLabel="Cancel"
        isDestructive={false}
        isLoading={isUndoingPlan}
        onConfirm={handleConfirmPlanUndo}
        onCancel={() => {
          if (!isUndoingPlan) setIsPlanUndoOpen(false);
        }}
      />
    </PageContainer>
  );
};
