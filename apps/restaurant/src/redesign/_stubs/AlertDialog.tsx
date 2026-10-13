/**
 * TEMPORARY STUB for the DS `Dialog` alert variant (live index.d.ts `Dialog`/`Modal`
 * variant `alert`; ds-request(web): Dialog alert variant). Delete when the DS exports it.
 * `@hg/ui-web`'s `ConfirmDialog` always draws a Cancel, and the restaurant's one blocking
 * dialog (LO `Board-signed-out-sheet`) has exactly one action and cannot be dismissed.
 *
 * Non-dismissible: Escape does nothing, the scrim does nothing, focus stays inside.
 */
import { useEffect, useId, useRef, type ReactNode } from 'react';

export interface AlertDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  actionLabel: string;
  onAction: () => void;
  testId?: string;
}

export function AlertDialog({ open, title, description, actionLabel, onAction, testId }: AlertDialogProps) {
  const id = useId();
  const actionRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) actionRef.current?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-surface-scrim p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        aria-describedby={`${id}-d`}
        data-testid={testId}
        className="w-full max-w-[520px] rounded-xl bg-surface-raised p-6 text-fg-primary shadow-xl"
        onKeyDown={(e) => {
          if (e.key === 'Escape') e.preventDefault();
          if (e.key === 'Tab') {
            // One action: keep focus on it.
            e.preventDefault();
            actionRef.current?.focus();
          }
        }}
      >
        <h2 id={`${id}-t`} className="text-[22px] font-bold leading-7">
          {title}
        </h2>
        <p id={`${id}-d`} className="mt-3 text-[17px] leading-[26px] text-fg-secondary">
          {description}
        </p>
        <div className="mt-6 flex justify-end">
          <button
            ref={actionRef}
            type="button"
            onClick={onAction}
            className="hg-focus min-h-12 rounded-md bg-action-primary-bg px-5 text-[17px] font-semibold text-action-primary-fg"
          >
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
