/**
 * `HalalBadge` — the server's `halal_display_state` rendered as a SEAL (live `index.d.ts`,
 * `HalalBadge/README.md`, 02-components.md §12). The four contract states are the entire API:
 * there is no colour, label, variant or icon prop, so a caller cannot make it say anything else.
 *
 * | state | renders |
 * |---|---|
 * | CERTIFIED | the solid green seal with a 1.5px brass outer ring and a solid shield: "Halal certified". The only solid green in the system (invariant 10) |
 * | EXPIRING_SOON | the amber expiring plate (tint, border, solid-clock shield): "Halal certified · expires 20 Oct" when `expiresOn` parses; the name says the date in full. Never red and never the green seal |
 * | EXPIRED | the cool slate seal with an outline shield: "Certification expired". Never red (invariant 9) |
 * | UNVERIFIED | nothing on `card` and `detail`; a dashed outline on `operational`: "Not verified" |
 * | null, undefined or unknown | **nothing**, and `HALAL_DISPLAY_STATE_MISSING` is reported (invariant 8) |
 *
 * - The `operational` surface (admin and restaurant grids) wraps the seal in a pointer Tooltip
 *   with the same full sentence as its accessible name; the name never depends on the tooltip.
 * - `onPress` works only on `detail` (a compile error elsewhere): a button with a chevron and a
 *   44px hit area. The seal never animates.
 */

import { useEffect, type CSSProperties } from 'react';
import type { HalalDisplayState } from '@hg/api-client';

import { reportHalalClientError } from '../certification/index.js';
import { cn } from '../lib/utils.js';
import { Tooltip } from '../proposed/Tooltip.js';
import { halalBadgeLabels, isHalalDisplayState, type HalalSurface } from './halal-labels.js';
import { HalalShield, type HalalShieldVariant } from './HalalShield.js';
import { Icon } from './Icon.js';

/** sm 20 · md 24 (default, cards) · lg 32 (detail header). */
export type HalalBadgeSize = 'sm' | 'md' | 'lg';
/** card (default) · detail (the restaurant page header) · operational (admin and restaurant). */
export type HalalBadgeSurface = HalalSurface;

interface HalalBadgeCommon {
  /** Straight from the payload. null / undefined / unknown render NOTHING and are reported. */
  state: HalalDisplayState | null | undefined;
  size?: HalalBadgeSize;
  /** Included in the client-error report. */
  restaurantId?: string;
  /** detail surface: extends the accessible name with who certified, and until when. */
  certifyingBodyName?: string | null;
  /** Wire date. EXPIRING_SOON shows it short ("expires 20 Oct") and names it in full. */
  expiresOn?: string | null;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
  /** Layout only (margin, alignment); the look comes from the state. */
  className?: string;
}

/** Props of the live `HalalBadge` (index.d.ts). `onPress` is admissible only on `detail`. */
export type HalalBadgeProps =
  | (HalalBadgeCommon & { surface?: 'card' | 'operational'; onPress?: never })
  | (HalalBadgeCommon & { surface: 'detail'; onPress?: () => void });

type RenderKey = 'certified' | 'expiring' | 'expired' | 'unverified';

const RENDER_KEY: Record<HalalDisplayState, RenderKey> = {
  CERTIFIED: 'certified',
  EXPIRING_SOON: 'expiring',
  EXPIRED: 'expired',
  UNVERIFIED: 'unverified',
};

interface Skin {
  shield: HalalShieldVariant;
  /** Plate, ink and boundary: a halal state is a composite, never a colour. */
  plate: string;
  /** The plate colour the tick or clock is cut out of. */
  knockout: string;
  /** The shield's own ink, where it differs from the label's. */
  ink?: string;
}

