/**
 * The certification panel's surfaces for the className tier (design-system N4): the tinted
 * region with its visible heading, the renewal note, and the row `RestaurantHalalStatus` lays its
 * parts out in. The `/ds` layer (`ds/Halal.tsx`) decides what goes inside and supplies every
 * word; these parts only paint.
 *
 *   - The frame is a region labelled by a visible "Halal certification" heading, so it is reached
 *     by heading navigation (04-accessibility.md §3.5). It sits on the certified tint; for
 *     `EXPIRED` it sits on cool slate, never red (invariant 9).
 *   - The renewal note is brass-ochre with the `solid-clock` shield: a note about a certificate
 *     that is valid today, not an alert, so it is never the warning orange and never red.
 *
 * DEBT (dark scheme): the `dark:` classes are the legacy panel's in-component mapping onto the
 * existing `*Dark` primitives (`certified.tintDark`/`tintTextDark`, `expired.tintDark`/
 * `textDark`, `expiring.tintDark`/`textDark`), kept until the owner approves themed halal roles
 * (design-system plan §2.3 step 2). No new halal colour is introduced here.
 */
import * as React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { cn } from '../utils';
import { HalalShieldMark } from './halal-shield';
import { Text } from './text';

/** The two panel tints: certified (also expiring) and expired. */
export type HalalPanelTone = 'certified' | 'expired';

const FRAME: Record<HalalPanelTone, { frame: string; heading: string }> = {
  certified: {
    frame:
      'border-halal-certified-tintBorder bg-halal-certified-tint dark:border-halal-certified-tintDark dark:bg-halal-certified-tintDark',
    heading: 'text-halal-certified-tintText dark:text-halal-certified-tintTextDark',
  },
  expired: {
    frame: 'border-halal-expired-border bg-halal-expired-tint dark:border-halal-expired-tintDark dark:bg-halal-expired-tintDark',
    heading: 'text-halal-expired-text dark:text-halal-expired-textDark',
  },
};

/** Props of the panel frame. */
export interface HalalPanelFrameProps {
  tone: HalalPanelTone;
  /** The visible heading (the region's name). */
  heading: string;
  /** Loading: the region is busy. */
  busy?: boolean;
  /** Inner padding in points; the `/ds` layer passes the density's card padding. */
  padding: number;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The tinted certification region with its heading. */
export function HalalPanelFrame({
  tone,
  heading,
  busy = false,
  padding,
  children,
  style,
  testID = 'HalalCertificationPanel',
}: HalalPanelFrameProps): React.ReactElement {
  const headingId = `${testID}-heading`;
  return (
    <View
      testID={testID}
      role="region"
      accessibilityLabel={heading}
      aria-labelledby={headingId}
      accessibilityLabelledBy={headingId}
      aria-busy={busy}
      accessibilityState={{ busy }}
      className={cn('gap-3 rounded-lg border', FRAME[tone].frame)}
      style={[{ padding }, style]}
    >
      <Text nativeID={headingId} accessibilityRole="header" variant="heading.sm" className={FRAME[tone].heading}>
        {heading}
      </Text>
      {children}
    </View>
  );
}

/** The `EXPIRING_SOON` renewal note: brass-ochre tint, `solid-clock` shield, one sentence. */
export function HalalRenewalNote({ text, testID = 'HalalCertificationPanel-renewalNote' }: { text: string; testID?: string }): React.ReactElement {
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={text}
      className="flex-row items-center gap-2 rounded-sm border border-halal-expiring-border bg-halal-expiring-tint p-3 dark:bg-halal-expiring-tintDark"
    >
      <HalalShieldMark
        variant="solid-clock"
        size={20}
        className="text-halal-expiring-icon dark:text-halal-expiring-textDark"
        testID={`${testID}-shield`}
      />
      <Text variant="body.sm" className="shrink text-halal-expiring-text dark:text-halal-expiring-textDark">
        {text}
      </Text>
    </View>
  );
}

/** `RestaurantHalalStatus`'s layout: the seal and its chip on one wrapping row, links beneath. */
export function HalalStatusLayout({
  seal,
  links,
  style,
  testID = 'RestaurantHalalStatus',
}: {
  seal: React.ReactNode;
  links?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}): React.ReactElement {
  return (
    <View testID={testID} className="gap-1" style={style}>
      <View className="flex-row flex-wrap items-center gap-2">{seal}</View>
      {links ? <View className="flex-row flex-wrap items-center gap-2">{links}</View> : null}
    </View>
  );
}
