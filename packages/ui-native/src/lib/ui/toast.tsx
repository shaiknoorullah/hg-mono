/**
 * A short, non-blocking message for the className tier (design-system N2). React Native
 * Reusables has no toast, so this is a composite: the shared portal (`overlay.tsx`) at
 * `z-toast`, and an RN `Animated` fade (no Reanimated).
 *
 * Variants: neutral, success, warning, danger, info, every one a TINT plate. Success is the
 * success tint with a success glyph, **never a green fill** (invariant 10; there is no
 * `feedback-success-solid` to reach for). **There is no halal toast**: the shield is drawn only
 * by the halal components, and nothing here can draw it.
 *
 * Danger toasts and toasts with an action are persistent: an auto-dismissing failure is one the
 * user never read, and an action needs time to reach. Otherwise the timer (default 5 s) pauses
 * while a screen reader runs and while focus is on the toast's controls. Danger is an `alert`
 * (assertive); the rest are a polite `status`. The dismiss control is a real 44pt target, 56pt
 * on the field register.
 */
import * as React from 'react';
import { Animated, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { useReduceMotion, useScreenReader } from '../../feedback/internal/a11y';
import type { IconName } from '../../primitives/Icon';
import { cn } from '../utils';
import './animated';
import { Button } from './button';
import { Glyph } from './icon';
import { OverlayPortal, type OverlayWrap } from './overlay';
import { Text } from './text';

/** The live variants. No `halal`, and `success` is a tint. */
export type ToastVariant = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/** Plate, ink, glyph colour and default glyph per variant, all role utilities. */
export const TOAST_INK: Record<ToastVariant, { plate: string; title: string; body: string; glyph: string; icon: IconName }> = {
  neutral: { plate: 'border-border bg-card', title: 'text-foreground', body: 'text-muted-foreground', glyph: 'text-muted-foreground', icon: 'info' },
  success: {
    plate: 'border-feedback-success-tint-border bg-feedback-success-tint',
    title: 'text-feedback-success-tint-text',
    body: 'text-feedback-success-tint-text',
    glyph: 'text-feedback-success-icon',
    icon: 'check',
  },
  warning: {
    plate: 'border-feedback-warning-tint-border bg-feedback-warning-tint',
    title: 'text-feedback-warning-tint-text',
    body: 'text-feedback-warning-tint-text',
    glyph: 'text-feedback-warning-icon',
    icon: 'warning',
  },
  danger: {
    plate: 'border-feedback-danger-tint-border bg-feedback-danger-tint',
    title: 'text-feedback-danger-tint-text',
    body: 'text-feedback-danger-tint-text',
    glyph: 'text-feedback-danger-icon',
    icon: 'error',
  },
  info: {
    plate: 'border-feedback-info-tint-border bg-feedback-info-tint',
    title: 'text-feedback-info-tint-text',
    body: 'text-feedback-info-tint-text',
    glyph: 'text-feedback-info-icon',
    icon: 'info',
  },
};

/** Default lifetime of a non-persistent toast, in ms. */
export const TOAST_DURATION = 5000;

/** Props of the className-tier `Toast`. */
export interface ToastProps {
  variant?: ToastVariant;
  title: string;
  description?: string;
  action?: { label: string; onPress: () => void };
  /** ms; ignored (persistent) for danger and action toasts. 0 or Infinity = persistent. */
  duration?: number;
  /** Shows the 44pt dismiss control, and is called when the timer ends. */
  onDismiss?: () => void;
  icon?: IconName;
  /** Where the layer docks: `bottom` (default) or `top` (never over a sticky footer). */
  placement?: 'top' | 'bottom';
  /** Points from that edge: safe area plus anything docked there (BottomNav, cart bar). */
  offset?: number;
  /** The field register: a 56pt dismiss control. */
  field?: boolean;
  /** Extra style for the toast card. */
  style?: StyleProp<ViewStyle>;
  wrap?: OverlayWrap;
  testID?: string;
}

/** Whether a toast stays until dismissed. */
export function isPersistentToast(variant: ToastVariant, hasAction: boolean, duration?: number): boolean {
  return variant === 'danger' || hasAction || duration === 0 || duration === Infinity;
}

/** The toast, portalled into its layer. */
export function Toast(props: ToastProps): React.ReactElement {
  const { placement = 'bottom', offset = 16, testID = 'Toast' } = props;
  return (
    <OverlayPortal wrap={props.wrap}>
      <View
        testID={`${testID}-layer`}
        pointerEvents="box-none"
        className="absolute inset-x-0 z-toast px-4"
        style={placement === 'top' ? { top: offset } : { bottom: offset }}
      >
        <ToastCard {...props} />
      </View>
    </OverlayPortal>
  );
}

function ToastCard({
  variant = 'neutral',
  title,
  description,
  action,
  duration,
  onDismiss,
  icon,
  field = false,
  style,
  testID = 'Toast',
}: ToastProps): React.ReactElement {
  const ink = TOAST_INK[variant];
  const persistent = isPersistentToast(variant, Boolean(action), duration);
  const screenReader = useScreenReader();
  const reduceMotion = useReduceMotion();
  const [focused, setFocused] = React.useState(false);
  const fade = React.useRef(new Animated.Value(0)).current;
  const dismiss = React.useRef(onDismiss);
  dismiss.current = onDismiss;
  const left = React.useRef(duration ?? TOAST_DURATION);

  React.useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: reduceMotion ? 0 : 240, useNativeDriver: true }).start();
  }, [fade, reduceMotion]);

  React.useEffect(() => {
    if (persistent || focused || screenReader || !dismiss.current) return undefined;
    const started = Date.now();
    const t = setTimeout(() => dismiss.current?.(), left.current);
    return () => {
      clearTimeout(t);
      left.current = Math.max(0, left.current - (Date.now() - started));
    };
  }, [persistent, focused, screenReader]);

  const danger = variant === 'danger';
  const hold = { onFocus: () => setFocused(true), onBlur: () => setFocused(false) };

  return (
    <Animated.View
      testID={testID}
      role={danger ? 'alert' : 'status'}
      accessibilityLiveRegion={danger ? 'assertive' : 'polite'}
      className={cn('min-h-[48px] flex-row items-start gap-3 rounded-md border py-1 ps-4', onDismiss ? 'pe-1' : 'pe-4', ink.plate)}
      style={[{ opacity: fade }, style]}
    >
      <View className="pt-2.5">
        <Glyph name={icon ?? ink.icon} size={20} className={ink.glyph} />
      </View>
      <View
        accessible
        accessibilityLabel={[title, description].filter(Boolean).join('. ')}
        className="flex-1 gap-0.5 py-2.5"
      >
        <Text className={cn('font-sans-semibold text-label-lg', ink.title)}>{title}</Text>
        {description ? <Text className={cn('text-body-sm', ink.body)}>{description}</Text> : null}
      </View>
      {action ? (
        <Pressable
          testID={`${testID}-action`}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          {...hold}
          className="min-h-target-min justify-center self-center rounded-sm px-3 active:opacity-70"
        >
          <Text className={cn('font-sans-semibold text-label-lg underline', ink.title)}>{action.label}</Text>
        </Pressable>
      ) : null}
      {onDismiss ? (
        <Button
          testID={`${testID}-dismiss`}
          variant="plain"
          size={field ? 'icon-lg' : 'icon-md'}
          accessibilityLabel="Dismiss"
          onPress={onDismiss}
          {...hold}
          className="active:bg-transparent active:opacity-70"
        >
          <Glyph name="close" size={18} className={ink.title} />
        </Button>
      ) : null}
    </Animated.View>
  );
}
