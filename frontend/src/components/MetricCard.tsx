import React from 'react';

interface MetricCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  icon?: React.ReactNode;
  className?: string;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  subtext,
  icon,
  className = '',
}) => {
  return (
    <div
      className={`bg-white border border-neutral-200 rounded-md p-4 flex flex-col justify-between shadow-xs ${className}`}
    >
      <div className="flex items-center justify-between text-neutral-500 mb-2">
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
        {icon && <div className="text-neutral-400">{icon}</div>}
      </div>
      <div className="text-2xl font-semibold text-neutral-900 tracking-tight">{value}</div>
      {subtext && <div className="text-xs text-neutral-500 mt-1">{subtext}</div>}
    </div>
  );
};
