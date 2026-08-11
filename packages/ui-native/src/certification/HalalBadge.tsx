/**
 * `HalalBadge` — the most important component in the product.
 *
 * It renders `halal_display_state` as a *seal*: a dark, ringed, high-contrast plate that
 * sits on the card's solid surface, above the restaurant name and above the metadata row.
 * On a catalogue where 100% of listings are certified, the badge's job is not to
 * differentiate listings from one another — it is to prove the platform's single claim on
 * every impression (divergence D1). That is why it outranks the brand colour on the card,
 * and why it is deliberately not a `Badge`.
 *
 * The four states are the entire API. There is no `color`, `label`, `variant` or `icon`
 * prop: a caller cannot make this component say something else.
 *
 * Rules honoured here, each with its reason:
 *
 *  - **Never red, in any state** (RULE H-3). A red halal state reads as *haram* — a
 *    religious ruling the platform does not make. "We cannot currently vouch for this" is
 *    a grey statement, not a red one.
 *  - **`EXPIRING_SOON` is byte-identical to `CERTIFIED`.** The certificate is valid today;
 *    the renewal signal belongs in `HalalCertificationPanel`, not on a card.
 *  - **`UNVERIFIED` renders `null` on customer surfaces.** C-12 R1 hides uncertified
 *    restaurants entirely, so a customer never learns that non-certified listings exist.
 *  - **No state is ever assumed.** A missing, null or unknown value renders nothing and
 *    reports — there is no "assume certified" path (C-12 R4/AC5).
 *  - **It never animates** (foundations §7.4 rule 4). A moving trust mark reads as an
 *    advertisement, and motion-sensitive users lose access to it.
 */
import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { HalalDisplayState } from '@hg/api-client';

import { HalalShield, SealChevron } from './internal/HalalShield';
import {
  certifiedSeal,
  certifiedSealPressed,
  expiredSeal,
  unverifiedSeal,
} from './internal/halalTokens';
import type { SealPalette } from './internal/halalTokens';
import {
  ACCESSIBLE_LABEL,
  VISIBLE_LABEL,
  detailAccessibleLabel,
  isHalalDisplayState,
} from './internal/labels';
import { reportClientError } from './internal/reportClientError';
import {
  focusRing,
  radius,
  space,
  useFontScale,
  useTheme,
  useTypeStyle,
} from './internal/theme';
import type { ColorScheme } from './internal/theme';

export type HalalBadgeSize = 'sm' | 'md' | 'lg';

/**
 * `card` and `detail` are customer surfaces. `operational` is restaurant, admin and rider —
 * the only place `UNVERIFIED` is ever drawn.
 */
export type HalalBadgeSurface = 'card' | 'detail' | 'operational';

