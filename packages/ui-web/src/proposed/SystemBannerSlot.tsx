/**
 * `SystemBannerSlot` (proposed, packet P8; #191) — the layout slot at the top of the web
 * shell for system messages: offline, reconnecting, API not ready, high-severity alerts and
 * re-auth (canvases `admin/alerts-sessions-system/SystemBannerStack`,
 * `admin/restaurant-verification/Shell-Banners`, `admin/staff/StaffOffline`).
 *
 * - One `role="region"` landmark, named "System messages" by default, so a screen-reader user
 *   can jump to it. It renders nothing at all when there is nothing to say (no empty landmark).
 * - Banners are ordered by severity (danger, warning, info, neutral), then as given. Each
 *   banner is a Banner with `placement="page"` (P1) or any node.
 * - `max` caps how many show; the rest are counted in a line with an optional "Show all".
 * - Halal messages never come through here with a danger tone (invariant 9): use slate.
 */

import type { CSSProperties, ReactNode } from 'react';

import { Button } from '../ds/index.js';

/** Severity order of the stack, most severe first. */
export const SYSTEM_BANNER_SEVERITY = ['danger', 'warning', 'info', 'neutral'] as const;

/** One system message. */
export interface SystemBanner {
  id: string;
  severity: (typeof SYSTEM_BANNER_SEVERITY)[number];
  /** The banner itself (a Banner). */
  node: ReactNode;
}

/** Props of `SystemBannerSlot`. */
export interface SystemBannerSlotProps {
  /** Messages to stack; sorted by severity. */
  banners?: readonly SystemBanner[];
  /** Extra banners after the sorted ones (already ordered by the caller). */
  children?: ReactNode;
  /** Show at most this many from `banners`. */
  max?: number;
  /** The overflow line. Default "{n} more system message(s)". */
  moreLabel?: (hidden: number) => string;
  /** Shows "Show all" on the overflow line. */
  onShowAll?: () => void;
  /** The landmark's name. Default "System messages". */
  label?: string;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
}

function hasContent(children: ReactNode): boolean {
  if (children === null || children === undefined || children === false) return false;
  if (Array.isArray(children)) return children.some(hasContent);
  return true;
}

/** The stack of system banners at the top of the shell. */
export function SystemBannerSlot({
  banners = [],
  children,
  max,
  moreLabel = (n) => `${n} more system ${n === 1 ? 'message' : 'messages'}`,
  onShowAll,
  label = 'System messages',
  testId = 'SystemBannerSlot',
  style,
}: SystemBannerSlotProps): ReactNode {
  const sorted = [...banners].sort(
    (a, b) => SYSTEM_BANNER_SEVERITY.indexOf(a.severity) - SYSTEM_BANNER_SEVERITY.indexOf(b.severity),
  );
  const shown = max === undefined ? sorted : sorted.slice(0, Math.max(0, max));
  const hidden = sorted.length - shown.length;
  if (shown.length === 0 && hidden === 0 && !hasContent(children)) return null;

  return (
    <section
      role="region"
      aria-label={label}
      data-testid={testId}
      className="flex min-w-0 shrink-0 flex-col"
      style={style}
    >
      {shown.map((banner) => (
        <div key={banner.id} data-severity={banner.severity} className="min-w-0">
          {banner.node}
        </div>
      ))}
      {children}
      {hidden > 0 ? (
        <div className="flex min-h-11 items-center gap-3 border-b border-line-decorative bg-surface-raised px-6 py-1 text-body-sm text-fg-secondary">
          <span className="flex-1">{moreLabel(hidden)}</span>
          {onShowAll ? (
            <Button variant="tertiary" size="md" onPress={() => onShowAll()} testId={`${testId}-show-all`}>
              Show all
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** The packet's name for the same slot. */
export const SystemBannerStack = SystemBannerSlot;
/** Props of `SystemBannerStack` (the same as `SystemBannerSlotProps`). */
export type SystemBannerStackProps = SystemBannerSlotProps;
