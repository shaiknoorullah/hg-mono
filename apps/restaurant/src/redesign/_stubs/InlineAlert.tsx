/**
 * TEMPORARY STUB for the proposed DS `Banner` / `InlineAlert` (ds-request(web): #191, rebuilt in
 * W4 per `packages/ui-web/src/ds/STATUS.md`). Delete when `@hg/ui-web/proposed` exports a Banner
 * that takes a `role`, focus and an error-summary list: the legacy `Banner` fixes its role by
 * tone and cannot take focus, which the sign-in boards need (SI §0 "Banner").
 *
 * Drawn as: a row with a 20px glyph, then a bold title and the body; padding 12/16, radius 12,
 * 1px border. Tones are tints only: `danger` (sign-in errors, never a halal state), `warning`,
 * `info` and `neutral` (offline / couldn't reach: sunken surface, strong border).
 *
 * `blocking` alerts are `role="alert"` with `tabIndex=-1` and take focus when they mount
 * (remount with a new `key` to move focus again after a second failure); every other alert is
 * `role="status"` and never moves focus. `items` turns it into an error summary: each entry is
 * a link that moves focus to its field.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { GlyphIcon, type GlyphName } from './GlyphIcon';

export type InlineAlertTone = 'danger' | 'warning' | 'info' | 'neutral';

export interface InlineAlertSummaryItem {
  /** The field's id: the link's `href` is `#id`. */
  targetId: string;
  label: string;
  /** Moves focus to the field (a control whose id the page cannot set passes its own). */
  onActivate?: () => void;
}

export interface InlineAlertProps {
  tone: InlineAlertTone;
  title: ReactNode;
  children?: ReactNode;
  icon?: GlyphName;
  /** role=alert, tabIndex=-1, focused on mount. Default false (role=status). */
  blocking?: boolean;
  items?: InlineAlertSummaryItem[];
  id?: string;
  testId?: string;
}

const TONE: Record<InlineAlertTone, { box: string; icon: string; glyph: GlyphName }> = {
  danger: {
    box: 'border-feedback-danger-border bg-feedback-danger-tint text-feedback-danger-tint-text',
    icon: 'text-feedback-danger-icon',
    glyph: 'error',
  },
  warning: {
    box: 'border-feedback-warning-border bg-feedback-warning-tint text-feedback-warning-tint-text',
    icon: 'text-feedback-warning-icon',
    glyph: 'warning',
  },
  info: {
    box: 'border-feedback-info-border bg-feedback-info-tint text-feedback-info-tint-text',
    icon: 'text-feedback-info-icon',
    glyph: 'info',
  },
  neutral: { box: 'border-line-strong bg-surface-sunken text-fg-primary', icon: 'text-fg-primary', glyph: 'warning' },
};

export function InlineAlert({ tone, title, children, icon, blocking = false, items, id, testId = 'InlineAlert' }: InlineAlertProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (blocking) ref.current?.focus();
  }, [blocking]);
  const t = TONE[tone];
  return (
    <div
      ref={ref}
      id={id}
      role={blocking ? 'alert' : 'status'}
      tabIndex={blocking ? -1 : undefined}
      data-testid={testId}
      data-tone={tone}
      className={`hg-focus flex items-start gap-3 rounded-[12px] border px-4 py-3 text-body-md ${t.box}`}
    >
      <span className={`mt-0.5 inline-flex shrink-0 ${t.icon}`}>
        <GlyphIcon name={icon ?? t.glyph} size="md" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1 leading-normal">
        <strong className="text-label-lg">{title}</strong>
        {children}
        {items && items.length > 0 ? (
          <ul className="m-0 flex list-none flex-col p-0">
            {items.map((item) => (
              <li key={item.targetId}>
                <a
                  href={`#${item.targetId}`}
                  className="hg-focus inline-flex min-h-11 items-center font-semibold text-feedback-danger-tint-text underline"
                  onClick={(e) => {
                    e.preventDefault();
                    if (item.onActivate) item.onActivate();
                    else document.getElementById(item.targetId)?.focus();
                  }}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
