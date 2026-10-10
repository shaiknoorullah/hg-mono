/**
 * The bar pinned to the bottom of a screen that holds its primary action (design-system N2,
 * proposed): the customer's "Add to cart" and checkout, the restaurant's action bar.
 *
 * `bg-elev-surface-sticky` is the sticky elevation's fill: `surface.raised` in light, where the
 * `/ds` layer adds the upward sticky shadow as `style`, and the dark scheme's surface step,
 * because a shadow on a near-black page is invisible. A decorative hairline separates it from
 * the content above. The safe-area bottom inset is added under the content, so the action never
 * sits under the home indicator.
 */
import * as React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { cn } from '../utils';

/** Props of the className-tier `StickyFooter`. */
export interface StickyFooterProps {
  children?: React.ReactNode;
  /** Safe-area bottom inset, in points. */
  bottomInset?: number;
  /** The field register: roomier padding. */
  field?: boolean;
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** A sticky action bar on the sticky elevation surface. */
export function StickyFooter({
  children,
  bottomInset = 0,
  field = false,
  className,
  style,
  testID = 'StickyFooter',
}: StickyFooterProps): React.ReactElement {
  const pad = field ? 16 : 12;
  return (
    <View
      testID={testID}
      className={cn('z-sticky w-full gap-3 border-t border-border bg-elev-surface-sticky px-4', className)}
      style={[{ paddingTop: pad, paddingBottom: pad + bottomInset }, style]}
    >
      {children}
    </View>
  );
}
