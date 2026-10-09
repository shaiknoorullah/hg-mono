/**
 * R16 resume strip: above the BottomNav on Earnings and Account while a delivery is in hand
 * (SH/EarningsTabResume, AccountTabResume, ResumeStripDropoff). Home has its own "Resume
 * delivery" button, so the strip never shows there; the shell hides accessories during a flow.
 */
import * as React from 'react';
import { Text, View } from 'react-native';

import { Button, Card, space, typeStyle, useTheme } from '../ds';
import { useNav } from '../nav/Navigator';
import { useRiderDashboard } from './dashboard';
import { stepLine } from './step';

export function ResumeStrip(): React.ReactElement | null {
  const nav = useNav();
  const dash = useRiderDashboard();
  const theme = useTheme();
  const assignment = dash.assignment;
  if (nav.tab === 'home' || nav.flow || !assignment) return null;
  const line = stepLine(assignment);
  return (
    // ds-request(native): ActiveDeliveryBar — SH/EarningsTabResume, AccountTabResume, ResumeStripDropoff (#197)
    <View style={{ paddingHorizontal: space['3'], paddingBottom: space['2'], backgroundColor: theme.color.surface.base }}>
      <Card variant="filled" testID="resume-strip">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['3'] }}>
          <View style={{ flex: 1, gap: space['1'] }} accessible accessibilityLabel={`On a delivery. ${line.strip}`}>
            <Text style={[typeStyle(theme, 'label.md'), { color: theme.color.text.secondary }]}>On a delivery</Text>
            <Text numberOfLines={2} style={[typeStyle(theme, 'label.lg'), { color: theme.color.text.primary }]}>
              {line.strip}
            </Text>
          </View>
          <Button variant="primary" size="xl" onPress={() => nav.openFlow('trip', { assignmentId: assignment.id })}>
            Resume
          </Button>
        </View>
      </Card>
    </View>
  );
}
