/**
 * `Tabs` — 02-components.md §29.
 *
 * In-page section switching: menu categories (C-13), restaurant queue columns on narrow screens,
 * detail sections. Variants `underline` (default) and `pill`, either of which can be `scrollable`.
 *
 * Behaviours that are requirements rather than polish:
 *  - The active tab **auto-scrolls into view without stealing focus** — a scroll is not a focus
 *    move, and moving focus on a data refresh is banned (04-accessibility.md §4.2).
 *  - `includeAllTab` prepends the implicit "All" tab that C-13 R2 requires on menu categories, so
 *    every menu screen gets it without each one remembering to.
 *  - Loading renders skeleton pills, not an empty rail that reflows when the categories arrive.
 */
import { useEffect, useRef } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import type { ViewStyle } from 'react-native';

import { useTheme, type, toneOf, radius } from '../feedback/internal/theme';
import { Skeleton } from '../feedback/internal/primitives';

export type TabsVariant = 'underline' | 'pill';

export interface TabSpec {
  key: string;
  label: string;
  /** Folded into the tab's accessible name, never a separate node. */
  badge?: number;
  disabled?: boolean;
  disabledReason?: string;
  testID?: string;
}

export interface TabsProps {
  tabs: readonly TabSpec[];
  value: string;
  onChange: (key: string) => void;
  variant?: TabsVariant;
  scrollable?: boolean;
  /** C-13 R2: the "All" tab is implicit and first on menu categories. */
  includeAllTab?: boolean;
  allTabLabel?: string;
  allTabKey?: string;
  /** Skeleton pills in the real geometry. */
  loading?: boolean;
  /** Number of skeleton pills while loading. Defaults to the tab count, or 4 when unknown. */
  loadingCount?: number;
  /** Names the tab set for assistive technology, e.g. "Menu categories". */
  accessibilityLabel?: string;
  style?: ViewStyle;
  testID?: string;
}

export function Tabs({
  tabs,
  value,
  onChange,
  variant = 'underline',
  scrollable = false,
  includeAllTab = false,
  allTabLabel = 'All',
  allTabKey = '__all__',
  loading = false,
  loadingCount,
  accessibilityLabel,
  style,
  testID = 'Tabs',
}: TabsProps) {
  const theme = useTheme();
  const brand = toneOf(theme, 'brand');
  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<Record<string, number>>({});

  const resolved: readonly TabSpec[] = includeAllTab
    ? [{ key: allTabKey, label: allTabLabel }, ...tabs]
    : tabs;

  /* Scroll the active tab into view. Deliberately a scroll and not a focus move. */
  useEffect(() => {
    if (!scrollable) return;
    const x = offsets.current[value];
    if (x == null || !scrollRef.current) return;
    scrollRef.current.scrollTo({ x: Math.max(0, x - 24), animated: true });
  }, [value, scrollable]);

  if (loading) {
    const n = loadingCount ?? (resolved.length || 4);
    return (
      <View
        testID={`${testID}-loading`}
        aria-busy
        accessibilityLabel="Loading sections"
        style={[styles.rail, { gap: theme.target.spacing, paddingHorizontal: theme.density.gutter }, style]}
      >
        {Array.from({ length: n }, (_, i) => (
          <Skeleton key={i} variant="rect" width={88} height={32} />
        ))}
      </View>
    );
  }

  const content = resolved.map((tab) => {
    const selected = tab.key === value;
    const disabled = tab.disabled ?? false;
    const pill = variant === 'pill';

    return (
      <Pressable
        key={tab.key}
        accessibilityRole="tab"
        accessibilityState={{ selected, disabled }}
        accessibilityLabel={
          `${tab.label}${tab.badge ? `, ${tab.badge}` : ''}` +
          (disabled && tab.disabledReason ? `, ${tab.disabledReason}` : '')
        }
        onPress={disabled ? undefined : () => onChange(tab.key)}
        onLayout={(e) => {
          offsets.current[tab.key] = e.nativeEvent.layout.x;
        }}
        testID={tab.testID ?? `${testID}-tab-${tab.key}`}
        style={({ pressed }) => [
          styles.tab,
          {
            minHeight: theme.target.min,
            paddingHorizontal: theme.density.gutter,
            opacity: disabled ? theme.color.state.disabledOpacity : 1,
            backgroundColor: pill
              ? selected
                ? brand.tint
                : pressed
                  ? theme.color.state.pressedOverlay
                  : theme.color.surface.subtle
              : pressed
                ? theme.color.state.pressedOverlay
                : 'transparent',
            borderRadius: pill ? radius.full : 0,
            borderBottomWidth: pill ? 0 : 2,
            borderColor: pill ? 'transparent' : selected ? brand.solid : 'transparent',
          },
        ]}
      >
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={1.6}
          style={[
            type(theme, 'label.lg'),
            { color: selected ? theme.color.text.primary : theme.color.text.secondary },
          ]}
        >
          {tab.label}
        </Text>
      </Pressable>
    );
  });

  if (!scrollable) {
    return (
      <View
        testID={testID}
        accessibilityRole="tablist"
        accessibilityLabel={accessibilityLabel}
        style={[
          styles.rail,
          { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.color.border.decorative },
          style,
        ]}
      >
        {content}
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      testID={testID}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.rail, { paddingHorizontal: theme.target.spacing }]}
      style={[
        { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.color.border.decorative },
        style,
      ]}
    >
      {content}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  rail: { flexDirection: 'row', alignItems: 'stretch' },
  tab: { alignItems: 'center', justifyContent: 'center' },
});
