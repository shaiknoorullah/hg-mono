/**
 * `Toast` — a transient message.
 *
 * **Never the sole carrier of an error that blocks a task** — that belongs inline, next to
 * the thing that failed. A toast is for the outcome of something that already happened.
 *
 * `success` is a tint with a `success.icon` glyph and **no green fill** (RULE H-1).
 * `danger` is persistent by default: an auto-dismissing failure is a failure the user never
 * read. The timer also pauses whenever a screen reader is running or the toast has focus,
 * because a message that vanishes mid-read is inaccessible.
 */
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, Text, View } from 'react-native';
import type { ReactNode } from 'react';

import { elevationStyle, feedbackRole, tokens, useDuration, useTheme, useTypeStyle } from '../tokens';
import { hitSlopFor } from './internal/interaction';

export type ToastVariant = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface ToastProps {
  variant?: ToastVariant;
  title: string;
  description?: string;
  action?: { label: string; onPress: () => void };
  /** ms. `danger` and any toast carrying an action default to persistent. */
  duration?: number | null;
  onDismiss?: () => void;
  icon?: ReactNode;
  testID?: string;
}

const DEFAULT_DURATION = 5000;

export function Toast({
  variant = 'neutral',
  title,
  description,
  action,
  duration,
  onDismiss,
  icon,
  testID = 'Toast',
}: ToastProps) {
  const theme = useTheme();
  const headingType = useTypeStyle('heading.sm');
  const bodyType = useTypeStyle('body.sm');
  const labelType = useTypeStyle('label.md');
  const enterDuration = useDuration('moderate');
  const opacity = useRef(new Animated.Value(0)).current;
  const [screenReader, setScreenReader] = useState(false);
  const [paused, setPaused] = useState(false);

  const persistent =
    duration === null || (duration === undefined && (variant === 'danger' || Boolean(action)));
  const timeout = duration ?? DEFAULT_DURATION;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: enterDuration,
      useNativeDriver: true,
    }).start();
  }, [enterDuration, opacity]);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isScreenReaderEnabled?.().then((v) => {
      if (alive) setScreenReader(Boolean(v));
    });
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', (v) =>
      setScreenReader(Boolean(v)),
    );
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);

  useEffect(() => {
    if (persistent || paused || screenReader || !onDismiss) return;
    const id = setTimeout(onDismiss, timeout);
    return () => clearTimeout(id);
  }, [persistent, paused, screenReader, timeout, onDismiss]);

  const feedback = variant === 'neutral' ? null : feedbackRole(theme, variant);

  return (
    <Animated.View
      testID={testID}
      accessible
      // Assertive only for danger: everything else is an outcome, not an interruption.
      accessibilityRole={variant === 'danger' ? 'alert' : 'text'}
      accessibilityLiveRegion={variant === 'danger' ? 'assertive' : 'polite'}
      accessibilityLabel={[title, description].filter(Boolean).join('. ')}
      onAccessibilityEscape={onDismiss}
      style={{
        opacity,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: tokens.space['3'],
        padding: tokens.space['3'],
        borderRadius: tokens.radius.md,
        borderWidth: 1,
        borderColor: feedback ? feedback.border : theme.color.border.decorative,
        backgroundColor: feedback ? feedback.tint : theme.color.surface.raised,
        ...elevationStyle(theme, '3'),
      }}
    >
      {icon ?? (
        <View
          testID={`${testID}-icon`}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            width: tokens.icon.md,
            height: tokens.icon.md,
            borderRadius: tokens.radius.full,
            marginTop: tokens.space['1'],
            backgroundColor: feedback ? feedback.icon : theme.color.text.tertiary,
          }}
        />
      )}

      <View style={{ flexShrink: 1, gap: tokens.space['1'] }}>
        <Text
          style={{ ...headingType, color: feedback ? feedback.tintText : theme.color.text.primary }}
        >
          {title}
        </Text>
        {description ? (
          <Text
            style={{
              ...bodyType,
              color: feedback ? feedback.tintText : theme.color.text.secondary,
            }}
          >
            {description}
          </Text>
        ) : null}
        {action ? (
          <Pressable
            testID={`${testID}-action`}
            onPress={action.onPress}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            hitSlop={hitSlopFor(0, theme.target.min)}
            style={{ paddingVertical: tokens.space['2'] }}
          >
            <Text style={{ ...labelType, color: theme.color.text.link }}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>

      {onDismiss ? (
        <Pressable
          testID={`${testID}-dismiss`}
          onPress={onDismiss}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          // A real target, not a 12px glyph.
          style={{
            marginStart: 'auto',
            minWidth: theme.target.min,
            minHeight: theme.target.min,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ ...labelType, color: theme.color.text.tertiary }}>{'✕'}</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}
