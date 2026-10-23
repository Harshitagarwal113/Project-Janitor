import type React from 'react';
import { useState } from 'react';
import { PageContainer } from '../../components/PageContainer';
import { Table } from '../../components/Table';
import type { Column } from '../../components/Table';
import { Button } from '../../components/Button';
import { StatusIndicator } from '../../components/StatusIndicator';
import { EmptyState } from '../../components/EmptyState';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { apiClient, ApiClientError } from '../../lib/api';
import { formatBytes, formatDate } from '../../lib/formatters';
import type { FileMetadata, NavScreenId, ScanResponse } from '../../types';
import {
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  FileQuestion,
  FolderSearch,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';

interface ScanResultsScreenProps {
  onNavigate: (screen: NavScreenId) => void;
  activeScan: ScanResponse | null;
  onScanUpdate?: (updatedScan: ScanResponse) => void;
}

export const ScanResultsScreen: React.FC<ScanResultsScreenProps> = ({
  onNavigate,
  activeScan,
  onScanUpdate,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize] = useState<number>(50);
  const [isLoadingPage, setIsLoadingPage] = useState<boolean>(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [paginatedScan, setPaginatedScan] = useState<ScanResponse | null>(null);

  // Derive current scan data without cascading setState in effect
  const currentScanData =
    paginatedScan && paginatedScan.scan_id === activeScan?.scan_id
      ? paginatedScan
      : activeScan;

  // Support backend paginated retrieval via GET /api/v1/scan/{scan_id}
  const fetchPage = async (pageNumber: number) => {
    if (!currentScanData?.scan_id) return;
    const offset = (pageNumber - 1) * pageSize;
    setIsLoadingPage(true);
    setPageError(null);

    try {
      const updated = await apiClient.getScanResults(
        currentScanData.scan_id,
        pageSize,
        offset
      );
      setPaginatedScan(updated);
      setCurrentPage(pageNumber);
      if (onScanUpdate) onScanUpdate(updated);
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setPageError(err.detail);
      } else {
        setPageError('Failed to fetch paginated scan page from backend.');
      }
    } finally {
      setIsLoadingPage(false);
    }
  };

  // If no scan exists yet, display empty guidance state
  if (!currentScanData) {
    return (
      <PageContainer
        title="Scan Results"
        subtitle="Examine metadata, relative paths, and size allocations from the current scan"
      >
        <EmptyState
          icon={<FolderSearch className="w-6 h-6 text-neutral-400" />}
          title="No Active Scan Found"
          description="Enter a directory path on the Folder Scan screen to execute a real filesystem analysis."
          action={
            <Button
              variant="primary"
              size="md"
              leftIcon={<FolderSearch className="w-4 h-4" />}
              onClick={() => onNavigate('scanning')}
            >
              Go to Folder Scanner
            </Button>
          }
        />
      </PageContainer>
    );
  }

  // Files currently in the active page
  const pageFiles = currentScanData.files || [];

  // Filter files by query and category
  const filteredFiles = pageFiles.filter((file) => {
    const matchesSearch =
      file.filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
      file.relative_path.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory =
      selectedCategory === 'all' || file.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const totalPages =
    Math.ceil(currentScanData.total_files / currentScanData.limit) || 1;

  const columns: Column<FileMetadata>[] = [
    {
      key: 'filename',
      header: 'File Name',
      width: '28%',
      render: (item) => (
        <div className="font-medium text-neutral-900 truncate" title={item.filename}>
          {item.filename}
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      width: '14%',
      render: (item) => (
        <StatusIndicator label={item.category} variant="neutral" />
      ),
    },
    {
      key: 'size_bytes',
      header: 'Size',
      align: 'right',
      width: '14%',
      render: (item) => (
        <span className="font-mono text-neutral-700">{formatBytes(item.size_bytes)}</span>
      ),
    },
    {
      key: 'relative_path',
      header: 'Relative Path',
      width: '30%',
      render: (item) => (
        <span className="text-neutral-500 font-mono text-[11px] truncate block" title={item.relative_path}>
          {item.relative_path}
        </span>
      ),
    },
    {
      key: 'modified_at',
      header: 'Modified',
      align: 'right',
      width: '14%',
      render: (item) => (
        <span className="text-neutral-500 text-[11px]">{formatDate(item.modified_at)}</span>
      ),
    },
  ];

  return (
    <PageContainer
      title="Scan Results"
      subtitle={`Real filesystem scan output for: ${currentScanData.target_path}`}
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${isLoadingPage ? 'animate-spin' : ''}`} />}
            onClick={() => fetchPage(currentPage)}
            disabled={isLoadingPage}
          >
            Refresh
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onNavigate('duplicates')}
          >
            Review Duplicates
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
      {/* Scan Summary Banner */}
      <div className="border border-neutral-200 bg-white rounded-md p-4 mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs shadow-xs">
        <div className="flex items-center gap-4">
          <div>
            <span className="text-neutral-400 block text-[11px]">Indexed Files</span>
            <span className="font-bold text-neutral-900 text-sm font-mono">
              {currentScanData.total_files.toLocaleString()}
            </span>
          </div>
          <div className="h-6 w-px bg-neutral-200" />
          <div>
            <span className="text-neutral-400 block text-[11px]">Total Volume</span>
            <span className="font-bold text-neutral-900 text-sm font-mono">
              {formatBytes(currentScanData.total_scanned_bytes)}
            </span>
          </div>
          <div className="h-6 w-px bg-neutral-200" />
          <div>
            <span className="text-neutral-400 block text-[11px]">Target Directory</span>
            <span className="font-mono text-neutral-700 max-w-xs truncate block" title={currentScanData.target_path}>
              {currentScanData.target_path}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-neutral-400">
            ID: {currentScanData.scan_id.slice(0, 8)}...
          </span>
          <StatusIndicator label="Active Scan" variant="success" />
        </div>
      </div>

      {/* Skipped Entries Warning (if any skipped due to permissions / symlinks) */}
      {currentScanData.skipped_entries && currentScanData.skipped_entries.length > 0 && (
        <div className="border border-neutral-300 bg-neutral-50 rounded-md p-3 mb-4 flex items-start gap-2.5 text-xs text-neutral-700">
          <AlertTriangle className="w-4 h-4 text-neutral-800 shrink-0 mt-0.5" />
          <div>
            <span className="font-medium text-neutral-900">
              {currentScanData.skipped_entries.length} item(s) skipped for safety or access limits:
            </span>
            <ul className="list-disc list-inside mt-1 text-[11px] text-neutral-600 space-y-0.5">
              {currentScanData.skipped_entries.slice(0, 3).map((entry, idx) => (
                <li key={idx}>
                  <code className="font-mono">{entry.path}</code> — {entry.reason}
                </li>
              ))}
              {currentScanData.skipped_entries.length > 3 && (
                <li className="italic">
                  ...and {currentScanData.skipped_entries.length - 3} more skipped entries.
                </li>
              )}
            </ul>
          </div>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative w-full">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search current page files or paths..."
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-neutral-200 rounded-md bg-white text-neutral-900 focus:outline-hidden focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-neutral-500 border border-neutral-200 rounded-md px-2.5 py-1.5 bg-white">
            <Filter className="w-3.5 h-3.5 text-neutral-400" />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-transparent text-xs font-medium text-neutral-800 focus:outline-hidden cursor-pointer"
            >
              <option value="all">All Categories</option>
              <option value="documents">Documents</option>
              <option value="images">Images</option>
              <option value="videos">Videos</option>
              <option value="audio">Audio</option>
              <option value="archives">Archives</option>
              <option value="code">Code</option>
              <option value="other">Other</option>
            </select>
          </div>

          <span className="text-xs text-neutral-600 font-mono">
            {filteredFiles.length} files shown
          </span>
        </div>
      </div>

      {/* Error state on paginated fetch */}
      {pageError && (
        <div className="border border-neutral-300 bg-neutral-50 p-3 rounded-md text-xs text-neutral-800 mb-3">
          {pageError}
        </div>
      )}

      {/* Loading or Main Table or Empty State */}
      {isLoadingPage ? (
        <div className="border border-neutral-200 rounded-md bg-white p-8">
          <LoadingIndicator label="Loading scan page..." />
        </div>
      ) : currentScanData.total_files === 0 ? (
        <EmptyState
          icon={<FileQuestion className="w-5 h-5 text-neutral-400" />}
          title="Directory Is Empty"
          description={`The directory "${currentScanData.target_path}" contains 0 files.`}
          action={
            <Button variant="secondary" size="sm" onClick={() => onNavigate('scanning')}>
              Scan Different Folder
            </Button>
          }
        />
      ) : filteredFiles.length === 0 ? (
        <EmptyState
          icon={<FileQuestion className="w-5 h-5 text-neutral-400" />}
          title="No Matching Files on Page"
          description={`No files match your search criteria "${searchQuery}".`}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory('all');
              }}
            >
              Reset Filters
            </Button>
          }
        />
      ) : (
        <div className="flex-1 flex flex-col justify-between">
          <Table<FileMetadata>
            columns={columns}
            data={filteredFiles}
            keyExtractor={(item) => item.relative_path}
          />

          {/* Pagination Controls */}
          <div className="flex items-center justify-between pt-4 mt-2 border-t border-neutral-100 text-xs text-neutral-500">
            <div>
              Page {currentPage} of {totalPages} ({currentScanData.total_files.toLocaleString()} total files)
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={currentPage <= 1 || isLoadingPage}
                onClick={() => fetchPage(currentPage - 1)}
                leftIcon={<ChevronLeft className="w-3.5 h-3.5" />}
              >
                Previous
              </Button>
              <span className="font-mono text-neutral-700 px-2">
                {currentPage} / {totalPages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={!currentScanData.has_more || isLoadingPage}
                onClick={() => fetchPage(currentPage + 1)}
                rightIcon={<ChevronRight className="w-3.5 h-3.5" />}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
};
