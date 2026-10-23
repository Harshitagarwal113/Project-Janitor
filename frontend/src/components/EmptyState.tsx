import React from 'react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  className = '',
}) => {
  return (
    <div
      className={`border border-dashed border-neutral-200 rounded-md p-10 flex flex-col items-center justify-center text-center bg-neutral-50/50 ${className}`}
    >
      {icon && (
        <div className="w-10 h-10 rounded-full bg-neutral-100 flex items-center justify-center text-neutral-500 mb-3 border border-neutral-200">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
      <p className="text-xs text-neutral-500 mt-1 max-w-sm">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
};
