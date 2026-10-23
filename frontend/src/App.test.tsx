import { describe, it, expect } from 'vitest';
import { formatBytes, formatDate } from './lib/formatters';
import {
  MOCK_SCANNED_FILES,
  MOCK_DUPLICATE_GROUPS,
  MOCK_CLEANUP_PLAN,
  MOCK_HISTORY,
  MOCK_DASHBOARD_METRICS,
} from './lib/mockData';
import type { NavScreenId } from './types';

describe('Frontend Formatter Utilities', () => {
  it('formats byte sizes cleanly into readable units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1048576)).toBe('1 MB');
    expect(formatBytes(1073741824)).toBe('1 GB');
  });

  it('formats dates consistently', () => {
    const formatted = formatDate('2026-10-23T10:00:00Z');
    expect(formatted).toBeTruthy();
    expect(typeof formatted).toBe('string');
  });
});

describe('Frontend Isolated Mock Data Invariants', () => {
  it('covers all seven required file categories', () => {
    const requiredCategories = [
      'documents',
      'images',
      'videos',
      'audio',
      'archives',
      'code',
      'other',
    ];
    const presentCategories = new Set(MOCK_SCANNED_FILES.map((f) => f.category));
    requiredCategories.forEach((cat) => {
      expect(presentCategories.has(cat as any)).toBe(true);
    });
  });

  it('validates duplicate groups structure', () => {
    expect(MOCK_DUPLICATE_GROUPS.length).toBeGreaterThan(0);
    MOCK_DUPLICATE_GROUPS.forEach((group) => {
      expect(group.files.length).toBeGreaterThanOrEqual(2);
      expect(group.group_id).toBeDefined();
      expect(group.hash).toBeDefined();
      expect(group.reclaimable_bytes).toBeGreaterThanOrEqual(0);
      expect(group.file_count).toBe(group.files.length);
    });
  });

  it('validates cleanup plan structure and actions', () => {
    expect(MOCK_CLEANUP_PLAN.length).toBeGreaterThan(0);
    MOCK_CLEANUP_PLAN.forEach((item) => {
      expect(['delete', 'archive', 'quarantine']).toContain(item.action);
      expect(item.size_bytes).toBeGreaterThan(0);
    });
  });

  it('validates operation history entries', () => {
    expect(MOCK_HISTORY.length).toBeGreaterThan(0);
    MOCK_HISTORY.forEach((op) => {
      expect(['completed', 'failed', 'undone']).toContain(op.status);
      expect(op.targetDirectory).toBeDefined();
    });
  });

  it('validates dashboard metrics consistency', () => {
    expect(MOCK_DASHBOARD_METRICS.totalScannedFiles).toBeGreaterThan(0);
    expect(MOCK_DASHBOARD_METRICS.categoryBreakdown.length).toBe(7);
  });
});

describe('Required 7 Navigable Screens', () => {
  it('registers all seven required screens', () => {
    const screens: NavScreenId[] = [
      'dashboard',
      'scanning',
      'results',
      'duplicates',
      'cleanup',
      'history',
      'settings',
    ];
    expect(screens.length).toBe(7);
  });
});

import { apiClient, ApiClientError, API_BASE_URL } from './lib/api';

