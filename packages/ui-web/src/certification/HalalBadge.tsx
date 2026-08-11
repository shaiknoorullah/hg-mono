/**
 * `HalalBadge` — component 12, `02-components.md` Tier 2.
 *
 * Renders the server's `halal_display_state` as a **seal**, not a chip
 * (divergence D1: on a catalogue where 100% of listings are certified, the badge's job is not
 * to differentiate listings from each other but to prove the platform's single claim on every
 * impression). There is no `color`, `label`, `variant` or `icon` prop: the four states are the
 * entire API, so a caller cannot make this component say something else.
 *
 * Rules implemented literally here:
 *   - RULE H-3, no red, ever. `EXPIRED` is cool slate, not the danger ramp. A red halal state
 *     reads as *haram* — a religious ruling the platform explicitly does not make.
 *   - `EXPIRING_SOON` renders **identically** to `CERTIFIED`. The certificate is valid today;
 *     downgrading the badge would tell the customer something false. The renewal signal lives
 *     only in `HalalCertificationPanel`.
 *   - `UNVERIFIED` renders nothing on customer surfaces, dashed on operational ones (C-12 R1:
 *     an uncertified kitchen is invisible, not de-emphasised).
 *   - A missing or unrecognised state renders nothing **and** reports a client error
 *     (C-12 R4/AC5). There is no "assume certified" path.
 *   - Never animates (`01-foundations.md` §7.4 rule 4) — a moving trust mark reads as an
 *     advertisement, and motion-sensitive users lose access to it.
 */
import { useEffect } from 'react';
import type { HalalDisplayState } from '@hg/api-client';
import { HalalShield, type HalalShieldVariant } from './HalalShield';
import { cx, FOCUS_RING_ON_COLOR, HIT_AREA_STYLE, ICON } from './internal/token-style';
import { reportHalalClientError } from './internal/client-error';
import { formatAbsoluteDate } from './internal/dates';

export type HalalBadgeSize = 'sm' | 'md' | 'lg';
export type HalalBadgeSurface = 'card' | 'detail' | 'operational';

interface HalalBadgeCommonProps {
  /**
   * Straight from the payload. `null`, `undefined` and unrecognised values are all legitimate
   * inputs and all render nothing — there is no default and no optimistic value.
   */
  state: HalalDisplayState | null | undefined;
  size?: HalalBadgeSize | undefined;
  /** Included in the client-error report when the state is missing. */
  restaurantId?: string | undefined;
  /** Detail surface only: extends the accessible name with who certified, and until when. */
  certifyingBodyName?: string | null | undefined;
  /** Detail surface only. A wire date; always rendered absolutely. */
  expiresOn?: string | null | undefined;
  className?: string | undefined;
}

/**
 * `onPress` is admissible **only** on the detail surface (`02-components.md` §12: "detail
 * surface only -> opens HalalCertificationPanel"). The union makes a pressable card badge a
 * compile error rather than a review comment.
 */
export type HalalBadgeProps =
  | (HalalBadgeCommonProps & { surface?: 'card' | 'operational'; onPress?: never })
  | (HalalBadgeCommonProps & { surface: 'detail'; onPress?: () => void });

/* -------------------------------------------------------------------------- *
 * Fixed copy. `04-accessibility.md` §3.1: reviewed strings, not templatable by
 * callers, and the visible and spoken labels never diverge.
 * -------------------------------------------------------------------------- */

const VISIBLE_LABEL = {
  CERTIFIED: 'Halal certified',
  EXPIRING_SOON: 'Halal certified',
  EXPIRED: 'Certification expired',
  UNVERIFIED: 'Not verified',
} as const satisfies Record<HalalDisplayState, string>;

const ACCESSIBLE_LABEL = {
  CERTIFIED: 'Halal certified',
  EXPIRING_SOON: 'Halal certified',
  EXPIRED: 'Halal certification expired. This restaurant cannot take orders.',
  UNVERIFIED: 'Halal certification not verified.',
} as const satisfies Record<HalalDisplayState, string>;

/**
 * The render key, not the state. `CERTIFIED` and `EXPIRING_SOON` collapse onto one key so that
 * nothing — not a class, not a data attribute — can leak the distinction into the DOM. A test
 * asserts the two renders are identical markup.
 */
type RenderKey = 'certified' | 'expired' | 'unverified';

const RENDER_KEY = {
  CERTIFIED: 'certified',
  EXPIRING_SOON: 'certified',
  EXPIRED: 'expired',
  UNVERIFIED: 'unverified',
} as const satisfies Record<HalalDisplayState, RenderKey>;

interface SealSkin {
  /** The shape channel of A-0: solid / outline / dashed survive greyscale and label removal. */
  shield: HalalShieldVariant;
  /** Plate + label + boundary. RULE H-2: a halal state is a composite, never a colour. */
  className: string;
  /** The plate colour the tick is knocked out against on filled variants. */
  knockout: string;
}

