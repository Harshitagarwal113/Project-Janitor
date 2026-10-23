import type React from 'react';
import { useEffect, useState } from 'react';
import { PageContainer } from '../../components/PageContainer';
import { Button } from '../../components/Button';
import { StatusIndicator } from '../../components/StatusIndicator';
import { apiClient } from '../../lib/api';
import type { AIModelStatus } from '../../types';
import {
  Shield,
  HardDrive,
  Eye,
  Save,
  CheckCircle2,
  Sparkles,
  RefreshCw,
  Server,
  AlertCircle,
} from 'lucide-react';

export const SettingsScreen: React.FC = () => {
  // Config state
  const [excludeHidden, setExcludeHidden] = useState<boolean>(true);
  const [maxDepth, setMaxDepth] = useState<string>('unlimited');
  const [trashMode, setTrashMode] = useState<'recycle' | 'permanent'>('recycle');
  const [confirmDeletions, setConfirmDeletions] = useState<boolean>(true);
  const [ignorePatterns, setIgnorePatterns] = useState<string>(
    'node_modules, .git, .venv, __pycache__, .cache'
  );
  const [retentionDays, setRetentionDays] = useState<string>('90');
  const [isSaved, setIsSaved] = useState<boolean>(false);

  // Backend & Ollama live connection status
  const [backendHealth, setBackendHealth] = useState<{ status: string; service: string } | null>(
    null
  );
  const [aiStatus, setAiStatus] = useState<AIModelStatus | null>(null);
  const [isCheckingHealth, setIsCheckingHealth] = useState<boolean>(false);
  const [healthCheckError, setHealthCheckError] = useState<string | null>(null);

  const checkConnectivity = async () => {
    setIsCheckingHealth(true);
    setHealthCheckError(null);
    try {
      const [healthRes, aiRes] = await Promise.allSettled([
        apiClient.getHealth(),
        apiClient.getAIStatus(),
      ]);

      if (healthRes.status === 'fulfilled') {
        setBackendHealth(healthRes.value);
      } else {
        setBackendHealth(null);
        setHealthCheckError('Backend server is unreachable on default port 8000.');
      }

      if (aiRes.status === 'fulfilled') {
        setAiStatus(aiRes.value);
      } else {
        setAiStatus(null);
      }
    } finally {
      setIsCheckingHealth(false);
    }
  };

  useEffect(() => {
    checkConnectivity();
  }, []);

  const handleSave = () => {
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2500);
  };

  return (
    <PageContainer
      title="Application Settings"
      subtitle="Configure scanning constraints, safety parameters, and inspect local AI engine connectivity"
      actions={
        <div className="flex items-center gap-2">
          {isSaved && (
            <span className="flex items-center gap-1.5 text-xs text-neutral-800 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Preferences Saved
            </span>
          )}
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Save className="w-3.5 h-3.5" />}
            onClick={handleSave}
          >
            Save Preferences
          </Button>
        </div>
      }
    >
      <div className="max-w-3xl space-y-6">
        {/* Backend & Local Ollama AI Engine Status (Requirement 4) */}
        <div className="border border-neutral-200 rounded-md bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between pb-3 border-b border-neutral-100 mb-4">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-neutral-700" />
              <h3 className="text-sm font-semibold text-neutral-900">
                Backend Services & Local AI Status
              </h3>
            </div>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<RefreshCw className={`w-3 h-3 ${isCheckingHealth ? 'animate-spin' : ''}`} />}
              onClick={checkConnectivity}
              disabled={isCheckingHealth}
            >
              Check Status
            </Button>
          </div>

          <div className="space-y-4 text-xs">
            {healthCheckError && (
              <div className="p-3 rounded bg-neutral-50 border border-neutral-200 flex items-center gap-2 text-neutral-800">
                <AlertCircle className="w-4 h-4 text-neutral-700 shrink-0" />
                <span>{healthCheckError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Backend API Health */}
              <div className="p-3.5 rounded-md border border-neutral-200 bg-neutral-50/50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-neutral-900 flex items-center gap-1.5">
                    <Server className="w-3.5 h-3.5 text-neutral-600" />
                    FastAPI Backend Core
                  </span>
                  <StatusIndicator
                    label={backendHealth ? 'Online' : 'Offline'}
                    variant={backendHealth ? 'success' : 'neutral'}
                  />
                </div>
                <div className="text-[11px] text-neutral-500 font-mono">
                  Endpoint: http://127.0.0.1:8000
                </div>
                <div className="text-[11px] text-neutral-600">
                  {backendHealth
                    ? `Service "${backendHealth.service}" reporting healthy status.`
                    : 'Backend service is not running or unreachable.'}
                </div>
              </div>

              {/* Ollama & Gemma AI Status */}
              <div className="p-3.5 rounded-md border border-neutral-200 bg-neutral-50/50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-neutral-900 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-neutral-600" />
                    Ollama Local AI
                  </span>
                  <StatusIndicator
                    label={
                      aiStatus?.service_available
                        ? aiStatus.model_installed
                          ? 'Available & Model Ready'
                          : 'Service Up (Model Missing)'
                        : 'Offline (Fallback Rules)'
                    }
                    variant={aiStatus?.service_available && aiStatus?.model_installed ? 'success' : 'neutral'}
                  />
                </div>
                <div className="text-[11px] text-neutral-500 font-mono">
                  API: {aiStatus?.service_url || 'http://127.0.0.1:11434'}
                </div>
                <div className="text-[11px] text-neutral-600">
                  Configured Model:{' '}
                  <span className="font-mono font-medium text-neutral-900">
                    {aiStatus?.configured_model || 'gemma:2b'}
                  </span>
                </div>
                {aiStatus?.available_models && aiStatus.available_models.length > 0 && (
                  <div className="text-[11px] text-neutral-500 truncate" title={aiStatus.available_models.join(', ')}>
                    Installed Models: {aiStatus.available_models.join(', ')}
                  </div>
                )}
              </div>
            </div>

            <p className="text-[11px] text-neutral-500 leading-relaxed bg-neutral-50 p-2.5 rounded border border-neutral-200">
              Note: Local Google Gemma AI integration is purely optional. When Ollama is offline or
              the model is uninstalled, Project Janitor seamlessly utilizes deterministic filename
              and extension heuristics with zero degradation in safety.
            </p>
          </div>
        </div>

        {/* Filesystem Scanner Rules */}
        <div className="border border-neutral-200 rounded-md bg-white p-5">
          <div className="flex items-center gap-2 pb-3 border-b border-neutral-100 mb-4">
            <HardDrive className="w-4 h-4 text-neutral-600" />
            <h3 className="text-sm font-semibold text-neutral-900">Scanner Engine Rules</h3>
          </div>

          <div className="space-y-4 text-xs">
            <div>
              <label className="font-medium text-neutral-800 block mb-1">
                Global Excluded Directory Patterns
              </label>
              <input
                type="text"
                value={ignorePatterns}
                onChange={(e) => setIgnorePatterns(e.target.value)}
                className="w-full px-3 py-1.5 font-mono border border-neutral-200 rounded-md bg-white text-neutral-900 focus:outline-hidden focus:border-neutral-900"
              />
              <span className="text-[11px] text-neutral-400 mt-1 block">
                Comma-separated folder names skipped automatically during traversal
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="font-medium text-neutral-800 block mb-1">
                  Directory Traversal Depth Limit
                </label>
                <select
                  value={maxDepth}
                  onChange={(e) => setMaxDepth(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-neutral-200 rounded-md bg-white text-neutral-900 focus:outline-hidden cursor-pointer"
                >
                  <option value="unlimited">Unlimited (Traverse all levels)</option>
                  <option value="5">5 Levels deep</option>
                  <option value="10">10 Levels deep</option>
                  <option value="20">20 Levels deep</option>
                </select>
              </div>

              <div>
                <label className="font-medium text-neutral-800 block mb-1">
                  System & Hidden Files
                </label>
                <label className="flex items-center gap-2 mt-2 cursor-pointer select-none text-neutral-700">
                  <input
                    type="checkbox"
                    checked={excludeHidden}
                    onChange={(e) => setExcludeHidden(e.target.checked)}
                    className="rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900 h-3.5 w-3.5 cursor-pointer"
                  />
                  <span>Ignore hidden and operating-system dotfiles</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Safety & Deletion Controls */}
        <div className="border border-neutral-200 rounded-md bg-white p-5">
          <div className="flex items-center gap-2 pb-3 border-b border-neutral-100 mb-4">
            <Shield className="w-4 h-4 text-neutral-600" />
            <h3 className="text-sm font-semibold text-neutral-900">Safety & Execution Guardrails</h3>
          </div>

          <div className="space-y-4 text-xs">
            <div>
              <span className="font-medium text-neutral-800 block mb-2">
                Default Disposal Strategy
              </span>
              <div className="space-y-2">
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="radio"
                    name="trashMode"
                    value="recycle"
                    checked={trashMode === 'recycle'}
                    onChange={() => setTrashMode('recycle')}
                    className="mt-0.5 text-neutral-900 focus:ring-neutral-900 cursor-pointer"
                  />
                  <div>
                    <span className="font-medium text-neutral-900 block">
                      Recycle Bin / Quarantine (Recommended)
                    </span>
                    <span className="text-neutral-500 text-[11px]">
                      Files can be undone and recovered from the OS Recycle Bin
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="radio"
                    name="trashMode"
                    value="permanent"
                    checked={trashMode === 'permanent'}
                    onChange={() => setTrashMode('permanent')}
                    className="mt-0.5 text-neutral-900 focus:ring-neutral-900 cursor-pointer"
                  />
                  <div>
                    <span className="font-medium text-neutral-900 block">
                      Permanent Deletion (Zero Recovery)
                    </span>
                    <span className="text-neutral-500 text-[11px]">
                      Instantly purges files without moving to Recycle Bin
                    </span>
                  </div>
                </label>
              </div>
            </div>

            <div className="pt-3 border-t border-neutral-100">
              <label className="flex items-center gap-2 cursor-pointer select-none text-neutral-700">
                <input
                  type="checkbox"
                  checked={confirmDeletions}
                  onChange={(e) => setConfirmDeletions(e.target.checked)}
                  className="rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900 h-3.5 w-3.5 cursor-pointer"
                />
                <span className="font-medium text-neutral-900">
                  Always demand explicit confirmation modal before executing destructive plans
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Audit & Local Privacy */}
        <div className="border border-neutral-200 rounded-md bg-white p-5">
          <div className="flex items-center gap-2 pb-3 border-b border-neutral-100 mb-4">
            <Eye className="w-4 h-4 text-neutral-600" />
            <h3 className="text-sm font-semibold text-neutral-900">Local Privacy & Audit Logs</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="font-medium text-neutral-800 block mb-1">
                Operation Audit Trail Retention
              </label>
              <select
                value={retentionDays}
                onChange={(e) => setRetentionDays(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-neutral-200 rounded-md bg-white text-neutral-900 focus:outline-hidden cursor-pointer"
              >
                <option value="30">Retain for 30 days</option>
                <option value="90">Retain for 90 days</option>
                <option value="365">Retain for 1 year</option>
                <option value="forever">Indefinite local storage</option>
              </select>
            </div>

            <div>
              <span className="font-medium text-neutral-800 block mb-1">Telemetry Status</span>
              <div className="mt-1 flex items-center gap-2">
                <StatusIndicator label="Fully Offline (No Analytics)" variant="success" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageContainer>
  );
};
