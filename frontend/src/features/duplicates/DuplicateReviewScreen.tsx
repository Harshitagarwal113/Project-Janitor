import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { PageContainer } from '../../components/PageContainer';
import { Button } from '../../components/Button';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { EmptyState } from '../../components/EmptyState';
import { MetricCard } from '../../components/MetricCard';
import { formatBytes, formatDate } from '../../lib/formatters';
import { apiClient, ApiClientError } from '../../lib/api';
import type {
  NavScreenId,
  ScanResponse,
  DuplicateAnalysisResponse,
} from '../../types';
import {
  Copy,
  ShieldCheck,
  RefreshCw,
  ArrowLeft,
  AlertTriangle,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  FileCheck2,
} from 'lucide-react';

interface DuplicateReviewScreenProps {
  onNavigate: (screen: NavScreenId) => void;
  activeScan: ScanResponse | null;
}

export const DuplicateReviewScreen: React.FC<DuplicateReviewScreenProps> = ({
  onNavigate,
  activeScan,
}) => {
  const [analysisData, setAnalysisData] = useState<DuplicateAnalysisResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const fetchDuplicates = useCallback(
    async (scanId: string, refresh = false) => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const result = await apiClient.analyzeDuplicates(scanId, refresh);
        setAnalysisData(result);
      } catch (err: unknown) {
        if (err instanceof ApiClientError) {
          setErrorMessage(err.detail);
        } else if (err instanceof Error) {
          setErrorMessage(err.message);
        } else {
          setErrorMessage('Failed to perform duplicate analysis.');
        }
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (activeScan?.scan_id) {
      // If we don't have analysis data or the active scan changed, fetch
      if (!analysisData || analysisData.scan_id !== activeScan.scan_id) {
        fetchDuplicates(activeScan.scan_id, false);
      }
    } else {
      setAnalysisData(null);
      setErrorMessage(null);
    }
  }, [activeScan?.scan_id, analysisData, fetchDuplicates]);

  const toggleGroupCollapse = (groupId: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  // State 1: No active scan
  if (!activeScan) {
    return (
      <PageContainer
        title="Duplicate File Review"
        subtitle="Examine exact binary duplicate sets and inspect redundant copies"
      >
        <EmptyState
          icon={<FolderOpen className="w-5 h-5 text-neutral-400" />}
          title="No Active Scan Selected"
          description="Please perform a filesystem scan first to detect exact duplicate files within an authorized directory."
          action={
            <Button
              variant="primary"
              size="sm"
              onClick={() => onNavigate('scanning')}
            >
              Go to Folder Scanner
            </Button>
          }
        />
      </PageContainer>
    );
  }

  // State 2: Loading
  if (isLoading) {
    return (
      <PageContainer
        title="Duplicate File Review"
        subtitle="Examine exact binary duplicate sets and inspect redundant copies"
      >
        <div className="py-20 flex flex-col items-center justify-center">
          <LoadingIndicator
            size="lg"
            label="Analyzing duplicate files..."
          />
          <p className="text-xs text-neutral-500 font-mono mt-3">
            Filtering by file size and computing SHA-256 cryptographic hashes...
          </p>
        </div>
      </PageContainer>
    );
  }

  // State 3: Error
  if (errorMessage) {
    return (
      <PageContainer
        title="Duplicate File Review"
        subtitle="Examine exact binary duplicate sets and inspect redundant copies"
        actions={
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<ArrowLeft className="w-3.5 h-3.5" />}
            onClick={() => onNavigate('results')}
          >
            Back to Results
          </Button>
        }
      >
        <div className="border border-neutral-300 bg-neutral-50 rounded-md p-6 max-w-xl mx-auto my-12 text-center">
          <div className="inline-flex p-3 rounded-full bg-neutral-200 text-neutral-800 mb-3">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-semibold text-neutral-900 mb-1">
            Duplicate Analysis Failed
          </h3>
          <p className="text-xs text-neutral-600 mb-4">{errorMessage}</p>
          <div className="flex items-center justify-center gap-3">
            <Button
              variant="primary"
              size="sm"
              leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
              onClick={() => fetchDuplicates(activeScan.scan_id, true)}
            >
              Retry Analysis
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onNavigate('scanning')}
            >
              Select Another Folder
            </Button>
          </div>
        </div>
      </PageContainer>
    );
  }

  // State 4: Completed, but 0 duplicate groups detected
  if (analysisData && analysisData.total_groups === 0) {
    return (
      <PageContainer
        title="Duplicate File Review"
        subtitle="Examine exact binary duplicate sets and inspect redundant copies"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
              onClick={() => fetchDuplicates(activeScan.scan_id, true)}
            >
              Re-Analyze
            </Button>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<ArrowLeft className="w-3.5 h-3.5" />}
              onClick={() => onNavigate('results')}
            >
              View Scanned Files
            </Button>
          </div>
        }
      >
        <EmptyState
          icon={<FileCheck2 className="w-5 h-5 text-neutral-400" />}
          title="No Exact Duplicate Files Found"
          description={`All ${activeScan.total_files} files in "${activeScan.target_path}" have unique binary contents. Verified via SHA-256 hashing with no redundant copies to reclaim.`}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onNavigate('results')}
            >
              View All Scanned Files
            </Button>
          }
        />
      </PageContainer>
    );
  }

  const groups = analysisData?.groups ?? [];
  const totalGroups = analysisData?.total_groups ?? 0;
  const totalDuplicateFiles = analysisData?.total_duplicate_files ?? 0;
  const reclaimableBytes = analysisData?.reclaimable_bytes ?? 0;
  const skippedFiles = analysisData?.skipped_files ?? [];

  return (
    <PageContainer
      title="Duplicate File Review"
      subtitle="Examine exact binary duplicate sets and inspect redundant copies"
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={() => fetchDuplicates(activeScan.scan_id, true)}
          >
            Re-Analyze
          </Button>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<ArrowLeft className="w-3.5 h-3.5" />}
            onClick={() => onNavigate('results')}
          >
            Back to Results
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => onNavigate('cleanup')}
          >
            Create Cleanup Plan
          </Button>
        </div>
      }
    >
      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <MetricCard
          label="Duplicate Groups"
          value={totalGroups}
          subtext="Exact matching sets"
          icon={<Copy className="w-4 h-4 text-neutral-600" />}
        />
        <MetricCard
          label="Total Duplicate Files"
          value={totalDuplicateFiles}
          subtext={`Across ${totalGroups} detected groups`}
          icon={<FileCheck2 className="w-4 h-4 text-neutral-600" />}
        />
        <MetricCard
          label="Potential Reclaimable"
          value={formatBytes(reclaimableBytes)}
          subtext="Extra copies beyond one retained copy"
          icon={<ShieldCheck className="w-4 h-4 text-neutral-600" />}
        />
      </div>

      {/* Directory Context & Verification Notice */}
      <div className="bg-neutral-50 border border-neutral-200 rounded-md p-3 mb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-neutral-800 shrink-0">Scan Target:</span>
          <span className="font-mono text-neutral-600 truncate" title={analysisData?.target_path}>
            {analysisData?.target_path}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 text-neutral-500">
          <ShieldCheck className="w-3.5 h-3.5 text-neutral-700" />
          <span>Verified via SHA-256 cryptographic binary matching</span>
        </div>
      </div>

      {/* Skipped Entries Warning (if any) */}
      {skippedFiles.length > 0 && (
        <div className="border border-neutral-300 bg-neutral-50 rounded-md p-3 mb-5 text-xs">
          <div className="flex items-center gap-2 text-neutral-800 font-medium mb-1.5">
            <AlertTriangle className="w-4 h-4 text-neutral-700" />
            <span>{skippedFiles.length} candidate file(s) skipped during verification</span>
          </div>
          <div className="divide-y divide-neutral-200 max-h-28 overflow-y-auto font-mono text-[11px] text-neutral-600">
            {skippedFiles.map((s, idx) => (
              <div key={idx} className="py-1 flex justify-between gap-2">
                <span className="truncate">{s.path}</span>
                <span className="text-neutral-500 shrink-0">{s.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Duplicate Groups List */}
      <div className="space-y-4 flex-1 overflow-y-auto">
        {groups.map((group, idx) => {
          const isCollapsed = collapsedGroups[group.group_id] || false;

          return (
            <div
              key={group.group_id}
              className="border border-neutral-200 rounded-md bg-white overflow-hidden shadow-xs"
            >
              {/* Group Header */}
              <div
                onClick={() => toggleGroupCollapse(group.group_id)}
                className="bg-neutral-50/80 px-4 py-2.5 border-b border-neutral-200 flex items-center justify-between text-xs cursor-pointer hover:bg-neutral-100/70 transition-colors select-none"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-neutral-500">
                    {isCollapsed ? (
                      <ChevronRight className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </span>
                  <span className="font-mono font-semibold text-neutral-900">
                    Set #{idx + 1}
                  </span>
                  <span className="text-neutral-400 font-mono text-[11px] truncate max-w-xs" title={group.hash}>
                    SHA-256: {group.hash}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-neutral-500 font-mono">
                    {group.file_count} copies ({formatBytes(group.size_bytes)} each)
                  </span>
                  <span className="text-neutral-300">•</span>
                  <span className="text-neutral-900 font-medium font-mono">
                    {formatBytes(group.reclaimable_bytes)} recoverable
                  </span>
                </div>
              </div>

              {/* Files in Group (Visible unless collapsed) */}
              {!isCollapsed && (
                <div className="divide-y divide-neutral-100">
                  {group.files.map((file, fileIdx) => {
                    const isFirst = fileIdx === 0;

                    return (
                      <div
                        key={`${file.relative_path}-${fileIdx}`}
                        className="px-4 py-3 flex items-center justify-between text-xs hover:bg-neutral-50/50 transition-colors"
                      >
                        <div className="min-w-0 flex-1 pr-4">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-neutral-900 truncate">
                              {file.filename}
                            </span>
                            {isFirst ? (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-neutral-900 text-white shrink-0">
                                Retained Copy
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium border border-neutral-200 bg-neutral-100 text-neutral-600 shrink-0">
                                Duplicate Copy #{fileIdx + 1}
                              </span>
                            )}
                            {file.category && (
                              <span className="text-[10px] uppercase font-mono text-neutral-400">
                                {file.category}
                              </span>
                            )}
                          </div>
                          <div
                            className="text-[11px] text-neutral-500 font-mono truncate mt-0.5"
                            title={file.relative_path}
                          >
                            {file.relative_path}
                          </div>
                        </div>

                        <div className="flex items-center gap-4 shrink-0 text-right">
                          <div className="text-[11px] text-neutral-500">
                            {formatDate(file.modified_at)}
                          </div>
                          <div className="font-mono text-neutral-800 w-20 text-right">
                            {formatBytes(file.size_bytes)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </PageContainer>
  );
};
