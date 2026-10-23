import React from 'react';

interface PageContainerProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const PageContainer: React.FC<PageContainerProps> = ({
  title,
  subtitle,
  actions,
  children,
  className = '',
}) => {
  return (
    <div className={`flex flex-col h-full overflow-y-auto p-6 md:p-8 ${className}`}>
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-neutral-200 shrink-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-neutral-900">{title}</h1>
          {subtitle && <p className="text-xs text-neutral-500 mt-1">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2.5 shrink-0">{actions}</div>}
      </div>

      {/* Main Content Body */}
      <div className="pt-6 flex-1 flex flex-col">{children}</div>
    </div>
  );
};
