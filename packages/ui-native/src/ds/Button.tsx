import { View } from 'react-native';

import { Button as LegacyButton, type ButtonSize, type ButtonVariant } from '../primitives/Button';
import { IconButton as LegacyIconButton, type IconButtonSize, type IconButtonVariant } from '../primitives/IconButton';
import { type Theme, useTheme } from '../tokens';
import { Icon } from './Icon';
import { type AnyIconName, type DsCommon, resolveTestId } from './shared';

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

/** The label colour of each fill, so an icon in the button matches its label. */
function labelColor(theme: Theme, variant: ButtonVariant): string {
  switch (variant) {
    case 'primary':
      return theme.color.text.onBrand;
    case 'secondary':
      return theme.color.text.onAccent;
    case 'danger':
      return theme.color.feedback.danger.onSolid ?? theme.color.text.onAccent;
    default:
      return theme.color.text.primary;
  }
}

export function Button(props: ButtonProps) {
  const { iconStart, iconEnd, style, testId: _t, testID: _T, ...rest } = props;
  const theme = useTheme();
  const variant: ButtonVariant = rest.variant ?? (rest.destructive ? 'danger' : 'primary');
  const tint = labelColor(theme, variant);
  const size = rest.size === 'xl' || rest.critical ? 'lg' : 'md';
  const button = (
    <LegacyButton
      {...rest}
      testID={resolveTestId(props, 'Button')}
      iconStart={iconStart ? <Icon name={iconStart} size={size} color={tint} /> : undefined}
      iconEnd={iconEnd ? <Icon name={iconEnd} size={size} color={tint} /> : undefined}
    />
  );
  return style ? <View style={style}>{button}</View> : button;
}

export interface IconButtonProps extends DsCommon {
  /** Solar icon name, or a node. */
  icon: AnyIconName | React.ReactNode;
  /** REQUIRED. A count badge is appended to it ("Cart, 3 items"). */
  accessibilityLabel: string;
  variant?: IconButtonVariant;
  /** sm 36 (hit area 44) · md 44 · lg 56. */
  size?: IconButtonSize;
  /** Accepted for API parity; IconButtons are square on native until N1. */
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

function iconButtonTint(theme: Theme, variant: IconButtonVariant): string {
  return variant === 'filled' ? theme.color.text.onAccent : theme.color.text.primary;
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

export function IconButton(props: IconButtonProps) {
  const { icon, weight = 'linear', badge, badgeNoun, shape: _shape, style, testId: _t, testID: _T, ...rest } = props;
  const theme = useTheme();
  const variant = rest.variant ?? 'plain';
  const node =
    typeof icon === 'string' ? (
      <Icon name={icon as AnyIconName} weight={weight} size="lg" color={iconButtonTint(theme, variant)} />
    ) : (
      icon
    );
  const button = (
    <LegacyIconButton
      {...rest}
      accessibleName={nameWithBadge(rest.accessibilityLabel, badge, badgeNoun)}
      icon={node}
      badge={badge === true ? true : typeof badge === 'number' && badge > 0 ? { count: badge, max: 99 } : undefined}
      testID={resolveTestId(props, 'IconButton')}
    />
  );
  return style ? <View style={style}>{button}</View> : button;
}
