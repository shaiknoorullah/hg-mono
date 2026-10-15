import * as React from 'react';
import { Linking, View } from 'react-native';

import { Button as LibButton, buttonTextVariants, CountBubble, Glyph, Spinner, Text } from '../lib';
import type { ButtonSize, ButtonVariant } from '../primitives/Button';
import type { IconButtonSize, IconButtonVariant } from '../primitives/IconButton';
import { useTheme } from '../tokens';
import { type AnyIconName, type DsCommon, isFieldTheme, resolveTestId } from './shared';

/*
 * Button and IconButton (design-system N1): the live props, rendered by the React Native
 * Reusables tier (`lib/ui/button.tsx`, NativeWind classes from the generated tokens). This file
 * keeps React's own JSX runtime and only maps props: every `className` is applied inside `lib/`.
 */

/** Props of the live `Button`, native types. */
export interface ButtonProps extends DsCommon {
  /** The visible label. Text only on native: the label is what a screen reader announces. */
  children: string;
  /** primary = brand fill · secondary = forest fill · tertiary = outlined · ghost · danger. No `success`. */
  variant?: ButtonVariant;
  /** sm 36 (hit area 44) · md 44 · lg 52 · xl 60 (rider primary actions). */
  size?: ButtonSize;
  /** 72px target.criticalField — rider Accept/Decline only. */
  critical?: boolean;
  fullWidth?: boolean;
  /** Solar icon names. The loading spinner replaces iconStart. */
  iconStart?: AnyIconName;
  iconEnd?: AnyIconName;
  /** Keeps full colour and the label, sets busy and ignores presses. */
  loading?: boolean;
  /** Still focusable; presses are swallowed. */
  disabled?: boolean;
  /** Marks an irreversible action. The label must carry the verb ("Cancel order"). */
  destructive?: boolean;
  onPress?: () => void;
  /** Link mode: announces as a link and opens the URL when no onPress is given. */
  href?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

/** Icon box per size (live: sm 16, md and lg 20, xl and critical 24). */
const BUTTON_ICON_PX: Record<ButtonSize | 'critical', number> = { sm: 16, md: 20, lg: 20, xl: 24, critical: 24 };

/** A fixed box for the leading or trailing slot, so a spinner swapped in never moves the label. */
function Slot({ px, children }: { px: number; children?: React.ReactNode }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: px, height: px, alignItems: 'center', justifyContent: 'center' }}
    >
      {children}
    </View>
  );
}

/**
 * The single affordance for an action. Sizes are the live ones; on the rider (field) theme sm,
 * md and lg grow to the 56pt floor and the label steps up to `label.lg`. Passing `loading` at all
 * (even `false`) reserves the leading slot, so switching to loading never changes the width.
 */
export function Button(props: ButtonProps) {
  const {
    children,
    size = 'md',
    critical = false,
    fullWidth = false,
    iconStart,
    iconEnd,
    loading,
    disabled = false,
    destructive = false,
    onPress,
    href,
    accessibilityLabel,
    accessibilityHint,
    style,
  } = props;
  const theme = useTheme();
  const field = isFieldTheme(theme);
  const variant: ButtonVariant = props.variant ?? (destructive ? 'danger' : 'primary');
  const libSize = critical ? 'critical' : size;
  const px = BUTTON_ICON_PX[libSize];
  const tone = buttonTextVariants({ variant, size: libSize, field });
  const busy = loading === true;
  const reserve = loading !== undefined;
  const testID = resolveTestId(props, 'Button');

  const lead = busy ? (
    <Slot px={px}>
      <Spinner size={px > 20 ? 'md' : 'sm'} className={tone} testID={`${testID}-spinner`} />
    </Slot>
  ) : iconStart ? (
    <Slot px={px}>
      <Glyph name={iconStart} size={px} className={tone} />
    </Slot>
  ) : reserve ? (
    <Slot px={px} />
  ) : null;
  const trail = iconEnd ? (
    <Slot px={px}>{busy ? null : <Glyph name={iconEnd} size={px} className={tone} />}</Slot>
  ) : reserve && !iconStart ? (
    <Slot px={px} />
  ) : null;

  return (
    <LibButton
      testID={testID}
      variant={variant}
      size={libSize}
      field={field}
      fullWidth={fullWidth}
      disabled={disabled}
      loading={busy}
      onPress={onPress ?? (href ? () => void Linking.openURL(href) : undefined)}
      accessibilityRole={href ? 'link' : 'button'}
      accessibilityLabel={accessibilityLabel ?? children}
      accessibilityHint={accessibilityHint}
      style={style}
    >
      {lead}
      <Text testID={`${testID}-label`}>{children}</Text>
      {trail}
    </LibButton>
  );
}

