/**
 * TEMPORARY STUB for the proposed DS `InlineConfirm` (DS plan §2.2, #192; ds-request(web):
 * InlineConfirm). Delete when `@hg/ui-web/proposed` exports it.
 *
 * A confirmation in the page (not a dialog): icon, heading, body, and buttons on the right.
 * The first focus goes to the least-change button; Escape chooses it.
 */
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon, type IconName } from '@hg/ui-web/primitives';

export interface InlineConfirmAction {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'tertiary' | 'ghost';
  loading?: boolean;
}

export interface InlineConfirmProps {
  icon?: IconName | 'warning' | 'info';
  title: string;
  body: ReactNode;
  /** The least-change action: first focus, and Escape. */
  cancel: InlineConfirmAction;
  actions: readonly InlineConfirmAction[];
  testId?: string;
}

const VARIANT = {
  primary: 'bg-action-primary-bg text-action-primary-fg',
  secondary: 'bg-action-secondary-bg text-action-secondary-fg',
  tertiary: 'border border-action-tertiary-border text-action-tertiary-fg bg-transparent',
  ghost: 'bg-transparent text-fg-primary underline-offset-2 hover:underline',
} as const;

export function InlineConfirm({ icon, title, body, cancel, actions, testId }: InlineConfirmProps) {
  const id = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);
  // The DS Solar set has no warning/info glyph yet (#198): those draw no icon until it does.
  const glyph: IconName | null = icon === 'warning' || icon === 'info' ? null : (icon ?? null);
  const button = (a: InlineConfirmAction, ref?: React.Ref<HTMLButtonElement>) => (
    <button
      key={a.label}
      ref={ref}
      type="button"
      onClick={a.onPress}
      disabled={a.loading}
      aria-busy={a.loading || undefined}
      className={`hg-focus min-h-12 rounded-md px-4 text-[17px] font-semibold disabled:opacity-60 ${VARIANT[a.variant ?? 'secondary']}`}
    >
      {a.label}
    </button>
  );
  return (
    <section
      role="group"
      aria-labelledby={`${id}-t`}
      data-testid={testId}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          cancel.onPress();
        }
      }}
      className="flex flex-wrap items-center gap-4 rounded-md border-2 border-line-strong bg-surface-raised px-4 py-3 text-fg-primary shadow-sm"
    >
      {glyph ? <Icon name={glyph} size={28} className="text-fg-secondary" /> : null}
      <div className="min-w-0 flex-1">
        <h2 id={`${id}-t`} className="text-[17px] font-bold">
          {title}
        </h2>
        <p className="text-[15px] leading-[21px]">{body}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {button({ ...cancel, variant: cancel.variant ?? 'tertiary' }, cancelRef)}
        {actions.map((a) => button(a))}
      </div>
    </section>
  );
}