const SKIN = {
  certified: {
    shield: 'solid',
    knockout: 'var(--hg-color-halal-certified-seal)',
    // `shadow-[0_0_0_1.5px_…]` is the 1.5px brass outer ring. Decorative: the seal's
    // informational boundary is the green against the page at 10.68:1.
    className:
      'bg-halal-certified-seal text-halal-certified-on-seal rounded-md ' +
      'shadow-[0_0_0_1.5px_var(--hg-color-halal-certified-ring)]',
  },
  expired: {
    shield: 'outline',
    knockout: 'transparent',
    // No brass ring: the ring is the mark of a live certification, and this one has lapsed.
    className: 'bg-halal-expired-seal text-halal-expired-on-seal rounded-md',
  },
  unverified: {
    shield: 'dashed',
    knockout: 'transparent',
    className:
      'bg-halal-unverified-fill text-halal-unverified-text rounded-md ' +
      'border-[1.5px] border-dashed border-halal-unverified-border',
  },
} as const satisfies Record<RenderKey, SealSkin>;

const SIZE = {
  // The seal is `radius.md`, never `radius.full`: a pill reads as a tag, a softly-squared
  // ringed plate reads as a seal (the shape half of RULE H-2).
  sm: { box: 'h-5 px-2', gap: 'gap-1', icon: ICON.sm },
  md: { box: 'h-6 px-2', gap: 'gap-1', icon: ICON.sm },
  lg: { box: 'h-8 px-3', gap: 'gap-1', icon: ICON.md },
} as const satisfies Record<HalalBadgeSize, { box: string; gap: string; icon: string }>;

function isKnownState(value: unknown): value is HalalDisplayState {
  return typeof value === 'string' && value in RENDER_KEY;
}

export function HalalBadge(props: HalalBadgeProps): React.JSX.Element | null {
  const {
    state,
    size = 'md',
    surface = 'card',
    restaurantId,
    certifyingBodyName,
    expiresOn,
    className,
  } = props;
  const onPress = 'onPress' in props ? props.onPress : undefined;

  const known = isKnownState(state);

  // §0 rule 9 and C-12 R4: no badge, and the absence is reported. §0 rule 10 folds an
  // unrecognised enum value into the same branch rather than crashing. Reported from an effect
  // so the render itself stays free of side effects.
  useEffect(() => {
    if (!known) {
      reportHalalClientError('HALAL_DISPLAY_STATE_MISSING', {
        restaurantId,
        received: state,
        surface,
      });
    }
  }, [known, state, restaurantId, surface]);

  if (!known) return null;
  if (state === 'UNVERIFIED' && surface !== 'operational') return null;

  const renderKey = RENDER_KEY[state];
  const skin = SKIN[renderKey];
  const dims = SIZE[size];

  const accessibleName = buildAccessibleName({
    state,
    surface,
    certifyingBodyName,
    expiresOn,
    pressable: Boolean(onPress),
  });

  // `whitespace-nowrap`: halal labels never truncate (`04-accessibility.md` §5).
  const seal = (
    <span
      aria-hidden="true"
      className={cx('inline-flex items-center whitespace-nowrap', dims.gap)}
    >
      <HalalShield variant={skin.shield} size={dims.icon} knockout={skin.knockout} />
      <span className="text-label-sm">{VISIBLE_LABEL[state]}</span>
    </span>
  );

  const shared = cx(
    'inline-flex items-center justify-center whitespace-nowrap',
    dims.box,
    skin.className,
    className,
  );

  if (!onPress) {
    return (
      <span
        data-testid="HalalBadge"
        data-halal-render={renderKey}
        className={shared}
        role="img"
        aria-label={accessibleName}
      >
        {seal}
      </span>
    );
  }

  return (
    <button
      type="button"
      data-testid="HalalBadge"
      data-halal-render={renderKey}
      className={cx(shared, 'relative cursor-pointer', FOCUS_RING_ON_COLOR)}
      aria-label={accessibleName}
      onClick={onPress}
    >
      {seal}
      {/* The `lg` seal is 32px tall; `target.min` is 44. The hit area grows, not the visual. */}
      <span aria-hidden="true" data-testid="HalalBadge-hitarea" style={HIT_AREA_STYLE} />
    </button>
  );
}

function buildAccessibleName(args: {
  state: HalalDisplayState;
  surface: HalalBadgeSurface;
  certifyingBodyName?: string | null | undefined;
  expiresOn?: string | null | undefined;
  pressable: boolean;
}): string {
  const { state, surface, certifyingBodyName, expiresOn, pressable } = args;

  // On the detail surface the name carries the *value*, not the state name. C-12 R6 forbids the
  // platform from ranking certifiers and decision C-04 refuses to encode madhhab, which means
  // the customer applies their own standard — so they must be told *who* certified it, and a
  // screen-reader user must get that without opening a panel (`04-accessibility.md` §3.3).
  const isCertified = state === 'CERTIFIED' || state === 'EXPIRING_SOON';
  if (surface === 'detail' && isCertified && certifyingBodyName) {
    const validUntil = formatAbsoluteDate(expiresOn);
    const sentences = [`Halal certified by ${certifyingBodyName}.`];
    if (validUntil) sentences.push(`Valid until ${validUntil}.`);
    if (pressable) sentences.push('Double tap for certificate details.');
    return sentences.join(' ');
  }

  const base = ACCESSIBLE_LABEL[state];
  return pressable ? `${base} Double tap for certificate details.` : base;
}

/** Exported for the C-12 AC2 assertions and `RestaurantCard`'s accessible-name builder. */
export const HALAL_ACCESSIBLE_LABEL: Readonly<Record<HalalDisplayState, string>> = ACCESSIBLE_LABEL;
export const HALAL_VISIBLE_LABEL: Readonly<Record<HalalDisplayState, string>> = VISIBLE_LABEL;