/** Props of the live `IconButton`, native types. */
export interface IconButtonProps extends DsCommon {
  /** Solar icon name, or a node. */
  icon: AnyIconName | React.ReactNode;
  /** REQUIRED. A count badge is appended to it ("Cart, 3 items"). */
  accessibilityLabel: string;
  /** plain · filled (brand fill, dark label) · tonal (subtle surface). */
  variant?: IconButtonVariant;
  /** sm 36 (hit area 44) · md 44 · lg 56. On the rider (field) theme every size is 56. */
  size?: IconButtonSize;
  /** square (radius md, default) or circle. */
  shape?: 'square' | 'circle';
  /** `bold` when the control represents an active or selected state. */
  weight?: 'linear' | 'bold';
  /** A count (99+ above 99) or `true` for a dot. Folded into the accessible name. */
  badge?: number | boolean;
  /** Noun for the count in the name: badgeNoun="items" -> "Cart, 3 items". */
  badgeNoun?: string;
  loading?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  accessibilityHint?: string;
}

/**
 * The accessible name with the badge folded in, by the live rule: "Cart, 3 items" (the real
 * count, never "99+"), "Notifications, new" for a dot.
 */
export function nameWithBadge(label: string, badge: number | boolean | undefined, noun?: string): string {
  if (typeof badge === 'number' && badge > 0) return `${label}, ${badge}${noun ? ` ${noun}` : ''}`;
  if (badge === true) return `${label}, ${noun ?? 'new'}`;
  return label;
}

const ICON_BUTTON_PX: Record<IconButtonSize, number> = { sm: 16, md: 20, lg: 24 };
const ICON_BUTTON_VARIANT = { plain: 'plain', filled: 'primary', tonal: 'tonal' } as const;

/** A control whose only content is an icon; the badge is folded into its name. */
export function IconButton(props: IconButtonProps) {
  const {
    icon,
    accessibilityLabel,
    variant = 'plain',
    size = 'md',
    shape = 'square',
    weight = 'linear',
    badge,
    badgeNoun,
    loading = false,
    disabled = false,
    onPress,
    accessibilityHint,
    style,
  } = props;
  const theme = useTheme();
  const field = isFieldTheme(theme);
  const libVariant = ICON_BUTTON_VARIANT[variant];
  const px = ICON_BUTTON_PX[field ? 'lg' : size];
  const tone = buttonTextVariants({ variant: libVariant });
  const testID = resolveTestId(props, 'IconButton');
  const count = typeof badge === 'number' && badge > 0 ? (badge > 99 ? '99+' : String(badge)) : undefined;

  return (
    <LibButton
      testID={testID}
      variant={libVariant}
      size={`icon-${size}`}
      field={field}
      disabled={disabled}
      loading={loading}
      onPress={onPress}
      accessibilityLabel={nameWithBadge(accessibilityLabel, badge, badgeNoun)}
      accessibilityHint={accessibilityHint}
      className={shape === 'circle' ? 'rounded-full' : undefined}
      style={style}
    >
      <Slot px={px}>
        {loading ? (
          <Spinner size={px > 20 ? 'md' : 'sm'} className={tone} testID={`${testID}-spinner`} />
        ) : typeof icon === 'string' ? (
          <Glyph name={icon as AnyIconName} size={px} weight={weight} className={tone} />
        ) : (
          icon
        )}
      </Slot>
      {count || badge === true ? <CountBubble count={count} testID={`${testID}-badge`} /> : null}
    </LibButton>
  );
}
