/**
 * `Banner` — 02-components.md §37.
 *
 * A persistent, non-blocking inline message attached to a region. Its job in this product is to
 * say that a live surface is degraded **without** taking the surface away: "Location updating…" on
 * the tracking map, "Reconnecting — updates may be delayed" on the timeline, "Tracking isn't
 * reporting" on the rider dashboard (D-18), "Your cart is from a different restaurant" (C-20).
 *
 * There is no `success` variant. A green fill outside `color.halal.*` is RULE H-1 / lint L-4, and
 * a banner announcing success is a `Toast`.
 */
import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { ReactNode } from 'react';
import type { ViewStyle } from 'react-native';

import { useTheme, type, toneOf, radius, icon, type Tone } from './internal/theme';
import { renderAction, type ActionSpec } from './internal/primitives';
import { BangGlyph, CloseGlyph, InfoGlyph } from './internal/glyphs';

export type BannerVariant = Tone;

export interface BannerProps {
  variant?: BannerVariant;
  title: string;
  description?: string;
  /**
   * A banner that carries an action is the one-tap remediation path — D-18 requires the
   * tracking-unhealthy banner to deep-link straight to permissions/battery settings.
   */
  action?: ActionSpec;
  dismissible?: boolean;
  onDismiss?: () => void;
  /**
   * 02-components.md §37: "A dismissible banner that reports an ongoing condition must reappear if
   * the condition persists across sessions." Pass the condition here — when it flips back to true
   * after having been dismissed, the banner comes back. Omit it for one-shot notices.
   */
  conditionActive?: boolean;
  /** Overrides the variant's glyph. Never the sole carrier of the severity. */
  icon?: ReactNode;
  style?: ViewStyle;
  testID?: string;
}

export function Banner({
  variant = 'info',
  title,
  description,
  action,
  dismissible = false,
  onDismiss,
  conditionActive,
  icon: iconNode,
  style,
  testID = 'Banner',
}: BannerProps) {
  const theme = useTheme();
  const tone = toneOf(theme, variant);
  const [dismissed, setDismissed] = useState(false);

  // Re-arm when the underlying condition clears and returns.
  useEffect(() => {
    if (conditionActive === false) setDismissed(false);
  }, [conditionActive]);

  if (dismissed) return null;

  const assertive = variant === 'danger';

  return (
    <View
      testID={testID}
      accessibilityRole={assertive ? 'alert' : 'summary'}
      accessibilityLiveRegion={assertive ? 'assertive' : 'polite'}
      style={[
        styles.root,
        {
          gap: theme.target.spacing * 1.5,
          padding: theme.density.cardPadding,
          backgroundColor: tone.tint,
          borderColor: tone.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: radius.md,
          minHeight: theme.target.min,
        },
        style,
      ]}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ paddingTop: 2 }}
      >
        {iconNode ??
          (variant === 'info' || variant === 'neutral' ? (
            <InfoGlyph size={icon.lg} color={tone.glyph} />
          ) : (
            <BangGlyph size={icon.lg} color={tone.glyph} />
          ))}
      </View>

      <View style={styles.body}>
        <Text style={[type(theme, 'label.lg'), { color: theme.color.text.primary }]}>{title}</Text>
        {description ? (
          <Text style={[type(theme, 'body.sm'), { color: theme.color.text.secondary }]}>
            {description}
          </Text>
        ) : null}
        {action ? (
          <View style={{ marginTop: theme.target.spacing, alignSelf: 'flex-start' }}>
            {renderAction(action, { variant: 'tertiary', size: 'sm' })}
          </View>
        ) : null}
      </View>

      {dismissible ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Dismiss: ${title}`}
          hitSlop={theme.target.spacing}
          onPress={() => {
            setDismissed(true);
            onDismiss?.();
          }}
          style={{
            width: theme.target.min,
            height: theme.target.min,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          testID={`${testID}-dismiss`}
        >
          <CloseGlyph size={icon.md} color={theme.color.text.secondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'flex-start', alignSelf: 'stretch' },
  body: { flex: 1, flexShrink: 1 },
});
