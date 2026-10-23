import type React from 'react';
import {
  LayoutDashboard,
  FolderSearch,
  FileText,
  Copy,
  ListChecks,
  History,
  Settings,
  Sparkles,
} from 'lucide-react';
import type { NavScreenId } from '../types';

interface SidebarProps {
  currentScreen: NavScreenId;
  onNavigate: (screen: NavScreenId) => void;
  resultsCount?: number;
  duplicatesCount?: number;
  cleanupPlanCount?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentScreen,
  onNavigate,
  resultsCount,
  duplicatesCount,
  cleanupPlanCount,
}) => {
  const navItems: { id: NavScreenId; label: string; icon: React.ReactNode; badge?: string }[] = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: <LayoutDashboard className="w-4 h-4" />,
    },
    {
      id: 'scanning',
      label: 'Folder Scan',
      icon: <FolderSearch className="w-4 h-4" />,
    },
    {
      id: 'results',
      label: 'Scan Results',
      icon: <FileText className="w-4 h-4" />,
      badge: typeof resultsCount === 'number' && resultsCount > 0 ? String(resultsCount) : undefined,
    },
    {
      id: 'duplicates',
      label: 'Duplicate Review',
      icon: <Copy className="w-4 h-4" />,
      badge: typeof duplicatesCount === 'number' && duplicatesCount > 0 ? String(duplicatesCount) : undefined,
    },
    {
      id: 'cleanup',
      label: 'Cleanup Plan',
      icon: <ListChecks className="w-4 h-4" />,
      badge: typeof cleanupPlanCount === 'number' && cleanupPlanCount > 0 ? String(cleanupPlanCount) : undefined,
    },
    {
      id: 'history',
      label: 'History & Audit',
      icon: <History className="w-4 h-4" />,
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: <Settings className="w-4 h-4" />,
    },
  ];

  return (
    <aside className="w-60 bg-white border-r border-neutral-200 flex flex-col justify-between shrink-0 select-none">
      {/* Brand Header */}
      <div>
        <div className="h-12 border-b border-neutral-200 px-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded bg-neutral-900 text-white flex items-center justify-center font-bold text-xs">
              J
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-bold tracking-tight text-neutral-900 leading-none">
                Project Janitor
              </span>
              <span className="text-[10px] text-neutral-400 mt-0.5 font-medium">Desktop Utility</span>
            </div>
          </div>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600 border border-neutral-200">
            v0.1.0
          </span>
        </div>

        {/* Navigation Items */}
        <nav className="p-3 space-y-1">
          <div className="px-2 py-1 text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
            Workspace
          </div>
          {navItems.map((item) => {
            const isActive = currentScreen === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer text-left ${
                  isActive
                    ? 'bg-neutral-900 text-white font-semibold shadow-xs'
                    : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className={isActive ? 'text-white' : 'text-neutral-400'}>{item.icon}</span>
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                      isActive
                        ? 'bg-neutral-800 text-neutral-200'
                        : 'bg-neutral-100 text-neutral-600 border border-neutral-200'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer Info */}
      <div className="p-3 border-t border-neutral-200 text-xs text-neutral-500 bg-neutral-50/50">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-medium text-neutral-600">Privacy Status</span>
          <span className="text-[10px] font-medium text-neutral-500">100% Local</span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-neutral-400">
          <Sparkles className="w-3 h-3 text-neutral-400" />
          <span>No Cloud Sync • Read Safe</span>
        </div>
      </div>
    </aside>
  );
};
