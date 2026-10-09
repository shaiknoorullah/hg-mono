/**
 * The Home header from the approved canvas: "Deliver to" over the chosen address, with a
 * chevron, as one 48 dp target that opens the address book (or, with no address yet, the
 * address form). It is the page heading, so it reads as one sentence to a screen reader.
 */
import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, useTheme, useTypeStyle } from '@hg/ui-native';
import type { Schema } from '@hg/api-client';

type Address = Schema['Address'];

/** "Home · 88 Harbour Street", or just the street when the address has no label. */
export function addressTitle(a: Pick<Address, 'label' | 'line1'>): string {
  return a.label ? `${a.label} · ${a.line1}` : a.line1;
}

export function DeliverToHeader({
  address,
  loading,
  onPress,
}: {
  address: Address | null;
  loading: boolean;
  onPress: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const eyebrow = useTypeStyle('label.md');
  const title = useTypeStyle('heading.sm');
  const text = loading ? 'Finding your address…' : address ? addressTitle(address) : 'Set an address';
  return (
    <View style={[styles.bar, { backgroundColor: theme.color.surface.base }]}>
      <Pressable
        testID="DeliverToHeader"
        onPress={onPress}
        disabled={loading}
        accessibilityRole="header"
        accessibilityLabel={
          address ? `Deliver to ${addressTitle(address)}. Change address` : 'No delivery address yet. Set an address'
        }
        style={({ pressed }) => [styles.target, pressed ? { opacity: 0.7 } : null]}
      >
        <Text style={[eyebrow, { color: theme.color.text.secondary }]}>Deliver to</Text>
        <View style={styles.titleRow}>
          <Text numberOfLines={1} style={[title, styles.shrink, { color: theme.color.text.primary }]}>
            {text}
          </Text>
          <Icon name="chevron-down" size={16} color={theme.color.text.primary} />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: 16, paddingVertical: 8 },
  target: { minHeight: 48, justifyContent: 'center', gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  shrink: { flexShrink: 1 },
});
