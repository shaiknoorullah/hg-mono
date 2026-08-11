import { useEffect, useState, type ReactNode } from 'react';

import { Button, IconButton } from '../primitives/index.js';
import { cx } from './internal.js';

/**
 * `Banner` — a persistent, non-blocking inline message attached to a region.
 *
 * There is **no `success` variant** (RULE H-1: no filled green outside the halal
 * namespace, and a green banner is exactly the thing that would erode the seal's meaning).
 *
 * The highest-stakes use is the restaurant queue's SSE-disconnect banner
 * (patterns §3.1): "Not receiving new orders — reconnecting." An unnoticed disconnected
 * queue is a missed order, so that one is `danger`, undismissible and prominent.
 */

export type BannerVariant = 'info' | 'warning' | 'danger' | 'neutral';

export interface BannerAction {
  label: string;
  onPress: () => void;
  href?: string;
}

export interface BannerProps {
  variant?: BannerVariant;
  title: string;
  description?: ReactNode;
  action?: BannerAction;
  icon?: ReactNode;
  /**
   * Dismissible banners are dismissed **for this session only**. §37: "a dismissible
   * banner that reports an ongoing condition must reappear if the condition persists
   * across sessions". Nothing here is written to storage, which is what makes that true
   * by construction.
   */
  dismissible?: boolean;
  onDismiss?: () => void;
  /**
   * Identifies the underlying condition. When it changes, a previous dismissal is
   * discarded and the banner comes back — a new disconnect is a new event.
   */
  conditionKey?: string;
  /** `prominent` raises the type scale and the border weight. For the queue banner. */
  emphasis?: 'default' | 'prominent';
  className?: string;
  testId?: string;
}

const VARIANT_STYLE: Record<BannerVariant, string> = {
  info: 'border-feedback-info-border bg-feedback-info-tint text-fg-primary',
  warning: 'border-feedback-warning-border bg-feedback-warning-tint text-fg-primary',
  danger: 'border-feedback-danger-border bg-feedback-danger-tint text-fg-primary',
  neutral: 'border-line-decorative bg-surface-subtle text-fg-primary',
};

/** Severity picks the live-region politeness. Danger interrupts; the rest do not. */
const VARIANT_ROLE: Record<BannerVariant, 'alert' | 'status'> = {
  info: 'status',
  warning: 'status',
  danger: 'alert',
  neutral: 'status',
};

/**
 * Never colour-alone (a11y §1.4). Every variant carries a word in its accessible name in
 * addition to its tint.
 */
const VARIANT_PREFIX: Record<BannerVariant, string> = {
  info: 'Information',
  warning: 'Warning',
  danger: 'Problem',
  neutral: 'Notice',
};

export function Banner({
  variant = 'info',
  title,
  description,
  action,
  icon,
  dismissible = false,
  onDismiss,
  conditionKey,
  emphasis = 'default',
  className,
  testId = 'banner',
}: BannerProps): ReactNode {
  const [dismissed, setDismissed] = useState(false);

  // A change of condition resurrects a dismissed banner.
  useEffect(() => {
    setDismissed(false);
  }, [conditionKey]);

  if (dismissed) return null;

  return (
    <div
      data-testid={testId}
      data-variant={variant}
      data-emphasis={emphasis}
      role={VARIANT_ROLE[variant]}
      className={cx(
        'flex w-full items-start gap-3 rounded-md border',
        emphasis === 'prominent' ? 'border-2 p-4' : 'p-3',
        VARIANT_STYLE[variant],
        className,
      )}
    >
      {icon ? (
        <span aria-hidden="true" className="mt-0.5 shrink-0">
          {icon}
        </span>
      ) : null}

      <div className="min-w-0 flex-1">
        <p
          className={cx(
            'font-semibold text-fg-primary',
            emphasis === 'prominent'
              ? 'text-heading-sm'
              : 'text-label-lg',
          )}
        >
          <span className="sr-only">{VARIANT_PREFIX[variant]}: </span>
          {title}
        </p>
        {description ? (
          <div className="mt-1 text-body-sm text-fg-secondary">
            {description}
          </div>
        ) : null}
        {action ? (
          <div className="mt-2">
            <Button variant="tertiary" size="sm" onPress={action.onPress} href={action.href}>
              {action.label}
            </Button>
          </div>
        ) : null}
      </div>

      {dismissible ? (
        <IconButton
          variant="plain"
          size="sm"
          accessibilityLabel={`Dismiss: ${title}`}
          icon={<CloseGlyph />}
          onPress={() => {
            setDismissed(true);
            onDismiss?.();
          }}
        />
      ) : null}
    </div>
  );
}

function CloseGlyph(): ReactNode {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