const SKIN: Record<RenderKey, Skin> = {
  certified: {
    shield: 'solid',
    plate:
      'bg-halal-certified-seal text-halal-certified-on-seal shadow-[0_0_0_1.5px_var(--hg-color-halal-certified-ring)]',
    knockout: 'var(--hg-color-halal-certified-seal)',
  },
  expiring: {
    shield: 'solid-clock',
    plate: 'border-[1.5px] border-solid border-halal-expiring-border bg-halal-expiring-tint text-halal-expiring-text',
    knockout: 'var(--hg-color-halal-expiring-tint)',
    ink: 'text-halal-expiring-icon',
  },
  expired: {
    shield: 'outline',
    plate: 'bg-halal-expired-seal text-halal-expired-on-seal',
    knockout: 'transparent',
  },
  unverified: {
    shield: 'dashed',
    plate:
      'border-[1.5px] border-dashed border-halal-unverified-border bg-halal-unverified-fill text-halal-unverified-text',
    knockout: 'transparent',
  },
};

const SIZE: Record<HalalBadgeSize, { box: string; icon: string }> = {
  sm: { box: 'h-5 px-2', icon: 'var(--hg-icon-sm)' },
  md: { box: 'h-6 px-2', icon: 'var(--hg-icon-sm)' },
  lg: { box: 'h-8 px-3', icon: 'var(--hg-icon-md)' },
};

/** The halal seal for one of the four contract states, or nothing. */
export function HalalBadge(props: HalalBadgeProps) {
  const {
    state,
    size = 'md',
    surface = 'card',
    restaurantId,
    certifyingBodyName,
    expiresOn,
    testId = 'HalalBadge',
    style,
    className,
  } = props;
  const onPress = surface === 'detail' && 'onPress' in props ? (props.onPress as (() => void) | undefined) : undefined;
  const known = isHalalDisplayState(state);

  // Invariant 8: no badge, and the absence is loud in telemetry. From an effect, so the render
  // itself has no side effects.
  useEffect(() => {
    if (!known) reportHalalClientError('HALAL_DISPLAY_STATE_MISSING', { restaurantId, received: state, surface });
  }, [known, state, restaurantId, surface]);

  if (!known) return null;
  if (state === 'UNVERIFIED' && surface !== 'operational') return null;

  const key = RENDER_KEY[state];
  const skin = SKIN[key];
  const dims = SIZE[size] ?? SIZE.md;
  const pressable = typeof onPress === 'function';
  const labels = halalBadgeLabels({ state, surface, certifyingBodyName, expiresOn, pressable });

  const seal = (
    <span aria-hidden="true" className="inline-flex items-center gap-1">
      <span className={cn('inline-flex', skin.ink)}>
        <HalalShield variant={skin.shield} size={dims.icon} knockout={skin.knockout} testId="HalalBadge-shield" />
      </span>
      <span>{labels.visible}</span>
      {pressable ? <Icon name="chevron-right" size={14} /> : null}
    </span>
  );

  // The whole badge is the seal: `radius.md`, never a pill; halal labels never truncate.
  const box = cn(
    'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md align-middle',
    'font-ui text-label-sm font-semibold leading-none',
    dims.box,
    skin.plate,
    className,
  );

  if (pressable) {
    return (
      <button
        type="button"
        data-testid={testId}
        data-halal-render={key}
        aria-label={labels.accessible}
        onClick={onPress}
        style={style}
        className={cn(
          box,
          'hg-focus relative cursor-pointer',
          "after:absolute after:top-1/2 after:left-1/2 after:min-h-11 after:min-w-11 after:size-full after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']",
        )}
      >
        {seal}
      </button>
    );
  }

  const badge = (
    <span
      role="img"
      aria-label={labels.accessible}
      data-testid={testId}
      data-halal-render={key}
      data-surface={surface}
      className={box}
      style={style}
    >
      {seal}
    </span>
  );

  // Operational grids show the short seal; the pointer tooltip gives the full sentence. The
  // accessible name already carries it, so keyboard and screen-reader users lose nothing.
  if (surface === 'operational') {
    return (
      <Tooltip content={labels.accessible} testId={`${testId}-tooltip`}>
        {badge}
      </Tooltip>
    );
  }
  return badge;
}
