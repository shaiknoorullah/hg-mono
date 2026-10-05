/**
 * `InlineAlert` — the canvas's bordered notice: raised surface, interactive border, a glyph in
 * secondary text, a bold title and a body line, and optionally one action.
 *
 * Deliberately neutral. It carries "your address is missing", "this dish just sold out" and
 * "the kitchen just closed" — none of them is the customer's fault and none is a halal ruling,
 * so nothing here is red (invariant 9 in AGENTS.md is about halal states, but a red block next
 * to a halal badge reads the same way).
 */
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Button, Icon, useTheme, useTypeStyle } from '@hg/ui-native';
import type { IconName } from '@hg/ui-native';

export interface InlineAlertProps {
  icon?: IconName;
  title: string;
  body?: string;
  /** `alert` interrupts (an add that failed); `status` waits (a standing prompt). */
  role?: 'alert' | 'status';
  action?: { label: string; onPress: () => void; icon?: IconName; testID?: string };
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function InlineAlert({
  icon = 'warning',
  title,
  body,
  role = 'alert',
  action,
  style,
  testID = 'InlineAlert',
}: InlineAlertProps): React.ReactElement {
  const theme = useTheme();
  const titleType = useTypeStyle('label.lg');
  const bodyType = useTypeStyle('body.sm');
  return (
    <View
      testID={testID}
      accessibilityRole={role === 'alert' ? 'alert' : 'summary'}
      accessibilityLiveRegion={role === 'alert' ? 'assertive' : 'polite'}
      style={[
        styles.root,
        { backgroundColor: theme.color.surface.raised, borderColor: theme.color.border.interactive },
        style,
      ]}
    >
      <Icon name={icon} size={24} color={theme.color.text.secondary} />
      <View style={styles.body}>
        <Text style={[titleType, { color: theme.color.text.primary }]}>{title}</Text>
        {body ? <Text style={[bodyType, { color: theme.color.text.primary }]}>{body}</Text> : null}
        {action ? (
          <View style={styles.action}>
            <Button
              variant="primary"
              size="md"
              onPress={action.onPress}
              iconStart={
                action.icon ? (
                  <Icon name={action.icon} size={20} color={theme.color.text.onBrand} />
                ) : undefined
              }
              testID={action.testID}
            >
              {action.label}
            </Button>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  body: { flex: 1, gap: 8 },
  action: { alignSelf: 'flex-start', marginTop: 4 },
});
