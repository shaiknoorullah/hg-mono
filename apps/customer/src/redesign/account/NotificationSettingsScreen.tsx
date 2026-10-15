/**
 * A5 Notification settings (boards `AC/NotificationSettings` and every `-on`, `-off`, `-saving`,
 * `-turningoff`, `-error`, `-offline`, `-noemail`, `-unconfirmed`, `-notasked`, `-denied`,
 * `-loading`, `-loaderror`, `-dark`, `-360`, `-lt`).
 *
 * Two independent things:
 *
 * - Order updates by push. The server stores no push preference; this is the phone's permission
 *   (`pushPermission.ts`): allowed (turn it off in the phone's settings), not asked yet ("Turn on
 *   notifications" asks and registers the device), or denied (a banner and "Open phone settings").
 *   Order updates always show on the order's tracking screen too, and the page says so.
 * - News and offers by email: `marketing_consent` through `updateCustomerProfile`. The switch
 *   keeps its old position until the server confirms (`loading` while it saves), and a failed save
 *   leaves it where it was with a banner. Consent is recorded before the email is confirmed;
 *   nothing is sent until it is (the line under the switch says which applies). With no email on
 *   the account the switch is off and disabled, and "Add an email" opens the details sheet.
 *
 * The reason a control is disabled is its own paragraph beside it, not the switch description
 * (that text is tertiary inside the disabled opacity and fails contrast).
 *
 * Not drawn, so not built: promotion push and text messages, dietary defaults and sort order have
 * no endpoint.
 */
import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppBar, Badge, Banner, Button, Card, ErrorState, Icon, Skeleton, Switch, radius, space, useTheme, useTypeStyle } from '../ds';
import { useConnectivity } from '../lib/connectivity';
import { getNow } from '../lib/now';
import { useQuery } from '../lib/query';
import { formatTime } from '../lib/time';
import { useNav } from '../navigation/context';
import { getProfile, updateProfile } from './accountApi';
import { EditDetailsSheet } from './EditDetailsSheet';
import { openPhoneSettings, usePushState } from './pushPermission';
import { consentLine, type CustomerProfile } from './rules';

export const NOTIFICATIONS_COPY = {
  title: 'Notification settings',
  errorTitle: "We couldn't load your settings",
  errorBody: "Your order's tracking screen keeps showing updates while this is down. Try again in a moment.",
  orderUpdates: 'Order updates',
  orderUpdatesBody:
    "We tell you when the restaurant accepts, when your rider is on the way and when your food arrives. Your order's tracking screen always shows them too.",
  pushOnBody: "To turn them off, use your phone's settings for HalalGoes.",
  pushNotAsked: 'Not turned on yet',
  pushNotAskedBody: 'Get alerts on your lock screen when your order changes. Your phone will ask you to allow them.',
  pushDeniedTitle: 'Push notifications are off',
  pushDeniedBody: "You won't get alerts on your lock screen. Your order's tracking screen still shows every update.",
  email: 'Email',
  switchLabel: 'News and offers by email',
  noEmail: 'Add an email to get news and offers by email.',
  saveFailedTitle: "We couldn't change that",
  saveFailedBody: 'The setting is as it was. Check your connection and try again.',
} as const;

