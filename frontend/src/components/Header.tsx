import type React from 'react';
import type { NavScreenId } from '../types';
import { StatusIndicator } from './StatusIndicator';
import { ShieldCheck, HardDrive } from 'lucide-react';

interface HeaderProps {
  currentScreen: NavScreenId;
  screenTitle: string;
}

export const Header: React.FC<HeaderProps> = ({ screenTitle }) => {
  return (
    <header className="h-12 border-b border-neutral-200 bg-white px-6 flex items-center justify-between shrink-0 select-none">
      {/* Breadcrumb / Title */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-neutral-400 font-medium">Project Janitor</span>
        <span className="text-neutral-300">/</span>
        <span className="text-neutral-900 font-semibold">{screenTitle}</span>
      </div>

      {/* System Status Indicators */}
      <div className="flex items-center gap-4 text-xs">
        <div className="flex items-center gap-1.5 text-neutral-500">
          <HardDrive className="w-3.5 h-3.5 text-neutral-400" />
          <span>Local Engine</span>
        </div>
        <div className="h-3 w-px bg-neutral-200" />
        <div className="flex items-center gap-1.5 text-neutral-600">
          <ShieldCheck className="w-3.5 h-3.5 text-neutral-700" />
          <span>Read-Only Sandbox</span>
        </div>
        <div className="h-3 w-px bg-neutral-200" />
        <StatusIndicator label="Ready" variant="success" />
      </div>
    </header>
  );
};
