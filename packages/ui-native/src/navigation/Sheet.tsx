/**
 * `Sheet` — 02-components.md §30.
 *
 * Variants: `bottom` (default), `side` (filters/detail), `full` (the rider offer).
 *
 * The one that matters is `dismissible={false}`. The rider offer sheet is non-dismissible until
 * the server's `expires_at` (D-14): no backdrop tap, no swipe, no hardware back. It is the single
 * place in this system where trapping a user without an escape is correct, because the alternative
 * is a rider silently losing a job — the shipped app dismissed at 7 s against a 5-minute window,
 * and that is the exact failure this prop exists to prevent. A non-dismissible sheet therefore has
 * **no close button either**: an affordance that does nothing is worse than none.
 *
 * Everywhere else: focus enters on open and returns to the trigger on close; a drag handle is
 * present but never the only way out; `keyboardAvoiding` is on by default, because a sheet whose
 * submit button sits under the keyboard is broken.
 */
import { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  BackHandler,
  KeyboardAvoidingView,
  Modal as RNModal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import type { ReactNode } from 'react';
import type { ViewStyle } from 'react-native';

import { useTheme, type, radius, icon, zIndex, useDuration } from '../feedback/internal/theme';
import { CloseGlyph } from '../feedback/internal/glyphs';
import { moveAccessibilityFocus, useReduceMotion } from '../feedback/internal/a11y';

export type SheetVariant = 'bottom' | 'side' | 'full';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  variant?: SheetVariant;
  /** Fractions of the screen height, ascending. `bottom` only. Defaults to `[0.5]`. */
  snapPoints?: readonly number[];
  /** Which snap point to rest at. Defaults to the first. */
  snapIndex?: number;
  /**
   * `false` = the rider-offer contract: no backdrop tap, no swipe, no back button, no close
   * button. Only the owner closing it (at server `expires_at`) takes it away.
   */
  dismissible?: boolean;
  /** The accessible name of the dialog. Required — an unnamed dialog is unusable with AT. */
  title: string;
  description?: string;
  /** Pinned below the scroll area. Sticky actions live here so they clear the keyboard. */
  footer?: ReactNode;
  scrollable?: boolean;
  keyboardAvoiding?: boolean;
  /** Focus returns here on close. Pass the trigger's ref (04-accessibility.md §4.2). */
  returnFocusRef?: { current: any };
  /** `zIndex.offerSheet` outranks everything; anything else uses `zIndex.sheet`. */
  elevate?: 'sheet' | 'offer';
  children?: ReactNode;
  style?: ViewStyle;
  testID?: string;
}

