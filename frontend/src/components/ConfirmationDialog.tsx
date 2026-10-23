import React, { useEffect } from 'react';
import { Button } from './Button';

interface ConfirmationDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  isLoading?: boolean;
  confirmDisabled?: boolean;
  maxWidth?: string;
  children?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  isOpen,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isDestructive = false,
  isLoading = false,
  confirmDisabled = false,
  maxWidth = 'max-w-md',
  children,
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-900/40 backdrop-blur-xs">
      <div
        className={`bg-white rounded-lg border border-neutral-200 shadow-lg ${maxWidth} w-full p-6 animate-in fade-in zoom-in-95 duration-100 max-h-[90vh] flex flex-col`}
        role="dialog"
        aria-modal="true"
      >
        <h3 className="text-base font-semibold text-neutral-900 shrink-0">{title}</h3>
        <p className="text-sm text-neutral-600 mt-2 leading-relaxed shrink-0">{description}</p>
        {children && <div className="mt-4 flex-1 overflow-y-auto">{children}</div>}
        <div className="mt-6 flex items-center justify-end gap-2.5 shrink-0 pt-2 border-t border-neutral-100">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={isLoading}>
            {cancelLabel}
          </Button>
          <Button
            variant={isDestructive ? 'primary' : 'primary'}
            size="sm"
            onClick={onConfirm}
            isLoading={isLoading}
            disabled={confirmDisabled || isLoading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};
