/**
 * TEMPORARY STUB for the proposed DS `ActionBar` (ds-request(web): #674 or #675; DS plan
 * #195: pane footer / save bar). Delete when `@hg/ui-web/proposed` exports it.
 *
 * The footer of an editing pane: what is unsaved on the left, the actions on the right.
 * When it has to ask before going on (leave without saving, save and close now) the same
 * bar turns into an in-page `alertdialog` — never a modal: its title takes focus, Escape
 * chooses `onCancel` (the least-change answer).
 */
import { useEffect, useId, useRef, type ReactNode } from 'react';

export interface ActionBarConfirm {
  title: string;
  body: ReactNode;
  /** Escape. The first button in `actions` should be this same least-change answer. */
  onCancel: () => void;
  actions: ReactNode;
}

export interface ActionBarProps {
  title: ReactNode;
  description?: ReactNode;
  /** Why the primary action is disabled; `id` is what the button's aria-describedby names. */
  hint?: { id: string; text: string };
  actions: ReactNode;
  /** Replaces the bar with an in-page confirmation. */
  confirm?: ActionBarConfirm | null;
  testId?: string;
}

export function ActionBar({ title, description, hint, actions, confirm, testId }: ActionBarProps) {
  const id = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  // Focus moves when the confirmation opens or changes kind, not on every parent render (the
  // parent builds a fresh `confirm` object each time; a poll or a toast re-renders it).
  const confirmTitle = confirm?.title ?? null;
  useEffect(() => {
    if (confirmTitle !== null) titleRef.current?.focus();
  }, [confirmTitle]);

  if (confirm) {
    return (
      <div
        role="alertdialog"
        aria-labelledby={`${id}-t`}
        aria-describedby={`${id}-b`}
        data-testid={testId}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            confirm.onCancel();
          }
        }}
        className="flex flex-wrap items-center gap-3 border-t-2 border-line-strong bg-surface-raised px-4 py-3"
      >
        <div className="min-w-[280px] flex-1">
          <h3 id={`${id}-t`} ref={titleRef} tabIndex={-1} className="hg-focus text-[17px] font-bold outline-none">
            {confirm.title}
          </h3>
          <p id={`${id}-b`} className="text-[15px] leading-[21px] text-fg-primary">
            {confirm.body}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">{confirm.actions}</div>
      </div>
    );
  }

  return (
    <div data-testid={testId} className="flex flex-wrap items-center gap-3 border-t border-line-decorative bg-surface-raised px-4 py-3">
      <div className="min-w-[280px] flex-1">
        <p className="text-[16px] font-semibold text-fg-primary">{title}</p>
        {description ? <p className="text-[14px] tabular-nums text-fg-secondary">{description}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {hint ? (
          <span id={hint.id} className="text-[14px] text-fg-secondary">
            {hint.text}
          </span>
        ) : null}
        {actions}
      </div>
    </div>
  );
}
