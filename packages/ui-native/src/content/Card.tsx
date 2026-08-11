/**
 * `Card` — the generic surface container the rest of this tier composes from.
 *
 * The accessibility contract is the reason this is a component rather than a `View` with a
 * shadow: **an interactive card is one tab stop with one accessible name.** Nested links
 * inside a pressable card are forbidden — the "nested interactive" trap is the most common
 * React Native accessibility defect, and it is what makes a card unusable with a screen
 * reader. If a card needs two actions, the card is not pressable and the actions are
 * explicit buttons beside it.
 */
import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { elevation, radius, useTheme } from '../certification/internal/theme';

export type CardVariant = 'elevated' | 'outlined' | 'filled' | 'interactive';

export interface CardProps {
  variant?: CardVariant;
  /** Defaults to the theme's `density.cardPadding`; components never hard-code 16. */
  padding?: number;
  radius?: number;
  onPress?: () => void;
  /** Bleeds to the card edges above the content — hero images, thumbnails. */
  media?: React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  /** The card's single accessible name when it is interactive. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Card({
  variant = 'elevated',
  padding,
  radius: cardRadius = radius.lg,
  onPress,
  media,
  header,
  footer,
  children,
  accessibilityLabel,
  accessibilityHint,
  disabled = false,
  style,
  contentStyle,
  testID = 'Card',
}: CardProps): React.ReactElement {
  const theme = useTheme();
  const [focused, setFocused] = React.useState(false);

  const interactive = variant === 'interactive' || typeof onPress === 'function';
  const pad = padding ?? theme.density.cardPadding;

  const surface = ((): ViewStyle => {
    switch (variant) {
      case 'outlined':
        return {
          backgroundColor: theme.color.surface.base,
          borderWidth: 1,
          borderColor: theme.color.border.decorative,
        };
      case 'filled':
        return { backgroundColor: theme.color.surface.subtle };
      case 'elevated':
      case 'interactive':
        return { backgroundColor: theme.color.surface.raised, ...elevation(theme, '1') };
    }
  })();

  const body = (pressed: boolean): React.ReactElement => (
    <>
      {media ? <View style={styles.media}>{media}</View> : null}
      <View style={[{ padding: pad }, contentStyle]}>
        {header}
        {children}
        {footer}
      </View>
      {/* Pressed is an overlay rather than a colour swap, so it composites identically over
          every variant and over the media block. */}
      {pressed ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.color.state.pressedOverlay }]}
        />
      ) : null}
    </>
  );

  const container: StyleProp<ViewStyle> = [
    styles.root,
    { borderRadius: cardRadius },
    surface,
    disabled ? { opacity: theme.color.state.disabledOpacity } : null,
    style,
  ];

  if (!interactive) {
    return (
      <View testID={testID} style={container}>
        {body(false)}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      style={({ pressed }) => [container, pressed ? styles.pressed : null]}
      onPress={onPress}
      disabled={disabled}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      // One tab stop, one name.
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
    >
      {({ pressed }) => (
        <>
          {body(pressed)}
          {focused ? (
            // Inset rather than the shared outset `focusRing`: the card clips its own
            // overflow so the media can take the corner radius, and an outset ring would be
            // clipped away by exactly that. Drawn as an overlay so focus never reflows the
            // card or the list it sits in.
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                {
                  borderRadius: cardRadius,
                  borderWidth: 3,
                  borderColor: theme.color.focus.ring,
                },
              ]}
            />
          ) : null}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    overflow: 'hidden',
  },
  media: {
    width: '100%',
  },
  pressed: {
    transform: [{ scale: 0.99 }],
  },
});
