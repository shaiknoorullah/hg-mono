import { View } from 'react-native';

import { toneOf } from '../feedback/internal/theme';
import { AppBar as LegacyAppBar, type AppBarVariant } from '../navigation/AppBar';
import { BottomNav as LegacyBottomNav } from '../navigation/BottomNav';
import { Modal as LegacyModal } from '../navigation/Modal';
import { Sheet as LegacySheet } from '../navigation/Sheet';
import { Toast as LegacyToast, type ToastVariant } from '../primitives/Toast';
import type { ActionSpec } from '../feedback/internal/primitives';
import { useTheme } from '../tokens';
import { Icon } from './Icon';
import { type AnyIconName, type DsCommon, resolveTestId } from './shared';

/* ───── AppBar ───── */

export interface AppBarProps extends DsCommon {
  variant?: AppBarVariant;
  /** Theme surface only — cream (customer) · raised · chrome · field (rider). */
  tone?: 'cream' | 'raised' | 'chrome' | 'field';
  title?: string;
  subtitle?: string;
  /** "Back to {previous}" — required whenever the destination is known. */
  backLabel?: string;
  /** Renders a 44px back button (contextual: "Clear selection"). */
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
}

export function AppBar(props: AppBarProps) {
  const { title, subtitle, backLabel, onBack, actions, search, titleIsPageHeading, tone, variant, loading, elevated, style } =
    props;
  return (
    <LegacyAppBar
      title={title ?? ''}
      subtitle={subtitle}
      variant={variant}
      tone={tone}
      loading={loading}
      elevated={elevated}
      back={onBack ? { onPress: onBack } : undefined}
      backLabel={backLabel ?? (variant === 'contextual' && onBack ? 'Clear selection' : undefined)}
      actionsSlot={actions}
      searchSlot={search}
      isPageHeading={titleIsPageHeading ?? true}
      style={style as never}
      testID={resolveTestId(props, 'AppBar')}
    />
  );
}

/* ───── BottomNav ───── */

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

export interface BottomNavProps extends DsCommon {
  items: BottomNavItem[];
  /** Key of the active item. */
  active: string;
  onChange?: (key: string) => void;
  /** Names the navigation. Accepted for API parity. */
  label?: string;
  /** Accepted for API parity; the register comes from the ThemeProvider. */
  tone?: 'raised' | 'field';
  /** Renders nothing — REQUIRED during the rider offer sheet and during checkout. */
  hidden?: boolean;
}

export function BottomNav(props: BottomNavProps) {
  const { items, active, onChange, hidden, style } = props;
  const theme = useTheme();
  const brand = toneOf(theme, 'brand');
  if (hidden) return null;
  return (
    <LegacyBottomNav
      items={items.map((item) => ({
        key: item.key,
        label: item.label,
        badge: item.badge,
        badgeNoun: item.badgeNoun,
        icon: <Icon name={item.icon} size="lg" color={theme.color.text.tertiary} />,
        activeIcon: <Icon name={item.icon} weight="bold" size="lg" color={brand.solid} />,
      }))}
      active={active}
      onChange={onChange ?? (() => {})}
      style={style as never}
      testID={resolveTestId(props, 'BottomNav')}
    />
  );
}

/* ───── Sheet ───── */

export interface SheetProps extends DsCommon {
  open: boolean;
  /** bottom (default) · side · full (rider offer, above everything). */
  variant?: 'bottom' | 'side' | 'full';
  /** REQUIRED — the sheet's accessible name. */
  title: string;
  /** Accepted for API parity; the title stays visible on native until N2. */
  hideTitle?: boolean;
  children?: React.ReactNode;
  /** Sticky footer (never under the keyboard). */
  footer?: React.ReactNode;
  onClose?: () => void;
  /** true (default): scrim tap, back and a visible close button close it. false: the rider offer. */
  dismissible?: boolean;
  /** Accepted for API parity. */
  maxHeight?: string;
  /** Accepted for API parity (docs previews only). */
  contained?: boolean;
}

export function Sheet(props: SheetProps) {
  const { open, variant = 'bottom', title, children, footer, onClose, dismissible = true, style } = props;
  return (
    <LegacySheet
      open={open}
      onClose={onClose ?? (() => {})}
      variant={variant}
      title={title}
      footer={footer}
      dismissible={dismissible}
      elevate={variant === 'full' ? 'offer' : 'sheet'}
      style={style as never}
      testID={resolveTestId(props, 'Sheet')}
    >
      {children}
    </LegacySheet>
  );
}

/* ───── Modal / Dialog ───── */

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
    style,
  } = props;
  const close = onClose ?? (() => {});
  const specs: ActionSpec[] =
    variant === 'confirm'
      ? [
          { label: cancelLabel, onPress: close },
          { label: confirmLabel, onPress: onConfirm ?? close, loading: confirmLoading, destructive },
        ]
      : variant === 'alert'
        ? [{ label: acknowledgeLabel, onPress: close }]
        : [];
  return (
    <LegacyModal
      open={open}
      onClose={close}
      variant={variant}
      title={title}
      description={description}
      actions={specs}
      destructive={destructive}
      dismissible={dismissible}
      size={size}
      style={style as never}
      testID={resolveTestId(props, 'Modal')}
    >
      {children}
      {variant === 'dialog' && actions ? <View>{actions}</View> : null}
    </LegacyModal>
  );
}

/** @deprecated The old name of `Modal`; defaults `open` to true. */
export function Dialog(props: Partial<ModalProps>) {
  return <Modal open title="" {...props} />;
}

/* ───── Toast ───── */

export interface ToastProps extends DsCommon {
  /** No `halal` variant, and success is a tint — never a green fill. */
  variant?: ToastVariant;
  title: string;
  description?: string;
  /** An action makes the toast persistent. */
  action?: { label: string; onAction: () => void };
  /** ms, default 5000. danger and action toasts are persistent. */
  duration?: number;
  onDismiss?: () => void;
  icon?: AnyIconName;
}

export function Toast(props: ToastProps) {
  const { action, icon, style, testId: _t, testID: _T, ...rest } = props;
  const theme = useTheme();
  const toast = (
    <LegacyToast
      {...rest}
      action={action ? { label: action.label, onPress: action.onAction } : undefined}
      icon={icon ? <Icon name={icon} color={theme.color.text.primary} /> : undefined}
      testID={resolveTestId(props, 'Toast')}
    />
  );
  return style ? <View style={style}>{toast}</View> : toast;
}
