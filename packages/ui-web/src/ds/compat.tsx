/**
 * `@hg/ui-web/ds` compatibility layer.
 *
 * The redesign's app code is written against the props of the live Claude Design system
 * (`components/index.d.ts`, artifact 1GwGVZz8Ju9wcz4HfCnzbv). Where a legacy component already
 * renders the right thing but names a prop differently, a thin adapter here translates the live
 * props to the legacy ones. The design-system work packages then replace each adapter with the
 * rebuilt component one at a time, with the same props, so app code never changes.
 *
 * Nothing here changes how a legacy component looks: the adapters only rename props.
 * Root exports (`@hg/ui-web`) are untouched, so the released apps are unaffected.
 */

import type { CSSProperties, ReactNode, SyntheticEvent } from 'react';

import {
  Button as LegacyButton,
  Icon as LegacyIcon,
  IconButton as LegacyIconButton,
  SOLAR_ICON_IDS,
  type IconName as LegacyIconName,
} from '../primitives/index.js';
import { StatusTimeline as LegacyStatusTimeline } from '../feedback/index.js';
import type { OrderState } from '@hg/api-client';
import { TopBar } from '../navigation/index.js';
import { reportDsClientError } from './client-error.js';

/* ───── Icon ───── */

/** The 14 names in the repo map. */
export type IconName = LegacyIconName;
/** Named by the live design system; their glyphs land with the Icon rebuild (W1, #198). */
export type IconExtensionName =
  | 'chevron-down'
  | 'chevron-right'
  | 'minus'
  | 'lock'
  | 'info'
  | 'warning'
  | 'error'
  | 'more'
  | 'refresh';
/** linear (inactive, default) or bold (active: selected tab, chip, nav item). */
export type IconWeight = 'linear' | 'bold';
/** Every name the design-system Icon accepts: the repo map plus the live extension names. */
export type DsIconName = IconName | IconExtensionName;

const ICON_SIZE = { sm: 16, md: 20, lg: 24, xl: 32, '2xl': 48 } as const;

/** Props of the live `Icon` (index.d.ts). */
export interface IconProps {
  name: DsIconName;
  weight?: IconWeight;
  /** sm 16 · md 20 · lg 24 · xl 32 · 2xl 48, or a px number. */
  size?: keyof typeof ICON_SIZE | number;
  accessibilityLabel?: string;
  /** Any CSS colour — use a role token. Glyphs paint in currentColor. */
  color?: string;
  testId?: string;
  style?: CSSProperties;
}

function hasGlyph(name: string): name is LegacyIconName {
  return Object.prototype.hasOwnProperty.call(SOLAR_ICON_IDS, name);
}

/** Unknown names render nothing and report ICON_NAME_UNKNOWN. */
export function Icon({ name, weight, size = 'lg', accessibilityLabel, color, testId, style }: IconProps) {
  if (!hasGlyph(name)) {
    reportDsClientError('ICON_NAME_UNKNOWN', { received: name });
    return null;
  }
  const px = typeof size === 'number' ? size : ICON_SIZE[size];
  return (
    <span data-testid={testId ?? 'Icon'} style={{ display: 'inline-flex', color, ...style }}>
      <LegacyIcon name={name} size={px} weight={weight} accessibilityLabel={accessibilityLabel} />
    </span>
  );
}

function glyph(icon: DsIconName | ReactNode | undefined, size?: number): ReactNode {
  if (typeof icon === 'string') return <Icon name={icon as DsIconName} size={size ?? 'md'} />;
  return icon;
}

/* ───── Button ───── */

/** Props of the live `Button` (index.d.ts). Action is orange; there is no success button. */
export interface ButtonProps {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'tertiary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** 72px critical target — restaurant Accept order only on web. */
  critical?: boolean;
  fullWidth?: boolean;
  iconStart?: DsIconName;
  iconEnd?: DsIconName;
  loading?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  onPress?: (e: React.MouseEvent) => void;
  href?: string;
  type?: 'button' | 'submit' | 'reset';
  accessibilityLabel?: string;
  testId?: string;
  style?: CSSProperties;
}

/** The single affordance for an action, with the live props, rendered by the legacy Button. */
export function Button({ iconStart, iconEnd, critical, testId, onPress, size, ...rest }: ButtonProps) {
  return (
    <LegacyButton
      {...rest}
      size={critical ? 'xl' : size}
      className={critical ? 'min-h-18' : undefined}
      iconStart={iconStart ? glyph(iconStart) : undefined}
      iconEnd={iconEnd ? glyph(iconEnd) : undefined}
      onPress={onPress as (() => void) | undefined}
      data-testid={testId ?? 'Button'}
    />
  );
}

/* ───── IconButton ───── */