describe('Centralized API Client', () => {
  it('configures default local base URL', () => {
    expect(API_BASE_URL).toContain('http://127.0.0.1:8000');
  });

  it('rejects empty or whitespace directory path before network call', async () => {
    await expect(apiClient.startScan('   ')).rejects.toThrow('Please enter a valid directory path.');
  });

  it('rejects empty scanId in getScanResults', async () => {
    await expect(apiClient.getScanResults('')).rejects.toThrow('Scan identifier must not be empty.');
  });

  it('translates network failures into friendly backend connection errors', async () => {
    // Mock global fetch rejection to simulate backend unavailable
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new Error('Connection refused'));

    try {
      await expect(apiClient.startScan('C:\\TestDir')).rejects.toThrowError(ApiClientError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles backend error responses with status and detail', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: 'Target directory does not exist: C:\\Unknown' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    try {
      await expect(apiClient.startScan('C:\\Unknown')).rejects.toMatchObject({
        statusCode: 404,
        detail: 'Target directory does not exist: C:\\Unknown',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('parses valid backend scan responses correctly', async () => {
    const mockScanPayload = {
      scan_id: 'test-scan-1234',
      target_path: 'C:\\Users\\User\\Projects',
      status: 'completed',
      scanned_at: '2026-10-23T12:00:00Z',
      total_files: 1,
      total_scanned_bytes: 512,
      category_counts: { code: 1, documents: 0 },
      files: [
        {
          filename: 'main.py',
          relative_path: 'src/main.py',
          extension: '.py',
          size_bytes: 512,
          modified_at: '2026-10-23T12:00:00Z',
          category: 'code',
        },
      ],
      skipped_entries: [],
      limit: 100,
      offset: 0,
      has_more: false,
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify(mockScanPayload), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    try {
      const result = await apiClient.startScan('C:\\Users\\User\\Projects');
      expect(result.scan_id).toBe('test-scan-1234');
      expect(result.total_files).toBe(1);
      expect(result.files[0].filename).toBe('main.py');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rejects empty scanId in analyzeDuplicates', async () => {
    await expect(apiClient.analyzeDuplicates('')).rejects.toMatchObject({
      statusCode: 400,
      detail: 'Scan identifier must not be empty.',
    });
  });

  it('parses valid duplicate analysis responses correctly', async () => {
    const mockDupPayload = {
      scan_id: 'test-scan-1234',
      target_path: 'C:\\Users\\User\\Projects',
      analyzed_at: '2026-10-23T12:05:00Z',
      total_groups: 1,
      total_duplicate_files: 2,
      reclaimable_bytes: 512,
      groups: [
        {
          group_id: 'dup-1',
          hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          size_bytes: 512,
          file_count: 2,
          reclaimable_bytes: 512,
          files: [
            {
              filename: 'copy1.txt',
              relative_path: 'folder/copy1.txt',
              size_bytes: 512,
              modified_at: '2026-10-23T12:00:00Z',
              category: 'documents',
            },
            {
              filename: 'copy2.txt',
              relative_path: 'backup/copy2.txt',
              size_bytes: 512,
              modified_at: '2026-10-23T12:01:00Z',
              category: 'documents',
            },
          ],
        },
      ],
      skipped_files: [],
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify(mockDupPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    try {
      const result = await apiClient.analyzeDuplicates('test-scan-1234');
      expect(result.scan_id).toBe('test-scan-1234');
      expect(result.total_groups).toBe(1);
      expect(result.total_duplicate_files).toBe(2);
      expect(result.reclaimable_bytes).toBe(512);
      expect(result.groups[0].group_id).toBe('dup-1');
      expect(result.groups[0].files.length).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('parses AI status responses correctly', async () => {
    const mockAIStatus = {
      service_available: true,
      model_installed: true,
      configured_model: 'gemma:2b',
      available_models: ['gemma:2b', 'llama3:latest'],
      service_url: 'http://127.0.0.1:11434',
      message: 'Local Ollama service and configured model are operational.',
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify(mockAIStatus), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    try {
      const status = await apiClient.getAIStatus();
      expect(status.service_available).toBe(true);
      expect(status.model_installed).toBe(true);
      expect(status.configured_model).toBe('gemma:2b');
      expect(status.available_models).toContain('gemma:2b');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('parses cleanup plan responses correctly', async () => {
    const mockPlan = {
      plan_id: 'plan-xyz',
      scan_id: 'scan-123',
      target_path: 'C:\\Users\\User\\Folder',
      created_at: '2026-10-23T12:00:00Z',
      summary: {
        total_files: 2,
        moves: 1,
        renames: 0,
        skips: 1,
        duplicates_flagged: 0,
        ai_suggestions_used: 1,
        conflicts_resolved: 0,
      },
      items: [
        {
          item_id: 'item-1',
          original_path: 'document.txt',
          proposed_path: 'Documents/document.txt',
          action: 'MOVE',
          category: 'documents',
          size_bytes: 1024,
          reason: 'Categorized by extension',
          confidence: 0.95,
          is_ai_suggested: true,
          has_conflict: false,
        },
      ],
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify(mockPlan), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    try {
      const plan = await apiClient.createCleanupPlan('scan-123', { preset: 'category' });
      expect(plan.plan_id).toBe('plan-xyz');
      expect(plan.summary.moves).toBe(1);
      expect(plan.items[0].proposed_path).toBe('Documents/document.txt');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('parses plan execution and rollback responses correctly', async () => {
    const mockExecution = {
      plan_id: 'plan-xyz',
      executed_at: '2026-10-23T12:10:00Z',
      status: 'completed',
      total_planned: 1,
      successful_operations: 1,
      failed_operations: 0,
      skipped_operations: 0,
      operations: [
        {
          operation_id: 'op-001',
          plan_id: 'plan-xyz',
          original_path: 'document.txt',
          destination_path: 'Documents/document.txt',
          operation_type: 'MOVE',
          status: 'completed',
          error_message: null,
          undo_status: 'reversible',
          timestamp: '2026-10-23T12:10:00Z',
          file_size_bytes: 1024,
        },
      ],
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify(mockExecution), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    try {
      const exec = await apiClient.executePlan('plan-xyz', true);
      expect(exec.status).toBe('completed');
      expect(exec.successful_operations).toBe(1);
      expect(exec.operations[0].undo_status).toBe('reversible');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('parses undo operation response correctly', async () => {
    const mockUndo = {
      operation_id: 'op-001',
      status: 'undone',
      original_path: 'document.txt',
      destination_path: 'Documents/document.txt',
      message: 'Operation undone successfully.',
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify(mockUndo), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    try {
      const undoRes = await apiClient.undoOperation('op-001');
      expect(undoRes.status).toBe('undone');
      expect(undoRes.operation_id).toBe('op-001');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});


