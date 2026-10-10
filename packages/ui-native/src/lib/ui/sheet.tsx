/**
 * The overlay panel for the className tier (design-system N2). React Native Reusables has no
 * bottom sheet, so this is a composite: `@rn-primitives/portal` (see `overlay.tsx`), RN
 * `Animated` (no Reanimated) and a `KeyboardAvoidingView`.
 *
 * Variants: `bottom` (default; rounded top, at most 86% tall), `side` (from the end edge, at most
 * 420pt wide) and `full` (the whole screen, at `z-offerSheet`, above every other layer: the rider
 * offer). `dismissible` is expressed by passing `onDismiss`: without it there is no scrim tap, no
 * drag handle, no close button and the Android back button is swallowed. That is the rider offer
 * contract (D-14): nothing but the caller takes it away before the server's `expires_at`.
 *
 * Accessibility: the panel is a `dialog` with `aria-modal` named by the title, and sets
 * `accessibilityViewIsModal` so VoiceOver stays inside it. The title is a focusable heading and
 * takes focus on open; `hideTitle` keeps it for assistive technology and hides it visually. The
 * `footer` sits outside the scroll area, inside the keyboard-avoiding view, so it is never under
 * the keyboard.
 */
import * as React from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text as RNText,
  View,
  type DimensionValue,
} from 'react-native';

import { useReduceMotion } from '../../feedback/internal/a11y';
import { cn } from '../utils';
import './animated';
import { OverlayPortal, useBackToDismiss, useInitialFocus, type OverlayWrap } from './overlay';

/** bottom (default) · side · full (the rider offer, above everything). */
export type SheetVariant = 'bottom' | 'side' | 'full';

/** Props of the className-tier `Sheet`. */
export interface SheetProps {
  open: boolean;
  variant?: SheetVariant;
  /** The dialog's accessible name and its heading. */
  title: string;
  /** Keeps the heading for assistive technology, hides it visually. */
  hideTitle?: boolean;
  children?: React.ReactNode;
  /** Pinned below the scroll area and above the keyboard. */
  footer?: React.ReactNode;
  /** Present = dismissible: scrim tap, Android back and the close control call it. */
  onDismiss?: () => void;
  /** The close control (a named IconButton), shown only when dismissible. */
  closeButton?: React.ReactNode;
  /** The field (rider) register: roomier padding and a larger heading. */
  field?: boolean;
  /** Safe-area insets in points (read outside the portal). */
  insets?: { top: number; bottom: number };
  /** `bottom` only: overrides the 86% cap. */
  maxHeight?: DimensionValue;
  /** Re-provides context inside the portal. */
  wrap?: OverlayWrap;
  testID?: string;
}

/** Entry duration in ms (`motion.duration.moderate`). */
const ENTER_MS = 240;

/** The sheet, portalled to the root host while `open`. */
export function Sheet(props: SheetProps): React.ReactElement | null {
  if (!props.open) return null;
  return (
    <OverlayPortal wrap={props.wrap}>
      <SheetLayer {...props} />
    </OverlayPortal>
  );
}

function SheetLayer({
  variant = 'bottom',
  title,
  hideTitle = false,
  children,
  footer,
  onDismiss,
  closeButton,
  field = false,
  insets = { top: 0, bottom: 0 },
  maxHeight,
  testID = 'Sheet',
}: SheetProps): React.ReactElement {
  const full = variant === 'full';
  const side = variant === 'side';
  const reduceMotion = useReduceMotion();
  const titleRef = React.useRef<RNText>(null);
  const enter = React.useRef(new Animated.Value(0)).current;

  useBackToDismiss(onDismiss);
  useInitialFocus(titleRef, reduceMotion ? 0 : ENTER_MS);
  React.useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: reduceMotion ? 0 : ENTER_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enter, reduceMotion]);

  // Reduced motion: a cross-fade, no slide.
  const offset = reduceMotion || full ? 0 : 48;
  const slide = enter.interpolate({ inputRange: [0, 1], outputRange: [offset, 0] });
  const motion = { opacity: enter, transform: [side ? { translateX: slide } : { translateY: slide }] };

  const surface = full ? 'bg-background' : 'bg-card';
  const gutter = field ? 'px-6' : 'px-5';

  return (
    <View testID={`${testID}-layer`} pointerEvents="box-none" className={cn('absolute inset-0', full ? 'z-offerSheet' : 'z-sheet')}>
      {full ? null : (
        <Pressable
          testID={`${testID}-scrim`}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          disabled={!onDismiss}
          onPress={onDismiss}
          className="absolute inset-0 bg-surface-scrim"
        />
      )}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        pointerEvents="box-none"
        style={{ flex: 1, flexDirection: side ? 'row' : 'column', justifyContent: side ? 'flex-end' : 'flex-end' }}
      >
        <Animated.View
          testID={testID}
          role="dialog"
          aria-modal
          aria-label={title}
          accessibilityViewIsModal
          className={cn(
            'overflow-hidden',
            surface,
            full && 'h-full w-full',
            side && 'h-full w-[85%] max-w-[420px] rounded-s-2xl',
            variant === 'bottom' && 'max-h-[86%] w-full rounded-t-2xl',
          )}
          style={[motion, full || side ? { paddingTop: insets.top } : null, variant === 'bottom' && maxHeight ? { maxHeight } : null]}
        >
          {variant === 'bottom' && onDismiss ? (
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              className="mt-2 h-1 w-10 self-center rounded-full bg-border-strong opacity-40"
            />
          ) : null}
          <View className={cn('flex-row items-center gap-3', gutter, field ? 'pt-4' : 'pt-3')}>
            <RNText
              ref={titleRef}
              testID={`${testID}-title`}
              accessibilityRole="header"
              className={cn(
                'flex-1 font-sans-semibold text-foreground',
                field ? 'text-heading-xl' : 'text-heading-lg',
                hideTitle && 'absolute h-px w-px overflow-hidden',
              )}
            >
              {title}
            </RNText>
            {onDismiss && closeButton ? <View className="-me-2">{closeButton}</View> : null}
          </View>
          <ScrollView
            testID={`${testID}-body`}
            keyboardShouldPersistTaps="handled"
            className={variant === 'bottom' ? 'grow-0' : 'flex-1'}
            contentContainerClassName={cn('gap-4 pt-3', gutter, field ? 'pb-6' : 'pb-5')}
            contentContainerStyle={footer ? undefined : { paddingBottom: 20 + insets.bottom }}
          >
            {children}
          </ScrollView>
          {footer ? (
            <View
              testID={`${testID}-footer`}
              className={cn('gap-3 border-t border-border pt-3', surface, gutter)}
              style={{ paddingBottom: (field ? 24 : 20) + insets.bottom }}
            >
              {footer}
            </View>
          ) : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}
