import * as React from 'react';
import type { DimensionValue, View, ViewStyle } from 'react-native';

import {
  AppBar as LibAppBar,
  BottomNav as LibBottomNav,
  Dialog as LibDialog,
  Sheet as LibSheet,
  StickyFooter as LibStickyFooter,
  Toast as LibToast,
  type AppBarVariant,
  type OverlayWrap,
  type ToastVariant,
} from '../lib';
import { useBottomInset, useTopInset } from '../navigation/internal/insets';
import { ThemeProvider, elevationStyle, useTheme, type Theme } from '../tokens';
import { Button, IconButton, nameWithBadge } from './Button';
import { type AnyIconName, type DsCommon, isFieldTheme, resolveTestId } from './shared';

/*
 * Navigation and overlays (design-system N2): the live props, rendered by the React Native
 * Reusables tier (`lib/ui/app-bar.tsx`, `bottom-nav.tsx`, `sheet.tsx`, `dialog.tsx`, `toast.tsx`).
 * This file keeps React's own JSX runtime and only maps props and theme: the field register,
 * safe-area insets, light-scheme shadows, and the ThemeProvider that portalled overlays need
 * re-provided (context does not cross a portal; see `lib/ui/overlay.tsx`).
 */

/** The light scheme's shadow for an elevation level; dark carries depth in the fill instead. */
function shadowOf(theme: Theme, level: '1' | '4' | 'sticky'): ViewStyle | undefined {
  return theme.elevationMode === 'shadow' ? elevationStyle(theme, level) : undefined;
}

/** Re-provides this tree's theme inside a portal. */
function useOverlayWrap(): OverlayWrap {
  const theme = useTheme();
  return React.useCallback(
    (node: React.ReactElement) => (
      <ThemeProvider theme={theme.name} scheme={theme.scheme}>
        {node}
      </ThemeProvider>
    ),
    [theme.name, theme.scheme],
  );
}

/* ───── AppBar ───── */

/** Props of the live `AppBar`. */
export interface AppBarProps extends DsCommon {
  variant?: AppBarVariant;
  /** Theme surface only — cream (customer) · raised · chrome · field (rider). */
  tone?: 'cream' | 'raised' | 'chrome' | 'field';
  title?: string;
  subtitle?: string;
  /** "Back to {previous}" — required whenever the destination is known. */
  backLabel?: string;
  /** Renders a 44px back button (56 on the field tone and theme; contextual: "Clear selection"). */
  onBack?: () => void;
  /** IconButtons with real labels. */
  actions?: React.ReactNode;
  /** variant="search": the field shown in place of the title. */
  search?: React.ReactNode;
  /** Indeterminate progress at the bottom edge. */
  loading?: boolean;
  /** Scrolled: elevation 1 + hairline. */
  elevated?: boolean;
  /** The title is announced as the screen's heading (default true). */
  titleIsPageHeading?: boolean;
  /** Accepted for API parity; the bar is laid out by the screen on native. */
  sticky?: boolean;
  /** Native extension (customer address title): the title becomes a button with a chevron. */
  onTitlePress?: () => void;
  /** What pressing the title does ("Changes the delivery address"). */
  titleAccessibilityHint?: string;
}

/** The top bar; `tone` picks the theme surface. Titles wrap; they are never clamped. */
export function AppBar(props: AppBarProps) {
  const {
    title,
    subtitle,
    backLabel,
    onBack,
    actions,
    search,
    titleIsPageHeading = true,
    tone = 'cream',
    variant = 'default',
    loading,
    elevated,
    onTitlePress,
    titleAccessibilityHint,
    style,
  } = props;
  const theme = useTheme();
  const topInset = useTopInset();
  const contextual = variant === 'contextual';
  return (
    <LibAppBar
      variant={variant}
      tone={tone}
      title={title}
      subtitle={subtitle}
      back={
        onBack
          ? { label: backLabel ?? (contextual ? 'Clear selection' : 'Back'), onPress: onBack, icon: contextual ? 'close' : 'back' }
          : undefined
      }
      titleAction={onTitlePress ? { onPress: onTitlePress, accessibilityHint: titleAccessibilityHint } : undefined}
      actions={actions}
      search={search}
      loading={loading}
      elevated={elevated}
      isPageHeading={titleIsPageHeading}
      field={tone === 'field' || isFieldTheme(theme)}
      topInset={topInset}
      style={[elevated && variant !== 'transparent' ? shadowOf(theme, '1') : undefined, style]}
      testID={resolveTestId(props, 'AppBar')}
    />
  );
}

/* ───── BottomNav ───── */

/** One destination in the `BottomNav`. */
export interface BottomNavItem {
  key: string;
  /** Always visible. */
  label: string;
  icon: AnyIconName;
  /** Count or dot; folded into the item's name. */
  badge?: number | boolean;
  /** "Orders, 2 active" -> badgeNoun "active". */
  badgeNoun?: string;
}

