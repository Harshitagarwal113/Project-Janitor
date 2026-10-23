import React from 'react';

export type StatusVariant = 'default' | 'neutral' | 'success' | 'warning' | 'error';

interface StatusIndicatorProps {
  label: string;
  variant?: StatusVariant;
  dotOnly?: boolean;
  className?: string;
}

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  label,
  variant = 'neutral',
  dotOnly = false,
  className = '',
}) => {
  const dotColor = {
    default: 'bg-neutral-400',
    neutral: 'bg-neutral-500',
    success: 'bg-neutral-800',
    warning: 'bg-neutral-600',
    error: 'bg-neutral-900',
  }[variant];

  if (dotOnly) {
    return <span className={`inline-block w-2 h-2 rounded-full ${dotColor} ${className}`} />;
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium border border-neutral-200 bg-neutral-50 text-neutral-700 ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      <span>{label}</span>
    </span>
  );
};
