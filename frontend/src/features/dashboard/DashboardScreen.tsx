import type React from 'react';
import { useEffect, useState } from 'react';
import { PageContainer } from '../../components/PageContainer';
import { MetricCard } from '../../components/MetricCard';
import { Button } from '../../components/Button';
import { StatusIndicator } from '../../components/StatusIndicator';
import { formatBytes, formatDate } from '../../lib/formatters';
import { apiClient } from '../../lib/api';
import type {
  AIModelStatus,
  ExecutedOperationItem,
  NavScreenId,
  ScanResponse,
} from '../../types';
import {
  Files,
  HardDrive,
  Copy,
  FolderSearch,
  ArrowRight,
  ShieldAlert,
  Sparkles,
  History,
} from 'lucide-react';

interface DashboardScreenProps {
  onNavigate: (screen: NavScreenId) => void;
  activeScan: ScanResponse | null;
}

export const DashboardScreen: React.FC<DashboardScreenProps> = ({
  onNavigate,
  activeScan,
}) => {
  const [aiStatus, setAiStatus] = useState<AIModelStatus | null>(null);
  const [recentOperations, setRecentOperations] = useState<ExecutedOperationItem[]>([]);
  const [totalOperations, setTotalOperations] = useState<number>(0);
  const [isLoadingBackend, setIsLoadingBackend] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;
    const fetchDashboardContext = async () => {
      setIsLoadingBackend(true);
      try {
        const [aiRes, journalRes] = await Promise.allSettled([
          apiClient.getAIStatus(),
          apiClient.listOperations(undefined, 5, 0),
        ]);

        if (isMounted) {
          if (aiRes.status === 'fulfilled') {
            setAiStatus(aiRes.value);
          }
          if (journalRes.status === 'fulfilled') {
            setRecentOperations(journalRes.value.operations || []);
            setTotalOperations(journalRes.value.total || 0);
          }
        }
      } finally {
        if (isMounted) setIsLoadingBackend(false);
      }
    };

    fetchDashboardContext();
    return () => {
      isMounted = false;
    };
  }, []);

  // Compute category breakdown from active scan
  const categoryCounts = activeScan?.category_counts || {};
  const totalFiles = activeScan?.total_files || 0;
  const totalBytes = activeScan?.total_scanned_bytes || 0;

  const categories = Object.keys(categoryCounts).map((cat) => ({
    name: cat,
    count: categoryCounts[cat] || 0,
    pct: totalFiles > 0 ? (((categoryCounts[cat] || 0) / totalFiles) * 100).toFixed(1) : '0',
  }));

  const reversibleOpsCount = recentOperations.filter(
    (op) => op.status === 'completed' && op.undo_status === 'reversible'
  ).length;

  return (
    <PageContainer
      title="System Overview"
      subtitle="Local filesystem health, scan status, and verified operation journal diagnostics"
      actions={
        <div className="flex items-center gap-2">
          {activeScan && (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Copy className="w-3.5 h-3.5" />}
              onClick={() => onNavigate('duplicates')}
            >
              Analyze Duplicates
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            leftIcon={<FolderSearch className="w-3.5 h-3.5" />}
            onClick={() => onNavigate('scanning')}
          >
            {activeScan ? 'New Folder Scan' : 'Start Folder Scan'}
          </Button>
        </div>
      }
    >
      {/* Metrics Row — Strictly Real Backend & Scan Data, No Invented Statistics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          label="Indexed Files"
          value={activeScan ? totalFiles.toLocaleString() : '0'}
          subtext={activeScan ? 'In current active scan' : 'No active scan executed'}
          icon={<Files className="w-4 h-4" />}
        />
        <MetricCard
          label="Scanned Volume"
          value={activeScan ? formatBytes(totalBytes) : '0 B'}
          subtext={
            activeScan
              ? activeScan.target_path.slice(0, 30) + '...'
              : 'Select target directory to scan'
          }
          icon={<HardDrive className="w-4 h-4" />}
        />
        <MetricCard
          label="Recorded Operations"
          value={totalOperations.toLocaleString()}
          subtext={
            reversibleOpsCount > 0
              ? `${reversibleOpsCount} reversible rollback actions`
              : 'In SQLite transactional journal'
          }
          icon={<History className="w-4 h-4" />}
        />
        <MetricCard
          label="Local AI Classifier"
          value={
            aiStatus?.service_available
              ? aiStatus.model_installed
                ? 'Gemma:2b Online'
                : 'Ollama Ready'
              : 'Offline (Rules)'
          }
          subtext={
            aiStatus?.service_available
              ? `Model: ${aiStatus.configured_model}`
              : 'Deterministic engine active'
          }
          icon={<Sparkles className="w-4 h-4" />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1">
        {/* Category Breakdown or Scan Prompt */}
        <div className="lg:col-span-2 border border-neutral-200 rounded-md bg-white p-5 flex flex-col">
          <div className="flex items-center justify-between pb-3 border-b border-neutral-200 mb-4">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900">
                Storage Category Composition
              </h2>
              <p className="text-xs text-neutral-500">
                {activeScan
                  ? `File categorization for: ${activeScan.target_path}`
                  : 'Execute a scan to view category distribution'}
              </p>
            </div>
            {activeScan && (
              <Button
                variant="ghost"
                size="sm"
                rightIcon={<ArrowRight className="w-3 h-3" />}
                onClick={() => onNavigate('results')}
              >
                Inspect Files
              </Button>
            )}
          </div>

          {activeScan && categories.length > 0 ? (
            <div className="divide-y divide-neutral-100 flex-1">
              {categories.map((cat) => (
                <div key={cat.name} className="py-2.5 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3 w-1/3">
                    <span className="capitalize font-medium text-neutral-800">{cat.name}</span>
                    <span className="text-neutral-400 font-mono text-[11px]">
                      {cat.count.toLocaleString()} files
                    </span>
                  </div>

                  <div className="w-1/3 px-4">
                    <div className="w-full bg-neutral-100 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="bg-neutral-800 h-1.5 rounded-full"
                        style={{ width: `${cat.pct}%` }}
                      />
                    </div>
                  </div>

                  <div className="w-1/3 text-right flex items-center justify-end gap-3">
                    <span className="text-neutral-500 font-mono text-[11px] w-12 text-right">
                      {cat.pct}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-xs text-neutral-500">
              <FolderSearch className="w-8 h-8 text-neutral-300 mb-2" />
              <p className="font-medium text-neutral-700 mb-1">No Active Scan Indexed</p>
              <p className="text-neutral-400 max-w-sm mb-4">
                Run the folder scanner to index an authorized directory and analyze its storage breakdown.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onNavigate('scanning')}
              >
                Open Folder Scanner
              </Button>
            </div>
          )}
        </div>

        {/* Right Diagnostic & Status Column */}
        <div className="flex flex-col gap-6">
          {/* Active Scan Card */}
          <div className="border border-neutral-200 rounded-md bg-white p-5">
            <h2 className="text-sm font-semibold text-neutral-900 mb-3">Active Scan Status</h2>
            {activeScan ? (
              <div className="space-y-3 text-xs">
                <div>
                  <span className="text-neutral-400 block mb-0.5">Scanned Target</span>
                  <span
                    className="font-mono text-neutral-800 break-all bg-neutral-50 p-1.5 rounded border border-neutral-200 block text-[11px]"
                    title={activeScan.target_path}
                  >
                    {activeScan.target_path}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-neutral-400">Timestamp</span>
                  <span className="text-neutral-700">{formatDate(activeScan.scanned_at)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-neutral-400">Indexed Items</span>
                  <span className="font-mono text-neutral-900 font-medium">
                    {activeScan.total_files.toLocaleString()} files ({formatBytes(activeScan.total_scanned_bytes)})
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-neutral-400">Status</span>
                  <StatusIndicator label="Completed" variant="success" />
                </div>
                <div className="pt-2 border-t border-neutral-100 flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    onClick={() => onNavigate('results')}
                  >
                    Inspect Scan Results
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-xs text-neutral-500 py-3">
                <p className="mb-3">No active scan has been performed in this session.</p>
                <Button
                  variant="primary"
                  size="sm"
                  className="w-full"
                  onClick={() => onNavigate('scanning')}
                >
                  Start First Scan
                </Button>
              </div>
            )}
          </div>

          {/* Local AI & Safety Model Card */}
          <div className="border border-neutral-200 rounded-md bg-neutral-50/60 p-5 flex-1 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-neutral-900 font-semibold text-xs mb-1.5">
                <ShieldAlert className="w-4 h-4 text-neutral-700" />
                <span>Deterministic Safety & AI Model</span>
              </div>
              <p className="text-xs text-neutral-600 leading-relaxed mb-3">
                Project Janitor executes dry-run cleanup planning. Files are only moved or renamed
                with explicit user approval and logged to the local SQLite journal for safe rollback.
              </p>

              <div className="bg-white border border-neutral-200 rounded p-2.5 text-[11px] space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-neutral-500">Ollama API (127.0.0.1:11434):</span>
                  <span className="font-medium text-neutral-800">
                    {isLoadingBackend
                      ? 'Checking...'
                      : aiStatus?.service_available
                      ? 'Reachable'
                      : 'Unavailable'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-neutral-500">Configured Model:</span>
                  <span className="font-mono text-neutral-800">
                    {aiStatus?.configured_model || 'gemma:2b'}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-neutral-200/60 flex items-center justify-between text-[11px] text-neutral-400">
              <span>Drive Traversal Sandboxed</span>
              <span>v0.1.0</span>
            </div>
          </div>
        </div>
      </div>
    </PageContainer>
  );
};