export function NotificationSettingsScreen(): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const body = useTypeStyle('body.md');
  const small = useTypeStyle('body.sm');
  const heading = useTypeStyle('heading.md');
  const label = useTypeStyle('label.lg');
  const { online } = useConnectivity();
  const { query, reload } = useQuery(getProfile, []);
  const push = usePushState();

  const [saved, setSaved] = React.useState<CustomerProfile | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [addEmail, setAddEmail] = React.useState(false);
  const [asking, setAsking] = React.useState(false);

  const profile = saved ?? (query.kind === 'ready' ? query.data : null);

  async function setConsent(next: boolean): Promise<void> {
    setFailed(false);
    setSaving(true);
    try {
      setSaved(await updateProfile({ marketing_consent: next }));
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  async function askForPush(): Promise<void> {
    setAsking(true);
    try {
      await push.turnOn();
    } finally {
      setAsking(false);
    }
  }

  let content: React.ReactElement;
  if (!profile && query.kind === 'loading') {
    content = (
      <View accessibilityRole="progressbar" accessibilityLabel="Loading notification settings" aria-busy testID="Notifications-loading">
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.stack}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} variant="rect" height={88} />
          ))}
        </View>
      </View>
    );
  } else if (!profile) {
    content = (
      <ErrorState
        variant="page"
        errorCode={query.kind === 'error' ? query.code : null}
        offline={!online}
        title={NOTIFICATIONS_COPY.errorTitle}
        description={NOTIFICATIONS_COPY.errorBody}
        onRetry={reload}
        testID="Notifications-error"
      />
    );
  } else {
    const hasEmail = Boolean(profile.email);
    const on = hasEmail && Boolean(profile.marketing_consent_at);
    content = (
      <View style={styles.stack}>
        {!online ? (
          <Banner
            variant="info"
            title="You're offline"
            description={`These are your settings from ${formatTime(query.kind === 'ready' ? query.asOf : getNow())}. Connect to change them.`}
            testID="Notifications-offline"
          />
        ) : null}
        {failed ? (
          <Banner
            variant="warning"
            title={NOTIFICATIONS_COPY.saveFailedTitle}
            description={NOTIFICATIONS_COPY.saveFailedBody}
            testID="Notifications-failed"
          />
        ) : null}

        <View style={styles.section}>
          <Text accessibilityRole="header" aria-level={2} style={[heading, { color: theme.color.text.primary }]}>
            {NOTIFICATIONS_COPY.orderUpdates}
          </Text>
          <Text style={[body, { color: theme.color.text.secondary }]}>{NOTIFICATIONS_COPY.orderUpdatesBody}</Text>

          {push.state === null ? (
            <Skeleton variant="rect" height={72} testID="Notifications-push-loading" />
          ) : push.state === 'allowed' ? (
            <Card variant="outlined" radius={radius.lg} testID="Notifications-push">
              <View style={styles.stack}>
                <View style={styles.pushRow}>
                  <Icon name="bell" size={20} color={theme.color.text.secondary} />
                  <View style={styles.grow}>
                    <Text style={[label, { color: theme.color.text.primary }]}>Push notifications</Text>
                    <Text style={[small, { color: theme.color.text.secondary }]}>Allowed on this phone</Text>
                  </View>
                  <Badge variant="neutral" size="sm" label="On" />
                </View>
                <Text style={[small, { color: theme.color.text.secondary }]}>{NOTIFICATIONS_COPY.pushOnBody}</Text>
                <View style={styles.start}>
                  <Button variant="tertiary" size="sm" onPress={openPhoneSettings} testID="Notifications-openSettings">
                    Open phone settings
                  </Button>
                </View>
              </View>
            </Card>
          ) : push.state === 'notAsked' ? (
            <Card variant="outlined" radius={radius.lg} testID="Notifications-push">
              <View style={styles.stack}>
                <View style={styles.pushRow}>
                  <Icon name="bell" size={20} color={theme.color.text.secondary} />
                  <View style={styles.grow}>
                    <Text style={[label, { color: theme.color.text.primary }]}>Push notifications</Text>
                    <Text style={[small, { color: theme.color.text.secondary }]}>{NOTIFICATIONS_COPY.pushNotAsked}</Text>
                  </View>
                </View>
                <Text style={[small, { color: theme.color.text.secondary }]}>{NOTIFICATIONS_COPY.pushNotAskedBody}</Text>
                <Button variant="primary" size="md" loading={asking} onPress={askForPush} testID="Notifications-turnOn">
                  Turn on notifications
                </Button>
              </View>
            </Card>
          ) : (
            <Banner
              variant="warning"
              title={NOTIFICATIONS_COPY.pushDeniedTitle}
              description={NOTIFICATIONS_COPY.pushDeniedBody}
              icon={<Icon name="bell" size={20} color={theme.color.text.secondary} />}
              action={{ label: 'Open phone settings', onPress: openPhoneSettings }}
              testID="Notifications-denied"
            />
          )}
        </View>

        <View style={styles.section}>
          <Text accessibilityRole="header" aria-level={2} style={[heading, { color: theme.color.text.primary }]}>
            {NOTIFICATIONS_COPY.email}
          </Text>
          <Card variant="outlined" radius={radius.lg} testID="Notifications-email">
            <Switch
              label={NOTIFICATIONS_COPY.switchLabel}
              checked={on}
              loading={saving}
              disabled={!hasEmail || !online}
              onChange={setConsent}
              testID="Notifications-emailSwitch"
            />
          </Card>
          <Text style={[small, { color: theme.color.text.secondary }]} testID="Notifications-emailWhy">
            {hasEmail ? consentLine(profile) : NOTIFICATIONS_COPY.noEmail}
          </Text>
          {!hasEmail ? (
            <View style={styles.start}>
              <Button variant="tertiary" size="sm" iconStart="plus" onPress={() => setAddEmail(true)} testID="Notifications-addEmail">
                Add an email
              </Button>
            </View>
          ) : null}
        </View>

        {addEmail ? (
          <EditDetailsSheet
            profile={profile}
            mode="addEmail"
            onClose={() => setAddEmail(false)}
            onSaved={(next) => {
              setSaved(next);
              setAddEmail(false);
            }}
          />
        ) : null}
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="NotificationSettingsScreen">
      <AppBar
        title={NOTIFICATIONS_COPY.title}
        tone="cream"
        loading={!profile && query.kind === 'loading'}
        back={{ onPress: nav.back, previousTitle: 'Account' }}
      />
      <ScrollView contentContainerStyle={[styles.content, { paddingHorizontal: theme.density.gutter }]}>{content}</ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingTop: space['2'], paddingBottom: space['6'], flexGrow: 1 },
  stack: { gap: space['4'] },
  section: { gap: space['3'] },
  pushRow: { flexDirection: 'row', alignItems: 'center', gap: space['3'] },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  start: { alignSelf: 'flex-start' },
});
