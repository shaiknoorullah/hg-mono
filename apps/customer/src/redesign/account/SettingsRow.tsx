/**
 * The row the account pages share: 64 px, an icon tile, a title, an optional subline, a chevron
 * (boards `AC/Account`, `AC/AppSettings`). The design system has no ListRow yet (the boards mark
 * it "Proposed component"), so it is composed here from `Card`, `Icon` and `Text` and not
 * exported from the app. When `ListRow` lands in the design system this file is deleted.
 *
 * The whole row is one press target named "title, subline". An icon the design system does not
 * have (card, receipt, phone, gift, document, settings) leaves the tile empty: a borrowed glyph
 * would say the wrong thing (board note "empty slot, not borrowed glyph").
 */
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card, Icon, Skeleton, radius, space, useTheme, useTypeStyle, type Theme } from '../ds';

type IconName = React.ComponentProps<typeof Icon>['name'];

export interface SettingsRowProps {
  title: string;
  subline?: string | null;
  /** The subline is still loading: a skeleton bar stands in and the row stays pressable. */
  sublineLoading?: boolean;
  icon?: IconName;
  onPress?: () => void;
  testID?: string;
}

export function SettingsRow({ title, subline, sublineLoading, icon, onPress, testID }: SettingsRowProps): React.ReactElement {
  const theme = useTheme();
  const label = useTypeStyle('label.lg');
  const small = useTypeStyle('body.sm');
  const name = [title, sublineLoading ? 'loading' : subline].filter(Boolean).join(', ');
  return (
    <Card
      variant="outlined"
      padding={0}
      radius={0}
      onPress={onPress}
      accessibilityLabel={name}
      style={styles.card}
      contentStyle={styles.content}
      testID={testID}
    >
      <View style={[styles.tile, { backgroundColor: theme.color.surface.sunken, borderRadius: radius.md }]}>
        {icon ? <Icon name={icon} size={20} color={theme.color.text.secondary} /> : null}
      </View>
      <View style={styles.text}>
        <Text style={[label, { color: theme.color.text.primary }]}>{title}</Text>
        {sublineLoading ? (
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Skeleton variant="text" width="45%" height={12} />
          </View>
        ) : subline ? (
          <Text style={[small, { color: theme.color.text.secondary }]}>{subline}</Text>
        ) : null}
      </View>
      <Icon name="chevron-right" size={20} color={theme.color.text.secondary} />
    </Card>
  );
}

/** A titled group of rows in one outlined card, a hairline between them. */
export function SettingsGroup({
  title,
  children,
  testID,
}: {
  title: string;
  children: React.ReactNode;
  testID?: string;
}): React.ReactElement {
  const theme = useTheme();
  const heading = useTypeStyle('label.md');
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.group} testID={testID}>
      <Text accessibilityRole="header" aria-level={2} style={[heading, { color: theme.color.text.secondary }]}>
        {title}
      </Text>
      <Card variant="outlined" padding={0} radius={radius.lg}>
        {rows.map((row, i) => (
          <React.Fragment key={i}>
            {i > 0 ? <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.color.border.decorative }} /> : null}
            {row}
          </React.Fragment>
        ))}
      </Card>
    </View>
  );
}

export type { Theme };

const styles = StyleSheet.create({
  card: { borderWidth: 0, borderRadius: 0, backgroundColor: 'transparent' },
  content: { flexDirection: 'row', alignItems: 'center', gap: space['3'], minHeight: 64, paddingHorizontal: space['4'], paddingVertical: space['2'] },
  tile: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0, gap: 2 },
  group: { gap: space['2'] },
});
