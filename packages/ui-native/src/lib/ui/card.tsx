/**
 * RNR `Card`, adapted (design-system N1) — the generic surface.
 *
 * The accessibility contract is why this is a component: **an interactive card is one press
 * target with one accessible name.** With `onPress` the whole card is a single `Pressable`
 * (role button, or link); nothing inside it may be interactive. If a card needs two actions, it
 * is not pressable and the actions are explicit buttons beside it.
 *
 * Surfaces are role utilities (`bg-card` = `surface.raised`, `bg-muted` = `surface.subtle`,
 * `border-border` = `border.decorative`). Depth in the light scheme is a shadow the `/ds` layer
 * passes as `style` from the elevation tokens; the dark scheme steps the surface instead.
 * Content is never clamped, so a card grows when text scales.
 */
import * as React from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../utils';

/** Surface classes per `variant` × `radius`. */
export const cardVariants = cva('overflow-hidden border', {
  variants: {
    variant: {
      elevated: 'border-transparent bg-card',
      outlined: 'border-border bg-card',
      filled: 'border-transparent bg-muted',
      interactive: 'border-transparent bg-card active:opacity-95',
    },
    radius: { md: 'rounded-md', lg: 'rounded-lg', xl: 'rounded-xl' },
    disabled: { true: 'opacity-60 dark:opacity-50', false: '' },
  },
  defaultVariants: { variant: 'elevated', radius: 'lg', disabled: false },
});

/** Props of the className-tier `Card`. */
export type CardProps = VariantProps<typeof cardVariants> & {
  children?: React.ReactNode;
  /** Inner padding in points; the `/ds` layer passes the density's card padding. */
  padding: number;
  /** Bleeds to the card edges above the padded content. */
  media?: React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  /** Makes the whole card one press target. */
  onPress?: () => void;
  /** `link` when the card navigates to a URL. */
  accessibilityRole?: 'button' | 'link';
  accessibilityLabel?: string;
  accessibilityHint?: string;
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** A surface with optional media, header and footer; one press target when `onPress` is set. */
export function Card({
  variant,
  radius,
  disabled = false,
  padding,
  media,
  header,
  footer,
  children,
  onPress,
  accessibilityRole = 'button',
  accessibilityLabel,
  accessibilityHint,
  className,
  style,
  testID = 'Card',
}: CardProps): React.ReactElement {
  const body = (
    <>
      {media ? <View className="w-full">{media}</View> : null}
      <View style={{ padding }}>
        {header ? <View className="mb-3">{header}</View> : null}
        {children}
        {footer ? <View className="mt-4">{footer}</View> : null}
      </View>
    </>
  );
  const classes = cn(cardVariants({ variant, radius, disabled }), className);
  if (!onPress) {
    return (
      <View testID={testID} className={classes} style={style}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessible
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      onPress={disabled ? undefined : onPress}
      className={classes}
      style={style}
    >
      {body}
    </Pressable>
  );
}
