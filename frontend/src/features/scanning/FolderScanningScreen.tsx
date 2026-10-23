import type React from 'react';
import { useState } from 'react';
import { PageContainer } from '../../components/PageContainer';
import { Button } from '../../components/Button';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { StatusIndicator } from '../../components/StatusIndicator';
import { apiClient, ApiClientError } from '../../lib/api';
import { formatBytes, formatDate } from '../../lib/formatters';
import type { NavScreenId, ScanResponse } from '../../types';
import {
  FolderSearch,
  AlertCircle,
  CheckCircle2,
  Clock,
  Info,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';

interface FolderScanningScreenProps {
  onNavigate: (screen: NavScreenId) => void;
  onScanSuccess: (scan: ScanResponse) => void;
  currentScan: ScanResponse | null;
}

export const FolderScanningScreen: React.FC<FolderScanningScreenProps> = ({
  onNavigate,
  onScanSuccess,
  currentScan,
}) => {
  // Preset default target within current project
  const [targetPath, setTargetPath] = useState<string>(
    'c:\\Users\\lenov\\OneDrive\\Desktop\\HARSHIT\\Projects\\Project Janitor\\backend\\app'
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ScanResponse | null>(currentScan);

  // Suggested local directories for immediate testing
  const presetDirectories = [
    {
      label: 'Backend App Source',
      path: 'c:\\Users\\lenov\\OneDrive\\Desktop\\HARSHIT\\Projects\\Project Janitor\\backend\\app',
    },
    {
      label: 'Frontend Source',
      path: 'c:\\Users\\lenov\\OneDrive\\Desktop\\HARSHIT\\Projects\\Project Janitor\\frontend\\src',
    },
    {
      label: 'Project Documentation',
      path: 'c:\\Users\\lenov\\OneDrive\\Desktop\\HARSHIT\\Projects\\Project Janitor\\docs',
    },
    {
      label: 'Reserved Data Folder',
      path: 'c:\\Users\\lenov\\OneDrive\\Desktop\\HARSHIT\\Projects\\Project Janitor\\data',
    },
  ];

  const handleStartScan = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isLoading) return; // Prevent duplicate concurrent submissions

    const trimmed = targetPath.trim();
    if (!trimmed) {
      setErrorMessage('Please enter an absolute directory path.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      // Connect to real backend scanner API
      const result = await apiClient.startScan(trimmed, 100, 0);
      setLastResult(result);
      onScanSuccess(result);
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setErrorMessage(err.detail);
      } else if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('An unexpected error occurred while communicating with the backend scanner.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <PageContainer
      title="Folder Scanner"
      subtitle="Connect directly to the local filesystem backend to analyze directory trees and file volumes"
    >
      <div className="max-w-3xl space-y-6">
        {/* Notice on Windows Path Input */}
        <div className="border border-neutral-200 bg-neutral-50/75 rounded-md p-3.5 flex items-start gap-3 text-xs text-neutral-600">
          <Info className="w-4 h-4 text-neutral-500 shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            <span className="font-semibold text-neutral-900 block mb-0.5">
              Windows Local Filesystem Access
            </span>
            Standard web browser sandbox restrictions do not allow client-side scripts to access arbitrary Windows folders directly. Project Janitor securely passes the absolute directory path to your local Python FastAPI engine for authorized scanning.
          </div>
        </div>

        {/* Path Input Form */}
        <form onSubmit={handleStartScan} className="border border-neutral-200 rounded-md bg-white p-5 space-y-4">
          <div className="flex items-center justify-between">
            <label htmlFor="folderPathInput" className="text-xs font-semibold text-neutral-800 uppercase tracking-wider">
              Windows Absolute Directory Path
            </label>
            <span className="text-[11px] text-neutral-400 font-mono">e.g. C:\Folder\Target</span>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                id="folderPathInput"
                type="text"
                value={targetPath}
                onChange={(e) => {
                  setTargetPath(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                disabled={isLoading}
                placeholder="C:\path\to\target\directory"
                className="w-full px-3 py-2 text-xs font-mono border border-neutral-200 rounded-md bg-white text-neutral-900 focus:outline-hidden focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900 transition-colors disabled:bg-neutral-50 disabled:text-neutral-400"
              />
            </div>
            <Button
              type="submit"
              variant="primary"
              size="md"
              isLoading={isLoading}
              disabled={isLoading || !targetPath.trim()}
              leftIcon={<FolderSearch className="w-4 h-4" />}
            >
              {isLoading ? 'Scanning...' : 'Begin Directory Scan'}
            </Button>
          </div>

          {/* Currently Selected Directory Display */}
          <div className="pt-2 text-xs flex items-center gap-2">
            <span className="text-neutral-400 font-medium">Selected Directory:</span>
            <span className="font-mono text-neutral-800 font-medium break-all bg-neutral-100 px-2 py-0.5 rounded border border-neutral-200">
              {targetPath || 'None specified'}
            </span>
          </div>

          {/* Safety Notice */}
          <div className="pt-3 border-t border-neutral-100 flex items-center justify-between text-[11px] text-neutral-400">
            <div className="flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-neutral-500" />
              <span>Scanning entire drive roots (C:\ or /) is prohibited by safety policy</span>
            </div>
            <span>Read-Only Metadata Access</span>
          </div>
        </form>

        {/* Loading State Display */}
        {isLoading && (
          <div className="border border-neutral-200 rounded-md bg-white p-6 shadow-xs">
            <LoadingIndicator
              label="Backend Scanner Active"
              subtext={`Traversing directory tree and extracting stat metadata from: ${targetPath}`}
            />
          </div>
        )}

        {/* Error State Display */}
        {errorMessage && !isLoading && (
          <div className="border border-neutral-300 rounded-md bg-neutral-50 p-5 flex items-start justify-between animate-in fade-in">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-neutral-800 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-semibold text-neutral-900">Scan Failed</h4>
                <p className="text-xs text-neutral-700 mt-1 leading-relaxed">
                  {errorMessage}
                </p>
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setErrorMessage(null)}
            >
              Dismiss
            </Button>
          </div>
        )}

        {/* Success / Last Result Display */}
        {lastResult && !isLoading && !errorMessage && (
          <div className="border border-neutral-200 rounded-md bg-white p-5 space-y-4 shadow-xs animate-in fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-neutral-100">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-5 h-5 text-neutral-900" />
                <div>
                  <h4 className="text-sm font-semibold text-neutral-900">
                    Scan Completed Successfully
                  </h4>
                  <span className="text-[11px] text-neutral-500">
                    Scanned at {formatDate(lastResult.scanned_at)}
                  </span>
                </div>
              </div>
              <Button
                variant="primary"
                size="sm"
                rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
                onClick={() => onNavigate('results')}
              >
                Inspect Results ({lastResult.total_files.toLocaleString()})
              </Button>
            </div>

            {/* Metrics Breakdown */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="bg-neutral-50 p-3 rounded border border-neutral-200/60">
                <span className="text-neutral-400 block mb-0.5 text-[11px]">Total Files</span>
                <span className="font-semibold text-neutral-900 text-sm font-mono">
                  {lastResult.total_files.toLocaleString()}
                </span>
              </div>
              <div className="bg-neutral-50 p-3 rounded border border-neutral-200/60">
                <span className="text-neutral-400 block mb-0.5 text-[11px]">Total Volume</span>
                <span className="font-semibold text-neutral-900 text-sm font-mono">
                  {formatBytes(lastResult.total_scanned_bytes)}
                </span>
              </div>
              <div className="bg-neutral-50 p-3 rounded border border-neutral-200/60">
                <span className="text-neutral-400 block mb-0.5 text-[11px]">Scan Identifier</span>
                <span className="font-mono text-neutral-700 text-[10px] truncate block" title={lastResult.scan_id}>
                  {lastResult.scan_id.slice(0, 13)}...
                </span>
              </div>
              <div className="bg-neutral-50 p-3 rounded border border-neutral-200/60">
                <span className="text-neutral-400 block mb-0.5 text-[11px]">Skipped Items</span>
                <span className="font-semibold text-neutral-900 text-sm font-mono">
                  {lastResult.skipped_entries.length}
                </span>
              </div>
            </div>

            {/* Category tags */}
            {lastResult.category_counts && (
              <div className="pt-2 flex flex-wrap gap-1.5 items-center">
                <span className="text-[11px] text-neutral-400 mr-1">Categories:</span>
                {Object.entries(lastResult.category_counts)
                  .filter(([, count]) => count > 0)
                  .map(([cat, count]) => (
                    <StatusIndicator
                      key={cat}
                      label={`${cat}: ${count}`}
                      variant="neutral"
                    />
                  ))}
              </div>
            )}
          </div>
        )}

        {/* Directory Presets / Quick Selectors */}
        <div className="border border-neutral-200 rounded-md bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-neutral-700 uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-neutral-400" />
              Quick Project Presets
            </span>
            <span className="text-[11px] text-neutral-400">Click to select path</span>
          </div>

          <div className="divide-y divide-neutral-100">
            {presetDirectories.map((preset) => (
              <div
                key={preset.path}
                onClick={() => {
                  setTargetPath(preset.path);
                  if (errorMessage) setErrorMessage(null);
                }}
                className="py-2.5 flex items-center justify-between text-xs cursor-pointer hover:bg-neutral-50 px-2 rounded -mx-2 transition-colors"
              >
                <div>
                  <span className="font-medium text-neutral-800 block">{preset.label}</span>
                  <span className="font-mono text-neutral-400 text-[11px]">{preset.path}</span>
                </div>
                <Button variant="ghost" size="sm">
                  Select
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageContainer>
  );
};
