/**
 * `Switch` — immediate, self-applying binary state.
 *
 * Used for exactly four things: rider online/offline, restaurant accepting-orders, item
 * availability, admin feature flags.
 *
 * **`loading` keeps the thumb where it was.** The switch does not move until the server
 * confirms. An optimistic toggle that snaps back is the single worst pattern for a rider
 * going offline: they believe they are off, they stop watching, and the offers keep coming.
 *
 * **The position is never the only signal.** The row carries a text state ("Online" /
 * "Offline"), because a thumb on the right means nothing in isolation and nothing in RTL.
 */
import { useEffect, useRef } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';

import { focusRing, tokens, useDuration, useFontScale, useTheme, useTypeStyle } from '../tokens';
import { useGuardedPress, useInteraction } from './internal/interaction';
import { Spinner } from './Spinner';

const TRACK = { width: 52, height: 32 };
const THUMB = 28;

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  /**
   * Server round-trip in flight. The thumb stays put, the control ignores presses, and the
   * accessible name keeps its state.
   */
  loading?: boolean;
  disabled?: boolean;
  /** The visible state words. Defaults to On/Off; the rider dashboard passes Online/Offline. */
  stateLabels?: { on: string; off: string };
  testID?: string;
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  loading = false,
  disabled = false,
  stateLabels = { on: 'On', off: 'Off' },
  testID = 'Switch',
}: SwitchProps) {
  const theme = useTheme();
  const scale = useFontScale();
  const bodyType = useTypeStyle('body.md');
  const captionType = useTypeStyle('caption');
  const labelType = useTypeStyle('label.md');
  const duration = useDuration('fast');
  const { focused, inert, handlers, accessibilityState } = useInteraction({ disabled, loading });
  const press = useGuardedPress(() => onChange(!checked), inert);

  const offset = useRef(new Animated.Value(checked ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(offset, {
      toValue: checked ? 1 : 0,
      duration,
      useNativeDriver: true,
    }).start();
  }, [checked, duration, offset]);

  const stateWord = checked ? stateLabels.on : stateLabels.off;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.space['3'],
        minHeight: Math.round(theme.target.min * scale),
        opacity: disabled ? theme.color.state.disabledOpacity : 1,
      }}
    >
      <View style={{ flexShrink: 1, gap: tokens.space['1'] }}>
        <Text style={{ ...bodyType, color: theme.color.text.primary }}>{label}</Text>
        {description ? (
          <Text style={{ ...captionType, color: theme.color.text.tertiary }}>{description}</Text>
        ) : null}
      </View>

      <View
        style={{
          marginStart: 'auto',
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens.space['2'],
        }}
      >
        <Text
          testID={`${testID}-state`}
          style={{ ...labelType, color: theme.color.text.secondary }}
        >
          {stateWord}
        </Text>

        {/* The row is not the control — two overlapping targets is the most common RN
            accessibility defect. Only this pressable toggles. */}
        <Pressable
          testID={testID}
          onPress={press}
          onPressIn={handlers.onPressIn}
          onPressOut={handlers.onPressOut}
          onFocus={handlers.onFocus}
          onBlur={handlers.onBlur}
          accessibilityRole="switch"
          accessibilityLabel={label}
          accessibilityValue={{ text: stateWord }}
          accessibilityState={{ ...accessibilityState, checked }}
          style={{
            width: TRACK.width,
            height: Math.max(TRACK.height, theme.target.min),
            justifyContent: 'center',
          }}
        >
          <View
            testID={`${testID}-track`}
            style={{
              width: TRACK.width,
              height: TRACK.height,
              borderRadius: tokens.radius.full,
              // 3:1 track-vs-surface is required by WCAG 1.4.11, which is why "off" is
              // border.strong and not a decorative grey.
              backgroundColor: checked ? theme.color.action.trackOn : theme.color.border.strong,
              justifyContent: 'center',
              paddingHorizontal: (TRACK.height - THUMB) / 2,
            }}
          >
            <Animated.View
              testID={`${testID}-thumb`}
              style={{
                width: THUMB,
                height: THUMB,
                borderRadius: tokens.radius.full,
                backgroundColor: theme.color.surface.base,
                alignItems: 'center',
                justifyContent: 'center',
                transform: [
                  {
                    translateX: offset.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, TRACK.width - THUMB - (TRACK.height - THUMB)],
                    }),
                  },
                ],
              }}
            >
              {loading ? <Spinner size="sm" testID={`${testID}-spinner`} /> : null}
            </Animated.View>
          </View>
          {focused ? (
            <View
              pointerEvents="none"
              testID={`${testID}-focus-ring`}
              style={focusRing(theme, { radius: tokens.radius.full })}
            />
          ) : null}
        </Pressable>
      </View>
    </View>
  );
}
