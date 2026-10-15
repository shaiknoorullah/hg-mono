/**
 * The blocking dialog for the className tier (design-system N2): RNR's `AlertDialog` / `Dialog`
 * shape, rendered through the shared portal (see `overlay.tsx`) on the scrim.
 *
 * `alert` makes it an `alertdialog`, which announces at once (the live `confirm` and `alert`
 * variants); a plain `dialog` waits to be explored. Both set `aria-modal` and
 * `accessibilityViewIsModal`, are named by the title, and carry the description as their hint.
 *
 * Actions arrive in reading order with the least destructive FIRST, and the `/ds` layer hands
 * that action's ref in as `initialFocusRef`, so a reflexive double tap can never confirm. On a
 * narrow screen (under 480pt, every phone) actions stack full width, 24pt apart, so a
 * destructive action is never a thumb's slip from the safe one; wider, they sit in a row at the
 * end, 12pt apart.
 */
import * as React from 'react';
import { Animated, Pressable, ScrollView, Text as RNText, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';

import { useReduceMotion } from '../../feedback/internal/a11y';
import { cn } from '../utils';
import './animated';
import { OverlayPortal, useBackToDismiss, useInitialFocus, type OverlayWrap } from './overlay';
import { Text } from './text';

/** Width caps in points (live `size`). */
export const DIALOG_WIDTH = { sm: 320, md: 400, lg: 520 } as const;
/** Below this window width the actions stack. */
export const STACK_BELOW = 480;

/** Props of the className-tier `Dialog`. */
export interface DialogProps {
  open: boolean;
  /** `alertdialog` (confirm, alert): announced at once. */
  alert?: boolean;
  title: string;
  description?: string;
  children?: React.ReactNode;
  /** Ordered least destructive first. */
  actions?: React.ReactNode[];
  /** Receives screen-reader focus on open (the least destructive action). Default: the title. */
  initialFocusRef?: React.RefObject<unknown>;
  /** Present = dismissible: scrim tap and Android back call it. */
  onDismiss?: () => void;
  /** A named close IconButton, shown beside the title when dismissible. */
  closeButton?: React.ReactNode;
  size?: keyof typeof DIALOG_WIDTH;
  /** The /ds layer's elevation (shadow in light). */
  panelStyle?: StyleProp<ViewStyle>;
  wrap?: OverlayWrap;
  testID?: string;
}

/** The dialog, portalled to the root host while `open`. */
export function Dialog(props: DialogProps): React.ReactElement | null {
  if (!props.open) return null;
  return (
    <OverlayPortal wrap={props.wrap}>
      <DialogLayer {...props} />
    </OverlayPortal>
  );
}

function DialogLayer({
  alert = false,
  title,
  description,
  children,
  actions = [],
  initialFocusRef,
  onDismiss,
  closeButton,
  size = 'md',
  panelStyle,
  testID = 'Modal',
}: DialogProps): React.ReactElement {
  const { width } = useWindowDimensions();
  const stacked = width < STACK_BELOW;
  const reduceMotion = useReduceMotion();
  const titleRef = React.useRef<RNText>(null);
  const fade = React.useRef(new Animated.Value(0)).current;

  useBackToDismiss(onDismiss);
  useInitialFocus(initialFocusRef ?? titleRef, reduceMotion ? 0 : 180);
  React.useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: reduceMotion ? 0 : 180, useNativeDriver: true }).start();
  }, [fade, reduceMotion]);

  return (
    <View testID={`${testID}-layer`} className="absolute inset-0 z-modal items-center justify-center p-4">
      <Pressable
        testID={`${testID}-scrim`}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        disabled={!onDismiss}
        onPress={onDismiss}
        className="absolute inset-0 bg-surface-scrim"
      />
      <Animated.View
        testID={testID}
        role={alert ? 'alertdialog' : 'dialog'}
        aria-modal
        aria-label={title}
        accessibilityHint={description}
        accessibilityViewIsModal
        className="max-h-full w-full rounded-xl bg-card p-6"
        style={[{ maxWidth: DIALOG_WIDTH[size], opacity: fade }, panelStyle]}
      >
        <View className="mb-4 flex-row items-start gap-3">
          <View className="flex-1 gap-2">
            <RNText
              ref={titleRef}
              testID={`${testID}-title`}
              accessibilityRole="header"
              className="font-sans-semibold text-heading-lg text-foreground"
            >
              {title}
            </RNText>
            {description ? <Text className="text-body-md text-muted-foreground">{description}</Text> : null}
          </View>
          {onDismiss && closeButton ? <View className="-me-2 -mt-2">{closeButton}</View> : null}
        </View>
        {children ? (
          <ScrollView keyboardShouldPersistTaps="handled" className="shrink">
            {children}
          </ScrollView>
        ) : null}
        {actions.length ? (
          <View
            testID={`${testID}-actions`}
            className={cn('mt-6', stacked ? 'flex-col gap-6' : 'flex-row flex-wrap justify-end gap-3')}
          >
            {actions}
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}
