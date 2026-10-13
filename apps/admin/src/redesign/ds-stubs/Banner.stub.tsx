/**
 * TEMPORARY stub until @hg/ui-web/ds ships Banner (ds-request issue TBD; tracked under #191).
 * Props follow the canvases' drawing (`ASS/AlertBanner*`, `ASS/SystemBannerStack`,
 * `RV/Shell-Banners`: "Banner (shadcn Alert + design system Icon/Button)").
 *
 * A page-level system banner across the top of the working area: offline, reconnecting,
 * degraded dependencies, a staging environment. Tones are tints: `neutral`, `info`,
 * `warning`, `danger` and `slate`. Use `slate` for anything halal ("we can't currently
 * vouch"); NEVER `danger` for a halal state, and there is no solid danger fill at all.
 * `role="status"` by default (announced, never steals focus); pass `announce="alert"` only
 * for a high-severity banner that must interrupt.
 */
import type { ReactNode } from 'react';

import { Button } from './adapters/Button.adapter';
import { Icon, type AnyIconName } from './adapters/Icon.adapter';
import { IconButton } from './adapters/IconButton.adapter';
import { cx } from './internal/cx';
import { TONE_CLASS, TONE_ICON } from './internal/tones';

export type BannerTone = 'neutral' | 'info' | 'warning' | 'danger' | 'slate';

export interface BannerAction {
  label: string;
  onPress?: () => void;
  /** Renders the action as a link. */
  href?: string;
}

export interface BannerProps {
  tone?: BannerTone;
  title: string;
  description?: ReactNode;
  /** One action: a `{ label, onPress | href }` drawn as a tertiary Button, or any node. */
  action?: BannerAction | ReactNode;
  /** Shows a 44px dismiss button named "Dismiss: {title}". */
  dismissible?: boolean;
  onDismiss?: () => void;
  /** Override the glyph (default by tone). */
  icon?: AnyIconName;
  /** status (default) · alert · none (inside another live region). */
  announce?: 'status' | 'alert' | 'none';
  className?: string;
  testId?: string;
}

function isAction(value: unknown): value is BannerAction {
  return typeof value === 'object' && value !== null && 'label' in value && !('$$typeof' in value);
}

export function Banner({
  tone = 'neutral',
  title,
  description,
  action,
  dismissible,
  onDismiss,
  icon,
  announce = 'status',
  className,
  testId = 'Banner',
}: BannerProps): React.JSX.Element {
  const t = TONE_CLASS[tone];
  return (
    <div
      role={announce === 'none' ? undefined : announce}
      data-testid={testId}
      data-tone={tone}
      className={cx('flex w-full items-start gap-3 border-b px-4 py-2', t.box, className)}
    >
      <span className={cx('mt-0.5 inline-flex', t.icon)}>
        <Icon name={icon ?? TONE_ICON[tone]} size="md" />
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <p className={cx('text-label-lg font-semibold', t.title)}>{title}</p>
        {description ? <div className={cx('text-body-md', t.body)}>{description}</div> : null}
        {action ? (
          <div className="ms-auto">
            {isAction(action) ? (
              <Button variant="tertiary" size="sm" {...(action.href ? { href: action.href } : {})} {...(action.onPress ? { onPress: () => action.onPress?.() } : {})}>
                {action.label}
              </Button>
            ) : (
              action
            )}
          </div>
        ) : null}
      </div>
      {dismissible ? (
        <IconButton icon="close" size="sm" accessibilityLabel={`Dismiss: ${title}`} onPress={() => onDismiss?.()} />
      ) : null}
    </div>
  );
}
