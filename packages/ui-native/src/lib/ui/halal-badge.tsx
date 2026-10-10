/**
 * The halal seal for the className tier (design-system N4): the plate `/ds` `HalalBadge` draws.
 *
 * Presentation only. Which look to draw, whether to draw at all, and every word come from the
 * `/ds` layer (`ds/Halal.tsx`), which reads the fixed label tables in
 * `certification/internal/labels.ts`; this file has no state input and no copy of its own, so it
 * cannot say anything the tables do not.
 *
 * The four looks, from the live HalalBadge README (approved 1 Oct, published 4 Oct):
 *   - `certified`: the seal-green plate with a 1.5pt brass ring and a solid shield. The ONLY
 *     solid green in the system (invariant 10): `bg-halal-certified-seal`.
 *   - `expiring`: its own amber look. The brass-ochre tint with a 1.5pt border, the solid-clock
 *     shield and the expiring text colour; no ring, never the seal green, never red.
 *   - `expired`: cool slate with an outline shield and no ring. Never red (invariant 9): red
 *     reads as haram, a ruling the platform does not make.
 *   - `unverified`: a dashed outline and a dashed shield, transparent fill (operational only).
 *
 * Colours are the reserved `halal-*` utilities of the generated preset and nothing else; this
 * family is the one place allowed to read them (lint L-3), and no `feedback-danger-*` or
 * `destructive` class appears here.
 *
 * DEBT (dark scheme): there are no approved themed halal roles yet; they wait for the owner's
 * approval packet (design-system plan §2.3 step 2, risk 7). Until then the dark scheme uses the
 * legacy badge's in-component mapping onto the existing `*Dark` primitives, whose pairs were
 * measured (`sealDark`, `ringDark`, `expiring.tintDark`/`textDark`, `expired.sealDark`,
 * `unverified.*Dark`), applied here through `dark:` classes. No new halal colour is introduced.
 * When the themed roles land, the `dark:` pairs collapse into one role class each.
 */
import * as React from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { cn } from '../utils';
import { HalalChevron, HalalShieldMark, type HalalShieldVariant } from './halal-shield';
import { Text } from './text';

/** The four drawn looks of the seal. */
export type HalalLook = 'certified' | 'expiring' | 'expired' | 'unverified';
/** sm 20 · md 24 · lg 32. */
export type HalalSealSize = 'sm' | 'md' | 'lg';

interface Skin {
  plate: string;
  /** The plate while pressed (detail surface only). */
  pressed: string;
  /** Label and chevron ink. */
  ink: string;
  /** Shield ink (the expiring look inks its shield in the icon colour, not the text colour). */
  shieldInk: string;
  shield: HalalShieldVariant;
}

/** Every class a seal can paint, per look. Light first, then the `dark:` debt pair. */
export const HALAL_SKIN: Readonly<Record<HalalLook, Skin>> = {
  certified: {
    plate:
      'border-[1.5px] border-halal-certified-ring bg-halal-certified-seal dark:border-halal-certified-ringDark dark:bg-halal-certified-sealDark',
    pressed: 'bg-halal-certified-sealPressed dark:bg-halal-certified-sealPressed',
    ink: 'text-halal-certified-onSeal',
    shieldInk: 'text-halal-certified-onSeal',
    shield: 'solid',
  },
  expiring: {
    plate:
      'border-[1.5px] border-halal-expiring-border bg-halal-expiring-tint dark:bg-halal-expiring-tintDark',
    pressed: '',
    ink: 'text-halal-expiring-text dark:text-halal-expiring-textDark',
    shieldInk: 'text-halal-expiring-icon dark:text-halal-expiring-textDark',
    shield: 'solid-clock',
  },
  expired: {
    plate: 'border-0 bg-halal-expired-seal dark:bg-halal-expired-sealDark',
    pressed: '',
    ink: 'text-halal-expired-onSeal',
    shieldInk: 'text-halal-expired-onSeal',
    shield: 'outline',
  },
  unverified: {
    plate:
      'border-[1.5px] border-dashed border-halal-unverified-border bg-transparent dark:border-halal-unverified-borderDark',
    pressed: '',
    ink: 'text-halal-unverified-text dark:text-halal-unverified-textDark',
    shieldInk: 'text-halal-unverified-text dark:text-halal-unverified-textDark',
    shield: 'dashed',
  },
};

/** Plate height (px), shield size and padding per size; the heights are the live 20 / 24 / 32. */
export const HALAL_SEAL_SIZE: Readonly<Record<HalalSealSize, { height: number; glyph: number; plate: string; label: string }>> = {
  sm: { height: 20, glyph: 12, plate: 'min-h-[20px] px-2', label: 'text-label-sm' },
  md: { height: 24, glyph: 14, plate: 'min-h-[24px] px-2', label: 'text-label-sm' },
  lg: { height: 32, glyph: 18, plate: 'min-h-[32px] px-3', label: 'text-label-md' },
};

/** Props of the className-tier seal. */
export interface HalalSealProps {
  look: HalalLook;
  size?: HalalSealSize;
  /** The visible words, from the fixed table (plus the expiring short date). */
  label: string;
  /** The spoken name, from the fixed table. */
  accessibilityLabel: string;
  /** Makes the seal a button with a chevron (the `/ds` layer allows it on `detail` only). */
  onPress?: () => void;
  /** The theme's minimum target; the hit area never falls below it. */
  minTarget?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The seal plate: shield, label, and a chevron when it is a button. Never animates. */
export function HalalSeal({
  look,
  size = 'md',
  label,
  accessibilityLabel,
  onPress,
  minTarget = 44,
  style,
  testID = 'HalalBadge',
}: HalalSealProps): React.ReactElement {
  const skin = HALAL_SKIN[look];
  const spec = HALAL_SEAL_SIZE[size];
  const plate = (pressed: boolean) => (
    <View
      testID={`${testID}-plate`}
      className={cn('flex-row items-center gap-1 rounded-md py-0.5', spec.plate, skin.plate, pressed && skin.pressed)}
    >
      <HalalShieldMark variant={skin.shield} size={spec.glyph} className={skin.shieldInk} testID={`${testID}-shield`} />
      {/* Not clamped: at 200% text the label wraps and the plate grows, it is never cut off. */}
      <Text className={cn('shrink font-sans-semibold', spec.label, skin.ink)}>{label}</Text>
      {onPress ? (
        <View testID={`${testID}-chevron`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <HalalChevron size={spec.glyph} direction="forward" className={skin.ink} />
        </View>
      ) : null}
    </View>
  );

  if (!onPress) {
    return (
      <View
        testID={testID}
        accessible
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        className="self-start"
        style={style}
      >
        {plate(false)}
      </View>
    );
  }
  // The plate is 20–32 high; the hit area is grown to the theme's minimum (44, 56 on rider).
  const slop = Math.max(0, Math.ceil((minTarget - spec.height) / 2));
  return (
    <Pressable
      testID={testID}
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={{ top: slop, bottom: slop, left: slop > 0 ? 8 : 0, right: slop > 0 ? 8 : 0 }}
      className="self-start"
      style={style}
    >
      {({ pressed }) => plate(pressed)}
    </Pressable>
  );
}
