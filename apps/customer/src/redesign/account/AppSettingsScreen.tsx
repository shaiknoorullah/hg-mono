/**
 * App settings (boards `AC/AppSettings`, `-notasked`, `-off`, `-focus`, `-dark`, `-360`, `-lt`).
 * Nothing here calls the API, so the screen has no error state of its own:
 *
 * - Location is the phone's permission (`locationPermission.ts`). It only starts the address map
 *   where the customer is; the pin can always be dragged. Three states: allowed ("Open phone
 *   settings" to change it), not asked yet ("Turn on location" asks, while using the app only), and
 *   off (the only way back is the phone's settings, so the button opens them). While the permission
 *   is being read a skeleton stands in for the row.
 * - Appearance follows the phone's light or dark setting; there is no in-app choice (owner
 *   decision, the board's note). It is a sentence, not a control.
 * - Notification settings is a row to its own screen.
 *
 * Reached from Account, "Notifications and privacy". Light and dark, 360 dp and enlarged text are
 * the same screen drawn with the theme and the phone's settings; `focus` is the primary button
 * focused, which is the first button the keyboard reaches.
 */
import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppBar, Button, Card, Icon, Skeleton, radius, space, useTheme, useTypeStyle } from '../ds';
import { useNav } from '../navigation/context';
import { openLocationSettings, useLocationState, type LocationState } from './locationPermission';
import { SettingsRow } from './SettingsRow';

/** The page's words, as the boards write them. */
export const APP_SETTINGS_COPY = {
  title: 'App settings',
  location: 'Location',
  locationBody:
    "We use your phone's location to start the map where you are when you add an address. You can always search or drag the pin instead. Restaurants near you come from your delivery address.",
  rowTitle: 'Location for HalalGoes',
  offNote: 'Without location you can still add an address: search for it or drag the pin on the map.',
  appearance: 'Appearance',
  appearanceBody: "HalalGoes follows your phone's light or dark setting.",
  notifications: 'Notifications',
} as const;

/** What the location row says and which button goes with it, for each permission state. */
export const LOCATION_ROW: Record<LocationState, { sub: string; action: string; variant: 'primary' | 'tertiary' }> = {
  allowed: { sub: 'Allowed while using the app', action: 'Open phone settings', variant: 'tertiary' },
  notAsked: { sub: 'Not asked yet', action: 'Turn on location', variant: 'primary' },
  denied: { sub: 'Turned off in your phone settings', action: 'Open phone settings', variant: 'primary' },
};

/** App settings: location permission, appearance, and the way to Notification settings. */
export function AppSettingsScreen(): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const body = useTypeStyle('body.md');
  const small = useTypeStyle('body.sm');
  const heading = useTypeStyle('heading.md');
  const label = useTypeStyle('label.lg');
  const location = useLocationState();
  const [asking, setAsking] = React.useState(false);

  const row = location.state ? LOCATION_ROW[location.state] : null;

  async function ask(): Promise<void> {
    setAsking(true);
    try {
      await location.turnOn();
    } finally {
      setAsking(false);
    }
  }

  return (
    <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="AppSettingsScreen">
      <AppBar title={APP_SETTINGS_COPY.title} tone="cream" back={{ onPress: nav.back, previousTitle: 'Account' }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingHorizontal: theme.density.gutter }]}>
        <View style={styles.section}>
          <Text accessibilityRole="header" aria-level={2} style={[heading, { color: theme.color.text.primary }]}>
            {APP_SETTINGS_COPY.location}
          </Text>
          <Text style={[small, { color: theme.color.text.secondary }]}>{APP_SETTINGS_COPY.locationBody}</Text>
          {row ? (
            <>
              <Card variant="outlined" radius={radius.lg} testID="AppSettings-location">
                <View style={styles.locationRow}>
                  <View style={[styles.tile, { backgroundColor: theme.color.surface.sunken, borderRadius: radius.md }]}>
                    <Icon name="map" size={20} color={theme.color.text.secondary} />
                  </View>
                  <View style={styles.grow}>
                    <Text style={[label, { color: theme.color.text.primary }]}>{APP_SETTINGS_COPY.rowTitle}</Text>
                    <Text style={[small, { color: theme.color.text.secondary }]} testID="AppSettings-locationState">
                      {row.sub}
                    </Text>
                  </View>
                </View>
              </Card>
              {location.state !== 'allowed' ? (
                <Text style={[small, { color: theme.color.text.secondary }]} testID="AppSettings-locationOff">
                  {APP_SETTINGS_COPY.offNote}
                </Text>
              ) : null}
              <Button
                variant={row.variant}
                size="lg"
                fullWidth
                loading={asking}
                onPress={location.state === 'notAsked' ? ask : openLocationSettings}
                testID={location.state === 'notAsked' ? 'AppSettings-turnOn' : 'AppSettings-openSettings'}
              >
                {row.action}
              </Button>
            </>
          ) : (
            <View accessibilityRole="progressbar" accessibilityLabel="Reading the location setting" aria-busy testID="AppSettings-loading">
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.section}>
                <Skeleton variant="rect" height={64} />
                <Skeleton variant="rect" height={48} />
              </View>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text accessibilityRole="header" aria-level={2} style={[heading, { color: theme.color.text.primary }]}>
            {APP_SETTINGS_COPY.appearance}
          </Text>
          <Card variant="outlined" radius={radius.lg} testID="AppSettings-appearance">
            <Text style={[body, { color: theme.color.text.primary }]}>{APP_SETTINGS_COPY.appearanceBody}</Text>
          </Card>
        </View>

        <View style={styles.section}>
          <Text accessibilityRole="header" aria-level={2} style={[heading, { color: theme.color.text.primary }]}>
            {APP_SETTINGS_COPY.notifications}
          </Text>
          <Card variant="outlined" padding={0} radius={radius.lg}>
            <SettingsRow
              title="Notification settings"
              icon="bell"
              subline="Push and email"
              onPress={() => nav.push({ name: 'notificationSettings' })}
              testID="AppSettings-notificationSettings"
            />
          </Card>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingTop: space['2'], paddingBottom: space['6'], flexGrow: 1, gap: space['6'] },
  section: { gap: space['3'] },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: space['3'] },
  tile: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, minWidth: 0, gap: 2 },
});