/** Props of the live `BottomNav`. */
export interface BottomNavProps extends DsCommon {
  items: BottomNavItem[];
  /** Key of the active item. */
  active: string;
  onChange?: (key: string) => void;
  /** Names the navigation landmark (default "Main"). */
  label?: string;
  /** raised (customer) · field (rider's dark chrome). Default: field on the rider theme, else raised. */
  tone?: 'raised' | 'field';
  /** Renders nothing — REQUIRED during the rider offer sheet and during checkout. */
  hidden?: boolean;
}

/**
 * Phone primary navigation: links with a selected state (not tabs), the selected one a filled
 * tile. Renders nothing when `hidden`.
 */
export function BottomNav(props: BottomNavProps) {
  const { items, active, onChange, label, hidden, style } = props;
  const theme = useTheme();
  const bottomInset = useBottomInset();
  if (hidden) return null;
  const field = isFieldTheme(theme);
  return (
    <LibBottomNav
      items={items.map((item) => ({
        key: item.key,
        label: item.label,
        icon: item.icon,
        name: nameWithBadge(item.label, item.badge, item.badgeNoun),
        bubble:
          typeof item.badge === 'number' && item.badge > 0
            ? item.badge > 99
              ? '99+'
              : String(item.badge)
            : item.badge === true
              ? true
              : undefined,
      }))}
      active={active}
      onSelect={onChange ?? (() => {})}
      label={label}
      tone={props.tone ?? (field ? 'field' : 'raised')}
      field={field}
      bottomInset={bottomInset}
      style={[shadowOf(theme, 'sticky'), style]}
      testID={resolveTestId(props, 'BottomNav')}
    />
  );
}

/* ───── Sheet ───── */

/** Props of the live `Sheet`. */
export interface SheetProps extends DsCommon {
  open: boolean;
  /** bottom (default) · side · full (rider offer, above everything). */
  variant?: 'bottom' | 'side' | 'full';
  /** REQUIRED — the sheet's accessible name. */
  title: string;
  /** Keeps the title for assistive technology and hides it visually. */
  hideTitle?: boolean;
  children?: React.ReactNode;
  /** Sticky footer (never under the keyboard). */
  footer?: React.ReactNode;
  onClose?: () => void;
  /** true (default): scrim tap, back and a visible close button close it. false: the rider offer. */
  dismissible?: boolean;
  /** `bottom` only: the panel's height cap (default "86%"). */
  maxHeight?: string;
  /** Accepted for API parity (docs previews only). */
  contained?: boolean;
  /** Native extension: the rider field register. Default: field on the rider theme. */
  tone?: 'default' | 'field';
}

/** Overlay panel; `full` with `dismissible={false}` is the rider offer. */
export function Sheet(props: SheetProps) {
  const { open, variant = 'bottom', title, hideTitle, children, footer, onClose, dismissible = true, maxHeight, tone } = props;
  const theme = useTheme();
  const wrap = useOverlayWrap();
  const top = useTopInset();
  const bottom = useBottomInset();
  const onDismiss = dismissible ? onClose : undefined;
  const testID = resolveTestId(props, 'Sheet');
  return (
    <LibSheet
      open={open}
      variant={variant}
      title={title}
      hideTitle={hideTitle}
      footer={footer}
      onDismiss={onDismiss}
      closeButton={
        onDismiss ? <IconButton icon="close" accessibilityLabel="Close" onPress={onDismiss} testID={`${testID}-close`} /> : undefined
      }
      field={tone ? tone === 'field' : isFieldTheme(theme)}
      insets={{ top, bottom }}
      maxHeight={maxHeight as DimensionValue | undefined}
      wrap={wrap}
      testID={testID}
    >
      {children}
    </LibSheet>
  );
}

/* ───── Modal / Dialog ───── */

/** Props of the live `Modal`. */
export interface ModalProps extends DsCommon {
  open: boolean;
  /** dialog = title + body + actions · confirm = a decision · alert = one acknowledgement. */
  variant?: 'dialog' | 'confirm' | 'alert';
  /** REQUIRED — the accessible name. */
  title: string;
  description?: string;
  children?: React.ReactNode;
  /** `dialog` only: the footer actions. */
  actions?: React.ReactNode;
  /** Called by Cancel / OK and, when dismissible, by back and the scrim. */
  onClose?: () => void;
  /** confirm: the decisive action. */
  confirmLabel?: string;
  onConfirm?: () => void;
  confirmLoading?: boolean;
  /** confirm: the least destructive action. Default "Cancel". */
  cancelLabel?: string;
  /** confirm: the decisive action uses the danger variant. */
  destructive?: boolean;
  /** alert: default "OK". */
  acknowledgeLabel?: string;
  /** Default true. */
  dismissible?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** Accepted for API parity (docs previews only). */
  contained?: boolean;
}

/**
 * Blocking dialog: dialog, confirm (cancel first) or alert. The least destructive action takes
 * focus on open; on a phone the actions stack 24pt apart.
 */