export interface HalalBadgeProps {
  /**
   * Server state, rendered verbatim. `null`, `undefined` and unrecognised values take the
   * documented "report and draw nothing" branch — never a default.
   */
  state: HalalDisplayState | null | undefined;
  size?: HalalBadgeSize;
  surface?: HalalBadgeSurface;
  /** Detail surface only. Opens `HalalCertificationPanel`; adds pressed + focus-visible. */
  onPress?: () => void;
  /** Carried into the client-error report so a missing state is traceable to a listing. */
  restaurantId?: string;
  /** Detail surface only: extends the spoken label with who certified it and until when. */
  certifyingBodyName?: string | null;
  expiresOn?: string | null;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

interface SizeSpec {
  height: number;
  glyph: number;
  paddingX: number;
  gap: number;
}

/** `sm` dense list rows · `md` restaurant cards (default) · `lg` detail header. */
const SIZES: Readonly<Record<HalalBadgeSize, SizeSpec>> = {
  sm: { height: 20, glyph: 12, paddingX: space['2'], gap: space['1'] },
  md: { height: 24, glyph: 14, paddingX: space['2'], gap: 5 },
  lg: { height: 32, glyph: 18, paddingX: space['3'], gap: space['2'] },
};

/**
 * Resolve a state to its seal.
 *
 * `CERTIFIED` and `EXPIRING_SOON` fall through to the *same* branch rather than to two
 * branches that happen to return equal values — the identity is structural, so it cannot
 * drift when someone later edits one of them.
 */
export function resolveSeal(state: HalalDisplayState, scheme: ColorScheme): SealPalette {
  switch (state) {
    case 'CERTIFIED':
    case 'EXPIRING_SOON':
      return certifiedSeal(scheme);
    case 'EXPIRED':
      return expiredSeal(scheme);
    case 'UNVERIFIED':
      return unverifiedSeal(scheme);
  }
}

export function HalalBadge({
  state,
  size = 'md',
  surface = 'card',
  onPress,
  restaurantId,
  certifyingBodyName,
  expiresOn,
  style,
  testID = 'HalalBadge',
}: HalalBadgeProps): React.ReactElement | null {
  const theme = useTheme();
  const labelType = useTypeStyle(size === 'lg' ? 'label.md' : 'label.sm');
  // Dynamic Type grows the plate rather than clipping the label. Capped with the rest of
  // the structural chrome; the text itself scales uncapped, as RN already does.
  const scale = useFontScale();
  const [focused, setFocused] = React.useState(false);

  // Absent or unrecognised: draw nothing, report. A component test deletes the field and
  // asserts both the absent badge and the reported error.
  const resolved: HalalDisplayState | null = isHalalDisplayState(state) ? state : null;
  const missing = state === null || state === undefined;
  React.useEffect(() => {
    if (resolved !== null) return;
    if (missing) {
      reportClientError('HALAL_DISPLAY_STATE_MISSING', { restaurantId, surface });
    } else {
      reportClientError('HALAL_DISPLAY_STATE_UNKNOWN', {
        restaurantId,
        surface,
        received: String(state),
      });
    }
  }, [resolved, missing, restaurantId, surface, state]);

  if (resolved === null) return null;

  // C-12 R1: an uncertified kitchen is invisible to customers. The state exists only so
  // operational surfaces can say "we have not verified this".
  if (resolved === 'UNVERIFIED' && surface !== 'operational') return null;

  const seal = resolveSeal(resolved, theme.scheme);
  const spec = SIZES[size];
  const height = Math.round(spec.height * scale);
  const pressable = surface === 'detail' && typeof onPress === 'function';
  const outlined = seal.ring ?? seal.borderColor;

  const accessibilityLabel =
    surface === 'detail'
      ? detailAccessibleLabel({ state: resolved, certifyingBodyName, expiresOn, pressable })
      : ACCESSIBLE_LABEL[resolved];

  const plate = (pressed: boolean): React.ReactElement => (
    <View
      style={[
        styles.plate,
        {
          minHeight: height,
          paddingHorizontal: spec.paddingX,
          columnGap: spec.gap,
          borderRadius: radius.md,
          backgroundColor:
            pressed && seal.fill !== 'transparent' ? certifiedSealPressed() : seal.fill,
          // The brass ring is the seal's signature: a stamped, ringed mark rather than a
          // status chip. It is decorative — the informational boundary is fill-vs-surface
          // at 10.68:1 — so its own contrast against the page is not load-bearing.
          borderWidth: outlined === null ? 0 : 1.5,
          borderColor: outlined ?? undefined,
          borderStyle: seal.borderStyle,
        },
      ]}
    >
      <HalalShield form={seal.shield} color={seal.label} size={spec.glyph} />
      <Text numberOfLines={1} style={[labelType, { color: seal.label }]}>
        {VISIBLE_LABEL[resolved]}
      </Text>
      {pressable ? <SealChevron color={seal.label} size={spec.glyph} direction="forward" /> : null}
    </View>
  );

  if (!pressable) {
    return (
      <View
        testID={testID}
        style={[styles.root, style]}
        accessible
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
      >
        {plate(false)}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      style={[styles.root, style]}
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      // `focus-visible`, never `focus`: the ring is drawn for keyboard and AT focus, and a
      // pointer press does not leave one behind (components §0 rule 2).
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      // The visual plate is 24–32 high; the hit area never falls below the 44 floor.
      hitSlop={Math.max(0, Math.ceil((theme.target.min - height) / 2))}
    >
      {({ pressed }) => (
        <>
          {plate(pressed)}
          {focused ? (
            // An overlay, so the ring is never clipped by the plate's own radius and never
            // shifts the seal's position on the card.
            <View
              pointerEvents="none"
              style={focusRing(theme, { radius: radius.md, onColor: seal.fill !== 'transparent' })}
            />
          ) : null}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    // Shrink-to-fit: the seal is a plate, not a bar. `flex-start` keeps it from stretching
    // to the card width when dropped into a stretch-aligned column.
    alignSelf: 'flex-start',
  },
  plate: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
  },
});
