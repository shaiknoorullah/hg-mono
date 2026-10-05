/**
 * The small pieces the cart, checkout, tracking and orders screens draw the same way, as the
 * approved Cart & Checkout and Track & After canvases draw them:
 *
 * - `Notice`: the neutral status box (raised surface, interactive border, ink text). Every
 *   blocking or informational message in these flows uses it. It is never red: a refused quote
 *   is not the customer's fault, and red reads as haram on this platform (AGENTS.md invariant 9).
 * - `MoneyRow`: one label and one server amount. A missing or non-integer amount renders as an
 *   em dash, never as a throw and never as a guess.
 * - `SectionCard`: the outlined, large-radius card with an optional heading.
 * - `ItemRow`: "2× Chicken shawarma wrap / options / request ......... $24.98".
 */
import * as React from 'react';
import { Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Card, Icon, Price, Skeleton, useTheme, useTypeStyle } from '@hg/ui-native';
import type { IconName } from '@hg/ui-native';

import { safeCents } from '../ordering/lines';

export function Notice({
  title,
  body,
  icon,
  testID = 'Notice',
  children,
}: {
  title: string;
  body?: string | null;
  icon?: IconName;
  testID?: string;
  children?: React.ReactNode;
}): React.ReactElement {
  const theme = useTheme();
  const titleStyle = useTypeStyle('label.lg');
  const bodyStyle = useTypeStyle('body.sm');
  return (
    <View
      testID={testID}
      accessibilityRole="summary"
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: 'row',
        gap: 12,
        alignItems: 'flex-start',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 12,
        backgroundColor: theme.color.surface.raised,
        borderWidth: 1,
        borderColor: theme.color.border.interactive,
      }}
    >
      {icon ? <Icon name={icon} size={20} color={theme.color.text.secondary} /> : null}
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[titleStyle, { color: theme.color.text.primary }]}>{title}</Text>
        {body ? <Text style={[bodyStyle, { color: theme.color.text.primary }]}>{body}</Text> : null}
        {children}
      </View>
    </View>
  );
}

export function SectionCard({
  title,
  children,
  testID,
  style,
}: {
  title?: string;
  children: React.ReactNode;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const theme = useTheme();
  const heading = useTypeStyle('heading.md');
  return (
    <Card variant="outlined" padding={16} testID={testID} style={style}>
      <View style={{ gap: 8 }}>
        {title ? (
          <Text accessibilityRole="header" style={[heading, { color: theme.color.text.primary }]}>
            {title}
          </Text>
        ) : null}
        {children}
      </View>
    </Card>
  );
}

export function MoneyRow({
  label,
  value,
  total = false,
  loading = false,
  free,
  sign,
  testID,
}: {
  label: string;
  value: unknown;
  total?: boolean;
  loading?: boolean;
  free?: string;
  sign?: 'auto' | 'always' | 'never';
  testID?: string;
}): React.ReactElement {
  const theme = useTheme();
  const rowStyle = useTypeStyle('body.md');
  const totalStyle = useTypeStyle('heading.md');
  const amount = safeCents(value);
  return (
    <View
      testID={testID}
      style={[
        {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 8,
        },
        total
          ? {
              paddingTop: 8,
              borderTopWidth: 1,
              borderTopColor: theme.color.border.decorative,
            }
          : null,
      ]}
    >
      <Text
        style={
          total
            ? [totalStyle, { color: theme.color.text.primary }]
            : [rowStyle, { color: theme.color.text.secondary }]
        }
      >
        {label}
      </Text>
      {loading ? (
        <Skeleton variant="text" width={total ? 88 : 56} height={total ? 24 : 16} />
      ) : amount === null ? (
        <Text style={[rowStyle, { color: theme.color.text.secondary }]}>—</Text>
      ) : (
        <Price cents={amount} size={total ? 'lg' : 'sm'} free={free} sign={sign} />
      )}
    </View>
  );
}

export function ItemRow({
  quantity,
  name,
  options,
  request,
  amount,
  loading = false,
}: {
  quantity: number;
  name: string;
  options?: string | null;
  request?: string | null;
  amount: unknown;
  loading?: boolean;
}): React.ReactElement {
  const theme = useTheme();
  const body = useTypeStyle('body.md');
  const small = useTypeStyle('body.sm');
  const value = safeCents(amount);
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
      <Text style={[body, { width: 28, color: theme.color.text.secondary }]}>{`${quantity}×`}</Text>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[body, { color: theme.color.text.primary }]}>{name}</Text>
        {options ? (
          <Text style={[small, { color: theme.color.text.secondary }]}>{options}</Text>
        ) : null}
        {request ? (
          <Text style={[small, { color: theme.color.text.secondary, fontStyle: 'italic' }]}>
            {request}
          </Text>
        ) : null}
      </View>
      {loading ? (
        <Skeleton variant="text" width={48} height={16} />
      ) : value === null ? null : (
        <Price cents={value} size="sm" />
      )}
    </View>
  );
}
