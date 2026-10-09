/**
 * ADAPTER: live design-system `HalalBadge` -> `@hg/ui-web` `HalalBadge`.
 *
 * The four contract states are the entire API. CERTIFIED, EXPIRED and UNVERIFIED render
 * through the legacy seal unchanged. EXPIRING_SOON differs in the live design system: legacy
 * draws it identically to CERTIFIED, the live README gives it its own look, so this adapter
 * draws it: the amber `halal.expiring` tint plate with its border, the solid-clock shield, no
 * brass ring, and "Halal certified · expires 14 Oct" when `expiresOn` parses (UTC, fixed
 * English months); the accessible name says "Halal certified. Expires 14 October 2026."
 * (detail surface with a body: "Halal certified by {body}. Expires {date}.").
 *
 * Never red: EXPIRED is the legacy cool-slate seal. Never the solid green seal for
 * EXPIRING_SOON. A null, undefined or unknown state renders NOTHING and is reported
 * (`HALAL_DISPLAY_STATE_MISSING`): silence is never consent on a halal claim.
 */
import type { CSSProperties } from 'react';
import type { HalalDisplayState } from '@hg/api-client';
import {
  HALAL_ACCESSIBLE_LABEL as LEGACY_ACCESSIBLE,
  HALAL_VISIBLE_LABEL as LEGACY_VISIBLE,
  HalalBadge as LegacyHalalBadge,
  HalalShield as LegacyHalalShield,
} from '@hg/ui-web';

import { cx } from '../internal/cx';
import { FOCUS } from '../internal/focus';

export type { HalalDisplayState };

interface HalalBadgeCommon {
  state: HalalDisplayState | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  restaurantId?: string;
  certifyingBodyName?: string | null;
  /** Wire date (YYYY-MM-DD or ISO date-time). */
  expiresOn?: string | null;
  testId?: string;
  style?: CSSProperties;
  className?: string;
}

export type HalalBadgeProps =
  | (HalalBadgeCommon & { surface?: 'card' | 'operational'; onPress?: never })
  | (HalalBadgeCommon & { surface: 'detail'; onPress?: () => void });

/** The fixed visible labels. EXPIRING_SOON is the base; the badge appends " · expires {d Mon}". */
export const HALAL_VISIBLE_LABEL: Readonly<Record<HalalDisplayState, string>> = LEGACY_VISIBLE;
export const HALAL_ACCESSIBLE_LABEL: Readonly<Record<HalalDisplayState, string>> = LEGACY_ACCESSIBLE;

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Parses a wire date to its UTC calendar day; null when missing or unparseable. */
export function parseWireDate(value: string | null | undefined): { y: number; m: number; d: number } | null {
  if (!value) return null;
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (plain) {
    const y = Number(plain[1]);
    const m = Number(plain[2]) - 1;
    const d = Number(plain[3]);
    const check = new Date(Date.UTC(y, m, d));
    return check.getUTCMonth() === m && check.getUTCDate() === d ? { y, m, d } : null;
  }
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) return null;
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
}

const SIZE = {
  sm: { box: 'h-5 px-2', icon: 16 },
  md: { box: 'h-6 px-2', icon: 16 },
  lg: { box: 'h-8 px-3', icon: 20 },
};

export function HalalBadge(props: HalalBadgeProps): React.JSX.Element | null {
  const { state, size = 'md', certifyingBodyName, expiresOn, testId = 'HalalBadge', style, className } = props;
  const surface = props.surface ?? 'card';
  const onPress = 'onPress' in props ? props.onPress : undefined;

  if (state !== 'EXPIRING_SOON') {
    // Legacy handles CERTIFIED / EXPIRED (slate) / UNVERIFIED and the missing-state report.
    // No wrapper element: a state that renders nothing must leave nothing in the DOM.
    // (`style` is not forwarded on these states; legacy takes `className` only.)
    const legacyProps = { ...props } as Record<string, unknown>;
    delete legacyProps['testId'];
    delete legacyProps['style'];
    return <LegacyHalalBadge {...(legacyProps as unknown as HalalBadgeProps)} />;
  }

  const date = parseWireDate(expiresOn);
  const visible = date ? `${HALAL_VISIBLE_LABEL.EXPIRING_SOON} · expires ${date.d} ${SHORT_MONTHS[date.m]}` : HALAL_VISIBLE_LABEL.EXPIRING_SOON;
  const longDate = date ? `${date.d} ${LONG_MONTHS[date.m]} ${date.y}` : null;
  const lead = surface === 'detail' && certifyingBodyName ? `Halal certified by ${certifyingBodyName}.` : 'Halal certified.';
  const name = [lead, longDate ? `Expires ${longDate}.` : null, onPress ? 'Double tap for certificate details.' : null]
    .filter(Boolean)
    .join(' ');
  const dims = SIZE[size];
  const classes = cx(
    'inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-md',
    'bg-halal-expiring-tint text-halal-expiring-text border-[1.5px] border-halal-expiring-border',
    dims.box,
    className,
  );
  const seal = (
    <span aria-hidden="true" className="inline-flex items-center gap-1">
      <span className="inline-flex text-halal-expiring-icon">
        <LegacyHalalShield variant="solid-clock" size={dims.icon} knockout="var(--hg-color-halal-expiring-tint)" />
      </span>
      <span className="text-label-sm">{visible}</span>
    </span>
  );
  if (surface === 'detail' && onPress) {
    return (
      <button
        type="button"
        data-testid={testId}
        data-halal-render="expiring"
        aria-label={name}
        onClick={onPress}
        style={style}
        className={cx(classes, 'relative min-h-11 cursor-pointer', FOCUS)}
      >
        {seal}
      </button>
    );
  }
  return (
    <span data-testid={testId} data-halal-render="expiring" role="img" aria-label={name} style={style} className={classes}>
      {seal}
    </span>
  );
}
