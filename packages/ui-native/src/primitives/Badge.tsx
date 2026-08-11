/**
 * `Badge` — a small non-interactive status marker.
 *
 * **This is not the halal badge.** `HalalBadge` is its own component and deliberately does
 * not share this one: a certification is not a status chip, and making them siblings would
 * be an invitation to render one where the other belongs.
 *
 * **There is no `success` variant** (RULE H-1). A badge that means "good" is `brand` or is
 * a word.
 *
 * Never colour-only: a `danger` badge carries a word, and it is announced as text in
 * reading order.
 */
import { Text, View, type ViewStyle } from 'react-native';
import type { ReactNode } from 'react';

import { feedbackRole, tokens, useTheme, useTypeStyle } from '../tokens';

/** `success` is absent on purpose — see the file header. */
export type BadgeVariant = 'neutral' | 'info' | 'warning' | 'danger' | 'brand' | 'outline';
export type BadgeStyle = 'solid' | 'tint' | 'dot';
export type BadgeSize = 'sm' | 'md' | 'lg';

const HEIGHTS: Record<BadgeSize, number> = { sm: 18, md: 22, lg: 26 };

export interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  /** Visual treatment. `tint` is the default; `dot` prefixes a coloured dot. */
  style?: BadgeStyle;
  size?: BadgeSize;
  icon?: ReactNode;
  /** Count ceiling — 100 with `max` 99 renders "99+". */
  max?: number;
  testID?: string;
}

export function Badge({
  label,
  variant = 'neutral',
  style = 'tint',
  size = 'md',
  icon,
  max,
  testID = 'Badge',
}: BadgeProps) {
  const theme = useTheme();
  const labelType = useTypeStyle(size === 'lg' ? 'label.md' : 'label.sm');

  const numeric = Number(label);
  const text =
    max !== undefined && Number.isFinite(numeric) && numeric > max ? `${max}+` : label;

  const palette = (): { background: string; foreground: string; border: string } => {
    switch (variant) {
      case 'info':
      case 'warning':
      case 'danger': {
        const f = feedbackRole(theme, variant);
        return style === 'solid'
          ? {
              background: f.solid ?? f.tint,
              foreground: f.onSolid ?? theme.color.text.onAccent,
              border: 'transparent',
            }
          : { background: f.tint, foreground: f.tintText, border: f.border };
      }
      case 'brand':
        return style === 'solid'
          ? {
              background: theme.color.action.primary,
              foreground: theme.color.text.onBrand,
              border: 'transparent',
            }
          : {
              background: theme.color.state.selectedTint,
              foreground: theme.color.text.primary,
              border: theme.color.border.brand,
            };
      case 'outline':
        return {
          background: 'transparent',
          foreground: theme.color.text.secondary,
          border: theme.color.border.interactive,
        };
      case 'neutral':
      default:
        return style === 'solid'
          ? {
              background: theme.color.surface.inverse,
              foreground: theme.color.text.onInverse,
              border: 'transparent',
            }
          : {
              background: theme.color.surface.subtle,
              foreground: theme.color.text.secondary,
              border: theme.color.border.decorative,
            };
    }
  };

  const colors = palette();
  const container: ViewStyle = {
    minHeight: HEIGHTS[size],
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space['1'],
    paddingHorizontal: tokens.space['2'],
    borderRadius: tokens.radius.md,
    backgroundColor: style === 'dot' ? 'transparent' : colors.background,
    borderWidth: colors.border === 'transparent' ? 0 : 1,
    borderColor: colors.border,
    alignSelf: 'flex-start',
  };

  return (
    <View testID={testID} accessible accessibilityLabel={text || undefined} style={container}>
      {style === 'dot' ? (
        <View
          testID={`${testID}-dot`}
          style={{
            width: 8,
            height: 8,
            borderRadius: tokens.radius.full,
            backgroundColor: colors.border === 'transparent' ? colors.background : colors.border,
          }}
        />
      ) : null}
      {icon}
      {text ? (
        <Text
          style={{
            ...labelType,
            color: style === 'dot' ? theme.color.text.secondary : colors.foreground,
          }}
        >
          {text}
        </Text>
      ) : null}
    </View>
  );
}