/** Props of the live `IconButton` (index.d.ts). */
export interface IconButtonProps {
  icon: DsIconName | ReactNode;
  /** Required. A count badge is appended to it ("Cart, 3 items"). */
  accessibilityLabel: string;
  variant?: 'plain' | 'filled' | 'tonal';
  size?: 'sm' | 'md' | 'lg';
  shape?: 'square' | 'circle';
  weight?: IconWeight;
  badge?: number | boolean;
  badgeNoun?: string;
  loading?: boolean;
  disabled?: boolean;
  onPress?: (e: React.MouseEvent) => void;
  testId?: string;
  style?: CSSProperties;
}

const ICON_BUTTON_GLYPH = { sm: 16, md: 20, lg: 24 } as const;

/** A control whose only content is an icon, with the live props, rendered by the legacy IconButton. */
export function IconButton({
  icon,
  accessibilityLabel,
  badge,
  badgeNoun,
  shape,
  weight,
  size = 'md',
  testId,
  onPress,
  ...rest
}: IconButtonProps) {
  // The live name is "{label}, {n} {noun}" ("Cart, 3 items"); the legacy control writes
  // "{label}, {n}", so the full name is set here and wins over the legacy one.
  const name =
    typeof badge === 'number'
      ? `${accessibilityLabel}, ${badge > 99 ? '99+' : badge}${badgeNoun ? ` ${badgeNoun}` : ''}`
      : accessibilityLabel;
  const node =
    typeof icon === 'string' ? (
      <Icon name={icon as DsIconName} size={ICON_BUTTON_GLYPH[size]} weight={weight} />
    ) : (
      icon
    );
  return (
    <LegacyIconButton
      {...rest}
      {...({ 'aria-label': name } as object)}
      size={size}
      icon={node}
      badge={badge}
      accessibilityLabel={accessibilityLabel}
      className={shape === 'square' ? 'rounded-md' : undefined}
      onPress={onPress as (() => void) | undefined}
      data-testid={testId ?? 'IconButton'}
    />
  );
}

/* ───── StatusTimeline ───── */

/** Props of the live `StatusTimeline` (index.d.ts). */
export interface StatusTimelineProps {
  audience: 'customer' | 'restaurant' | 'rider' | 'admin';
  state?: OrderState;
  /** OrderTracking.timeline. Entries without a time are not drawn as times. */
  transitions?: Array<{ to_state: OrderState; from_state?: OrderState | null; at?: string }>;
  orientation?: 'vertical' | 'horizontal' | 'compact';
  showTimes?: boolean;
  estimatedAt?: string | null;
  deadlineAt?: string | null;
  loading?: boolean;
  /** 'reconnecting' keeps the last state and says it is not updating. */
  connection?: 'live' | 'reconnecting';
  testId?: string;
}

/** Order progress from the contract timeline, rendered by the legacy StatusTimeline. */
export function StatusTimeline({ state, transitions, connection, ...rest }: StatusTimelineProps) {
  if (!state) return <LegacyStatusTimeline {...rest} state={'CREATED'} loading />;
  return (
    <LegacyStatusTimeline
      {...rest}
      state={state}
      disconnected={connection === 'reconnecting'}
      transitions={(transitions ?? [])
        .filter((t): t is { to_state: OrderState; at: string } => typeof t.at === 'string')
        .map((t) => ({ state: t.to_state, at: t.at }))}
    />
  );
}

/* ───── AppBar ───── */

/** Props of the live `AppBar` (index.d.ts). */
export interface AppBarProps {
  variant?: 'default' | 'large' | 'search' | 'contextual' | 'transparent';
  /** chrome is the restaurant and admin tone; tones land with the AppBar rebuild (W2). */
  tone?: 'cream' | 'raised' | 'chrome' | 'field';
  title?: ReactNode;
  subtitle?: ReactNode;
  /** "Back to {previous}". */
  backLabel?: string;
  onBack?: () => void;
  actions?: ReactNode;
  search?: ReactNode;
  loading?: boolean;
  elevated?: boolean;
  titleIsPageHeading?: boolean;
  sticky?: boolean;
  testId?: string;
  style?: CSSProperties;
}

/** The top bar with the live props, rendered by the legacy TopBar until W2. */
export function AppBar({
  variant = 'default',
  tone: _tone,
  title,
  subtitle,
  backLabel,
  onBack,
  sticky: _sticky,
  style,
  ...rest
}: AppBarProps) {
  const legacyVariant = variant === 'search' || variant === 'contextual' ? variant : 'default';
  return (
    <div style={style}>
      <TopBar
        {...rest}
        variant={legacyVariant}
        title={title as string}
        subtitle={subtitle as string | undefined}
        back={onBack ? { label: backLabel ?? 'Back', onPress: onBack } : undefined}
        onExitContextual={variant === 'contextual' ? onBack : undefined}
      />
    </div>
  );
}

/** Props the live design system declares on every component. */
export interface DsCommonProps {
  testId?: string;
  style?: CSSProperties;
}

export type { SyntheticEvent };