export function Sheet({
  open,
  onClose,
  variant = 'bottom',
  snapPoints = [0.5],
  snapIndex = 0,
  dismissible = true,
  title,
  description,
  footer,
  scrollable = true,
  keyboardAvoiding = true,
  returnFocusRef,
  elevate = 'sheet',
  children,
  style,
  testID = 'Sheet',
}: SheetProps) {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const { height: screenHeight } = useWindowDimensions();
  const enterMs = useDuration('base');
  const titleRef = useRef<Text>(null);

  const snap = snapPoints[Math.min(snapIndex, snapPoints.length - 1)] ?? 0.5;
  const panelHeight = variant === 'full' ? screenHeight : Math.round(screenHeight * snap);

  const translate = useRef(new Animated.Value(1)).current;
  const drag = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!open) return;
    Animated.spring(translate, {
      toValue: 0,
      useNativeDriver: true,
      // Reduced motion: no slide, and the cross-fade the backdrop already provides is enough.
      speed: reduceMotion ? 100 : 14,
      bounciness: reduceMotion ? 0 : 4,
    }).start();
    // Focus moves in on open and is trapped by the native modal.
    const t = setTimeout(() => moveAccessibilityFocus(titleRef), reduceMotion ? 0 : enterMs);
    return () => clearTimeout(t);
  }, [open, reduceMotion, translate, enterMs]);

  useEffect(() => {
    if (open) return;
    translate.setValue(1);
    drag.setValue(0);
    if (returnFocusRef) moveAccessibilityFocus(returnFocusRef);
  }, [open, translate, drag, returnFocusRef]);

  /* Hardware back. A non-dismissible sheet swallows it rather than letting it fall through to the
   * screen underneath — which would be the "rider loses the offer" bug in a different costume. */
  useEffect(() => {
    if (!open || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (dismissible) onClose();
      return true;
    });
    return () => sub.remove();
  }, [open, dismissible, onClose]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => dismissible && variant === 'bottom' && g.dy > 4,
        onPanResponderMove: (_e, g) => {
          if (g.dy > 0) drag.setValue(g.dy);
        },
        onPanResponderRelease: (_e, g) => {
          if (g.dy > panelHeight * 0.3) onClose();
          else Animated.spring(drag, { toValue: 0, useNativeDriver: true, speed: 20 }).start();
        },
      }),
    [dismissible, variant, drag, panelHeight, onClose],
  );

  if (!open) return null;

  const enterOffset = translate.interpolate({
    inputRange: [0, 1],
    outputRange: [0, variant === 'side' ? 0 : panelHeight],
  });

  const panel = (
    <Animated.View
      accessibilityViewIsModal
      accessibilityRole="none"
      role="dialog"
      aria-modal
      accessibilityLabel={title}
      testID={testID}
      style={[
        variant === 'side' ? styles.side : styles.bottom,
        {
          maxHeight: variant === 'full' ? '100%' : panelHeight,
          height: variant === 'full' ? '100%' : undefined,
          backgroundColor: theme.color.surface.raised,
          borderTopStartRadius: variant === 'bottom' ? radius.xl : 0,
          borderTopEndRadius: variant === 'bottom' ? radius.xl : 0,
          transform: [{ translateY: Animated.add(enterOffset, drag) }],
        },
        style,
      ]}
      {...(dismissible && variant === 'bottom' ? pan.panHandlers : {})}
    >
      {/* Present, but never the only way out — there is always a visible close button too. */}
      {dismissible && variant === 'bottom' ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.handle, { backgroundColor: theme.color.border.strong }]}
        />
      ) : null}

      <View
        style={[
          styles.header,
          { paddingHorizontal: theme.density.gutter, paddingTop: theme.target.spacing * 2, gap: theme.target.spacing },
        ]}
      >
        <View style={{ flex: 1 }}>
          <Text
            ref={titleRef}
            accessibilityRole="header"
            style={[type(theme, 'heading.md'), { color: theme.color.text.primary }]}
          >
            {title}
          </Text>
          {description ? (
            <Text style={[type(theme, 'body.sm'), { color: theme.color.text.secondary }]}>
              {description}
            </Text>
          ) : null}
        </View>

        {dismissible ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Close ${title}`}
            onPress={onClose}
            hitSlop={theme.target.spacing}
            testID={`${testID}-close`}
            style={{
              width: theme.target.min,
              height: theme.target.min,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <CloseGlyph size={icon.lg} color={theme.color.text.secondary} />
          </Pressable>
        ) : null}
      </View>

      {scrollable ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: theme.density.gutter, gap: theme.target.spacing * 2 }}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, padding: theme.density.gutter, gap: theme.target.spacing * 2 }}>
          {children}
        </View>
      )}

      {footer ? (
        <View
          style={{
            padding: theme.density.gutter,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderColor: theme.color.border.decorative,
            backgroundColor: theme.color.surface.raised,
          }}
        >
          {footer}
        </View>
      ) : null}
    </Animated.View>
  );

  return (
    <RNModal
      visible={open}
      transparent
      animationType="none"
      // Swallowed when non-dismissible: iOS/Android must not close it behind our back.
      onRequestClose={dismissible ? onClose : () => undefined}
      statusBarTranslucent
      testID={`${testID}-modal`}
    >
      <View style={[StyleSheet.absoluteFill, { zIndex: elevate === 'offer' ? zIndex.offerSheet : zIndex.sheet }]}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          disabled={!dismissible}
          onPress={dismissible ? onClose : undefined}
          testID={`${testID}-backdrop`}
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.color.surface.scrim }]}
        />
        {keyboardAvoiding ? (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.fill}
            pointerEvents="box-none"
          >
            {panel}
          </KeyboardAvoidingView>
        ) : (
          <View style={styles.fill} pointerEvents="box-none">
            {panel}
          </View>
        )}
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  bottom: { width: '100%', overflow: 'hidden' },
  side: { height: '100%', alignSelf: 'flex-end', width: '85%', overflow: 'hidden' },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 8 },
  header: { flexDirection: 'row', alignItems: 'flex-start' },
});