export function Modal(props: ModalProps) {
  const {
    open,
    variant = 'dialog',
    title,
    description,
    children,
    actions,
    onClose,
    confirmLabel = 'Confirm',
    onConfirm,
    confirmLoading,
    cancelLabel = 'Cancel',
    destructive = false,
    acknowledgeLabel = 'OK',
    dismissible = true,
    size,
  } = props;
  const theme = useTheme();
  const wrap = useOverlayWrap();
  const safest = React.useRef<View>(null);
  const close = onClose ?? (() => {});
  const testID = resolveTestId(props, 'Modal');
  const buttons: React.ReactNode[] =
    variant === 'confirm'
      ? [
          <Button key="cancel" ref={safest} variant="tertiary" size="lg" fullWidth onPress={close} testID={`${testID}-cancel`}>
            {cancelLabel}
          </Button>,
          <Button
            key="confirm"
            variant={destructive ? 'danger' : 'primary'}
            size="lg"
            fullWidth
            loading={confirmLoading}
            onPress={onConfirm ?? close}
            testID={`${testID}-confirm`}
          >
            {confirmLabel}
          </Button>,
        ]
      : variant === 'alert'
        ? [
            <Button key="ok" ref={safest} variant="primary" size="lg" fullWidth onPress={close} testID={`${testID}-ok`}>
              {acknowledgeLabel}
            </Button>,
          ]
        : actions
          ? [<React.Fragment key="actions">{actions}</React.Fragment>]
          : [];
  const onDismiss = dismissible ? close : undefined;
  return (
    <LibDialog
      open={open}
      alert={variant !== 'dialog'}
      title={title}
      description={description}
      actions={buttons}
      initialFocusRef={variant === 'dialog' ? undefined : safest}
      onDismiss={onDismiss}
      closeButton={
        variant === 'dialog' && onDismiss ? (
          <IconButton icon="close" accessibilityLabel="Close" onPress={onDismiss} testID={`${testID}-close`} />
        ) : undefined
      }
      size={size}
      panelStyle={[shadowOf(theme, '4'), props.style]}
      wrap={wrap}
      testID={testID}
    >
      {children}
    </LibDialog>
  );
}

/** @deprecated The old name of `Modal`; defaults `open` to true. */
export function Dialog(props: Partial<ModalProps>) {
  return <Modal open title="" {...props} />;
}

/* ───── Toast ───── */

/** Props of the live `Toast`. */
export interface ToastProps extends DsCommon {
  /** No `halal` variant, and success is a tint — never a green fill. */
  variant?: ToastVariant;
  title: string;
  description?: string;
  /**
   * An action makes the toast persistent. `onPress` is the legacy name, kept as a deprecated
   * alias of `onAction` for one release.
   */
  action?: { label: string; onAction?: () => void; /** @deprecated use `onAction` */ onPress?: () => void };
  /** ms, default 5000. danger and action toasts are persistent. */
  duration?: number;
  onDismiss?: () => void;
  icon?: AnyIconName;
  /** Native extension: dock at the bottom (default) or the top (never over a sticky footer). */
  placement?: 'top' | 'bottom';
  /** Native extension: points above (or below) whatever is docked at that edge. */
  offset?: number;
}

/** A short, non-blocking message in the toast layer; success is a tint, never a green fill. */
export function Toast(props: ToastProps) {
  const { variant, title, description, action, duration, onDismiss, icon, placement = 'bottom', offset = 16 } = props;
  const theme = useTheme();
  const wrap = useOverlayWrap();
  const top = useTopInset();
  const bottom = useBottomInset();
  const onAction = action?.onAction ?? action?.onPress;
  return (
    <LibToast
      variant={variant}
      title={title}
      description={description}
      action={action && onAction ? { label: action.label, onPress: onAction } : undefined}
      duration={duration}
      onDismiss={onDismiss}
      icon={icon}
      placement={placement}
      offset={offset + (placement === 'top' ? top : bottom)}
      field={isFieldTheme(theme)}
      style={props.style}
      wrap={wrap}
      testID={resolveTestId(props, 'Toast')}
    />
  );
}

/* ───── StickyFooter (proposed) ───── */

/** Props of the proposed `StickyFooter` (`@hg/ui-native/proposed`; plan §2.2 "StickyFooter / ActionBar"). */
export interface StickyFooterProps extends DsCommon {
  /** The screen's primary action(s): Buttons, a Price beside "Add to cart". */
  children?: React.ReactNode;
}

/**
 * The bar pinned under a screen's content holding its primary action: the sticky elevation's
 * surface (upward shadow in light, a surface step in dark) and the safe-area bottom inset.
 */
export function StickyFooter(props: StickyFooterProps) {
  const theme = useTheme();
  const bottomInset = useBottomInset();
  return (
    <LibStickyFooter
      bottomInset={bottomInset}
      field={isFieldTheme(theme)}
      style={[shadowOf(theme, 'sticky'), props.style]}
      testID={resolveTestId(props, 'StickyFooter')}
    >
      {props.children}
    </LibStickyFooter>
  );
}
