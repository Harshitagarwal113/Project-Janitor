import { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { DashboardScreen } from './features/dashboard/DashboardScreen';
import { FolderScanningScreen } from './features/scanning/FolderScanningScreen';
import { ScanResultsScreen } from './features/results/ScanResultsScreen';
import { DuplicateReviewScreen } from './features/duplicates/DuplicateReviewScreen';
import { CleanupPlanScreen } from './features/cleanup/CleanupPlanScreen';
import { HistoryScreen } from './features/history/HistoryScreen';
import { SettingsScreen } from './features/settings/SettingsScreen';
import type {
  CleanupPlanResponse,
  ExecutionResponse,
  NavScreenId,
  ScanResponse,
} from './types';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<NavScreenId>('dashboard');
  const [activeScan, setActiveScan] = useState<ScanResponse | null>(null);
  const [activePlan, setActivePlan] = useState<CleanupPlanResponse | null>(null);
  const [, setLastExecution] = useState<ExecutionResponse | null>(null);

  const screenTitles: Record<NavScreenId, string> = {
    dashboard: 'Dashboard',
    scanning: 'Folder Scanner',
    results: 'Scan Results',
    duplicates: 'Duplicate Review',
    cleanup: 'Cleanup Plan Review',
    history: 'Operation History',
    settings: 'Settings',
  };

  const handleScanSuccess = (scan: ScanResponse) => {
    setActiveScan(scan);
    // Reset plan when a new directory is scanned
    setActivePlan(null);
  };

  const renderActiveScreen = () => {
    switch (currentScreen) {
      case 'dashboard':
        return (
          <DashboardScreen
            onNavigate={setCurrentScreen}
            activeScan={activeScan}
          />
        );
      case 'scanning':
        return (
          <FolderScanningScreen
            onNavigate={setCurrentScreen}
            onScanSuccess={handleScanSuccess}
            currentScan={activeScan}
          />
        );
      case 'results':
        return (
          <ScanResultsScreen
            onNavigate={setCurrentScreen}
            activeScan={activeScan}
            onScanUpdate={setActiveScan}
          />
        );
      case 'duplicates':
        return (
          <DuplicateReviewScreen
            onNavigate={setCurrentScreen}
            activeScan={activeScan}
          />
        );
      case 'cleanup':
        return (
          <CleanupPlanScreen
            onNavigate={setCurrentScreen}
            activeScan={activeScan}
            activePlan={activePlan}
            onPlanCreated={setActivePlan}
            onPlanExecuted={setLastExecution}
          />
        );
      case 'history':
        return (
          <HistoryScreen
            onNavigate={setCurrentScreen}
            activePlan={activePlan}
          />
        );
      case 'settings':
        return <SettingsScreen />;
      default:
        return (
          <DashboardScreen
            onNavigate={setCurrentScreen}
            activeScan={activeScan}
          />
        );
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white text-neutral-900 font-sans">
      {/* Fixed Left Navigation Sidebar */}
      <Sidebar
        currentScreen={currentScreen}
        onNavigate={setCurrentScreen}
        resultsCount={activeScan?.total_files}
        cleanupPlanCount={activePlan?.items.length}
      />

      {/* Main Content Area */}
      <div className="flex flex-col flex-1 min-w-0 h-full overflow-hidden">
        {/* Compact Desktop Header */}
        <Header currentScreen={currentScreen} screenTitle={screenTitles[currentScreen]} />

        {/* Scrollable Screen Viewport */}
        <main className="flex-1 overflow-hidden bg-white relative">
          {renderActiveScreen()}
        </main>
      </div>
    </div>
  );
}
