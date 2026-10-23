import React from 'react';

interface LoadingIndicatorProps {
  label?: string;
  subtext?: string;
  size?: 'sm' | 'md' | 'lg';
  progress?: number;
  className?: string;
}

export const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({
  label = 'Processing...',
  subtext,
  size = 'md',
  progress,
  className = '',
}) => {
  const spinnerSizes = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
  };

  return (
    <div className={`flex flex-col items-center justify-center p-8 text-center ${className}`}>
      <svg
        className={`animate-spin text-neutral-800 ${spinnerSizes[size]} mb-3`}
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          className="opacity-20"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="3"
        />
        <path
          className="opacity-90"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
      <div className="text-sm font-medium text-neutral-900">{label}</div>
      {subtext && <div className="text-xs text-neutral-500 mt-1 max-w-sm">{subtext}</div>}

      {typeof progress === 'number' && (
        <div className="w-48 bg-neutral-100 rounded-full h-1.5 mt-3 overflow-hidden border border-neutral-200">
          <div
            className="bg-neutral-900 h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}
    </div>
  );
};
