/**
 * RNR `Separator`, adapted (design-system N1) — a rule in `border.decorative` (`bg-border`).
 *
 * Decorative rules measure about 1.3:1 against the page, a documented exemption: they carry no
 * information and never bound a control. Hidden from assistive technology unless it carries a
 * `label` ("or", "Today"), which makes it a named text separator. RNR's version wraps
 * `@rn-primitives/separator`; this one is a `View`, so no new dependency is needed.
 */
import * as React from 'react';
import { View } from 'react-native';

import { Text } from './text';

/** Props of the className-tier `Separator` (the `/proposed` Separator's). */
export interface SeparatorProps {
  orientation?: 'horizontal' | 'vertical';
  /** Indent from both ends, in points (logical start/end, never left/right). */
  inset?: number;
  /** Turns the rule into a labelled separator. */
  label?: string;
  testID?: string;
}

/** A hairline rule, optionally labelled. */
export function Separator({
  orientation = 'horizontal',
  inset = 0,
  label,
  testID = 'Separator',
}: SeparatorProps): React.ReactElement {
  const line = orientation === 'horizontal' ? 'h-px shrink grow bg-border' : 'w-px self-stretch bg-border';
  if (!label) {
    return (
      <View
        testID={testID}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className={line}
        style={orientation === 'horizontal' ? { marginStart: inset, marginEnd: inset } : { marginTop: inset, marginBottom: inset }}
      />
    );
  }
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      className="flex-row items-center gap-3"
      style={{ marginStart: inset, marginEnd: inset }}
    >
      <View className={line} />
      <Text variant="caption" tone="tertiary">
        {label}
      </Text>
      <View className={line} />
    </View>
  );
}
