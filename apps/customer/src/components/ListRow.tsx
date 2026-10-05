/**
 * The Account canvas's list rows (Claude Design "Proposed component: ListRow"): a 64 px row with a
 * 36 px icon slot, a title and a subline, and a chevron when the row opens something. Rows sit in
 * one outlined card per group, split by hairlines, under a small group label.
 *
 * Proposed, not yet in the design system, so it lives in this app until the owner approves it
 * (Account canvas, "Proposed components" note). Built only from `@hg/ui-native` parts.
 */
import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, Icon, Skeleton, tokens, useTheme, useTypeStyle } from '@hg/ui-native';
import type { IconName } from '@hg/ui-native';

export function ListGroup({
  label,
  children,
  testID,
}: {
  label?: string;
  children: React.ReactNode;
  testID?: string;
}): React.ReactElement {
  const theme = useTheme();
  const labelType = useTypeStyle('label.md');
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={{ gap: tokens.space['2'] }} testID={testID}>
      {label ? (
        <Text
          accessibilityRole="header"
          style={[labelType, { color: theme.color.text.secondary, paddingHorizontal: tokens.space['1'] }]}
        >
          {label}
        </Text>
      ) : null}
      <Card
        variant="outlined"
        padding={0}
        style={{ backgroundColor: theme.color.surface.raised, overflow: 'hidden' }}
      >
        {rows.map((row, i) => (
          <React.Fragment key={i}>
            {i > 0 ? (
              <View
                style={{
                  height: StyleSheet.hairlineWidth,
                  backgroundColor: theme.color.border.decorative,
                }}
              />
            ) : null}
            {row}
          </React.Fragment>
        ))}
      </Card>
    </View>
  );
}

export interface ListRowProps {
  title: string;
  /** The second line. `null` draws a skeleton bar while it loads. */
  subtitle?: string | null;
  /** Empty slot when the design system has no icon for the row — never a borrowed glyph. */
  icon?: IconName;
  onPress?: () => void;
  /** Replaces the chevron, e.g. a Badge. */
  trailing?: React.ReactNode;
  accessibilityLabel?: string;
  testID?: string;
}

export function ListRow({
  title,
  subtitle,
  icon,
  onPress,
  trailing,
  accessibilityLabel,
  testID,
}: ListRowProps): React.ReactElement {
  const theme = useTheme();
  const titleType = useTypeStyle('label.lg');
  const subType = useTypeStyle('body.sm');
  const [focused, setFocused] = React.useState(false);

  const content = (pressed: boolean): React.ReactElement => (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.space['3'],
        minHeight: theme.density.rowHeight,
        paddingVertical: tokens.space['2'],
        paddingHorizontal: tokens.space['4'],
        backgroundColor: pressed ? theme.color.state.pressedOverlay : 'transparent',
      }}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: 36,
          height: 36,
          borderRadius: tokens.radius.md,
          backgroundColor: theme.color.surface.sunken,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon ? <Icon name={icon} size={20} color={theme.color.text.secondary} /> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={[titleType, { color: theme.color.text.primary }]}>{title}</Text>
        {subtitle === null ? (
          <View accessibilityLabel="Loading" style={{ width: '45%', marginTop: 4 }}>
            <Skeleton variant="text" height={12} animated={false} />
          </View>
        ) : subtitle ? (
          <Text style={[subType, { color: theme.color.text.secondary }]}>{subtitle}</Text>
        ) : null}
      </View>
      {trailing ??
        (onPress ? (
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Icon name="chevron-right" size={20} color={theme.color.text.secondary} />
          </View>
        ) : null)}
    </View>
  );

  if (!onPress) {
    return (
      <View testID={testID} accessible accessibilityLabel={accessibilityLabel}>
        {content(false)}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (subtitle ? `${title}, ${subtitle}` : title)}
    >
      {({ pressed }) => (
        <>
          {content(pressed)}
          {focused ? (
            <View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, { borderWidth: 3, borderColor: theme.color.focus.ring }]}
            />
          ) : null}
        </>
      )}
    </Pressable>
  );
}
