/**
 * The parts of the state machine every primitive shares.
 *
 * Components §0 closes the set of states: `default`, `hover` (pointer surfaces only),
 * `pressed`, `focus-visible`, `disabled`, `loading`. Two of those are easy to get wrong and
 * are therefore centralised here:
 *
 *  - **`loading` is not `disabled`.** A loading control keeps its accessible name, sets
 *    `accessibilityState.busy`, and blocks re-entry by ignoring the event. It does not go
 *    grey and lose its label.
 *  - **`disabled` is `aria-disabled`, not `disabled`.** RN's `disabled` prop removes the
 *    control from the accessibility tree, and a disabled control that cannot explain itself
 *    is worse than none. We keep it focusable, announce the state, and swallow the press.
 */
import { useCallback, useMemo, useState } from 'react';
import { View, type Insets, type ViewStyle } from 'react-native';

export interface InteractionOptions {
  disabled?: boolean;
  loading?: boolean;
}

export interface Interaction {
  pressed: boolean;
  /** RN reports focus only from the accessibility/keyboard layer, which is what §0.2 wants:
   *  `focus-visible`, never pointer focus. */
  focused: boolean;
  /** true when a press must be swallowed rather than delivered */
  inert: boolean;
  handlers: {
    onPressIn: () => void;
    onPressOut: () => void;
    onFocus: () => void;
    onBlur: () => void;
  };
  accessibilityState: { disabled: boolean; busy: boolean };
}

export function useInteraction({ disabled, loading }: InteractionOptions = {}): Interaction {
  const [pressed, setPressed] = useState(false);
  const [focused, setFocused] = useState(false);

  const handlers = useMemo(
    () => ({
      onPressIn: () => setPressed(true),
      onPressOut: () => setPressed(false),
      onFocus: () => setFocused(true),
      onBlur: () => setFocused(false),
    }),
    [],
  );

  return {
    pressed: pressed && !disabled && !loading,
    focused,
    inert: Boolean(disabled || loading),
    handlers,
    accessibilityState: { disabled: Boolean(disabled), busy: Boolean(loading) },
  };
}

/** Wraps an `onPress` so a disabled or loading control swallows the event silently. */
export function useGuardedPress(
  onPress: (() => void) | undefined,
  inert: boolean,
): (() => void) | undefined {
  return useCallback(() => {
    if (inert) return;
    onPress?.();
  }, [onPress, inert]);
}

/**
 * Grow the *hit area* to the target floor when the visual is smaller — §2 of the
 * accessibility standard is explicit that the visual never grows to meet the rule.
 */
export function hitSlopFor(visual: number, target: number): Insets {
  const pad = Math.max(0, Math.ceil((target - visual) / 2));
  return { top: pad, bottom: pad, left: pad, right: pad };
}

/**
 * `state.hoverOverlay` / `state.pressedOverlay` composited over a fill, as a sibling layer
 * rather than a colour computation — the overlay tokens are translucent for exactly this.
 */
export function StateOverlay({
  color,
  radius,
  visible,
}: {
  color: string;
  radius: number;
  visible: boolean;
}) {
  if (!visible) return null;
  const style: ViewStyle = {
    position: 'absolute',
    top: 0,
    bottom: 0,
    start: 0,
    end: 0,
    borderRadius: radius,
    backgroundColor: color,
  };
  return <View pointerEvents="none" style={style} />;
}
