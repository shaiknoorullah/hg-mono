/**
 * Notification settings, from Account (Account canvas, Notification settings board).
 *
 * Order updates are transactional, so there is no toggle the app could not honour: the screen
 * shows whether this phone allows push and links to the phone's settings, or asks for permission
 * when it has never been asked. The tracking screen always shows every update anyway.
 *
 * The one real preference is news by email (`marketing_consent` on `updateCustomerProfile`). The
 * switch keeps its old position until the server confirms. Without an email it is disabled and
 * says why. Consent can be recorded before the email is confirmed; nothing is sent until it is
 * (docs/spec/02-customer.md "C-04 — Preferences", rule 6).
 */
import * as React from 'react';
import { Linking, Platform, ScrollView, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { AppBar, Badge, Button, Card, ErrorState, Icon, Spinner, Switch, Toast, tokens, useTheme, useTypeStyle } from '@hg/ui-native';

import { getProfile, updateProfile, type CustomerProfile } from '../api/profile';
import { enablePush } from '../api/push';
import { useAsync } from '../api/async';
import { ListGroup, ListRow } from '../components/ListRow';
import { Notice } from '../components/Notice';
import { useNavigation } from '../navigation/stack';
import { CustomerTabBar } from '../navigation/TabBar';

type PushState = 'on' | 'notAsked' | 'denied' | 'unsupported';

async function readPush(): Promise<PushState> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return 'unsupported';
  try {
    const p = await Notifications.getPermissionsAsync();
    if (p.granted) return 'on';
    return p.canAskAgain ? 'notAsked' : 'denied';
  } catch {
    return 'unsupported';
  }
}

export function NotificationSettingsScreen(): React.ReactElement {
  const theme = useTheme();
  const nav = useNavigation();
  const { state, reload } = useAsync(() => getProfile(), []);

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface.base }}>
      <AppBar
        tone="cream"
        title="Notification settings"
        back={{ onPress: nav.back, previousTitle: 'Account' }}
        loading={state.kind === 'loading'}
      />
      <View style={{ flex: 1 }}>
        {state.kind === 'loading' ? (
          <View style={{ padding: tokens.space['4'] }}>
            <Spinner label="Loading notification settings" />
          </View>
        ) : state.kind === 'error' ? (
          <View style={{ flex: 1, justifyContent: 'center', padding: tokens.space['4'] }}>
            <ErrorState
              title="We couldn't load your settings"
              description="Your order's tracking screen keeps showing updates while this is down. Try again in a moment."
              onRetry={reload}
            />
          </View>
        ) : (
          <SettingsBody profile={state.data} />
        )}
      </View>
      <CustomerTabBar active="profile" />
    </View>
  );
}

function SettingsBody({ profile }: { profile: CustomerProfile }): React.ReactElement {
  const theme = useTheme();
  const h2 = useTypeStyle('heading.sm');
  const small = useTypeStyle('body.sm');
  const [push, setPush] = React.useState<PushState | null>(null);
  const [consentAt, setConsentAt] = React.useState(profile.marketing_consent_at);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  React.useEffect(() => {
    void readPush().then(setPush);
  }, []);

  const on = consentAt !== null;
  const hasEmail = Boolean(profile.email);

  async function toggle(next: boolean): Promise<void> {
    setError(null);
    setSaving(true);
    try {
      const updated = await updateProfile({ marketing_consent: next });
      setConsentAt(updated.marketing_consent_at ?? null);
      if (!next) setToast('News by email is off');
    } catch {
      setError(`We couldn't change this. It's still ${on ? 'on' : 'off'}. Try again.`);
    } finally {
      setSaving(false);
    }
  }

  const agreed = consentAt
    ? new Date(consentAt).toLocaleDateString('en-CA', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  return (
    <>
      <ScrollView contentContainerStyle={{ padding: tokens.space['4'], paddingTop: tokens.space['2'], gap: tokens.space['6'] }}>
        <View style={{ gap: tokens.space['3'] }}>
          <Text accessibilityRole="header" style={[h2, { color: theme.color.text.primary }]}>
            Order updates
          </Text>
          <Text style={[small, { color: theme.color.text.secondary }]}>
            We tell you when the restaurant accepts, when your rider is on the way and when your food
            arrives. Your order's tracking screen always shows them too.
          </Text>
          {push === 'on' ? (
            <>
              <ListGroup>
                <ListRow
                  icon="bell"
                  title="Push notifications"
                  subtitle="Allowed on this phone"
                  trailing={<Badge label="On" variant="neutral" icon={<Icon name="check" size={12} color={theme.color.text.secondary} />} />}
                />
              </ListGroup>
              <Text style={[small, { color: theme.color.text.secondary }]}>
                To turn them off, use your phone's settings for HalalGoes.
              </Text>
              <Button variant="tertiary" size="lg" fullWidth onPress={() => void Linking.openSettings()}>
                Open phone settings
              </Button>
            </>
          ) : push === 'notAsked' ? (
            <>
              <ListGroup>
                <ListRow icon="bell" title="Push notifications" subtitle="Not turned on yet" />
              </ListGroup>
              <Text style={[small, { color: theme.color.text.secondary }]}>
                Get alerts on your lock screen when your order changes. Your phone will ask you to allow them.
              </Text>
              <Button
                variant="primary"
                size="lg"
                fullWidth
                iconStart={<Icon name="bell" size={20} color={theme.color.text.onBrand} />}
                onPress={() => void enablePush().then(readPush).then(setPush)}
              >
                Turn on notifications
              </Button>
            </>
          ) : push === 'denied' ? (
            <>
              <Notice
                tone="neutral"
                icon="bell"
                title="Push notifications are off"
                description="You won't get alerts on your lock screen. Your order's tracking screen still shows every update."
              />
              <Button variant="tertiary" size="lg" fullWidth onPress={() => void Linking.openSettings()}>
                Open phone settings
              </Button>
            </>
          ) : null}
        </View>

        <View style={{ gap: tokens.space['3'] }}>
          <Text accessibilityRole="header" style={[h2, { color: theme.color.text.primary }]}>
            Email
          </Text>
          <Card variant="outlined" style={{ backgroundColor: theme.color.surface.raised }}>
            <View style={{ gap: tokens.space['2'] }}>
              <Switch
                label="News and offers by email"
                checked={on}
                onChange={(next) => void toggle(next)}
                loading={saving}
                disabled={!hasEmail || saving}
                stateLabels={{ on: 'On', off: 'Off' }}
                testID="Notifications-email"
              />
              <Text style={[small, { color: theme.color.text.secondary }]}>
                {hasEmail
                  ? `Occasional emails to ${profile.email}. Off unless you turn it on.`
                  : 'Add an email to your account first.'}
              </Text>
              {error ? (
                <Text accessibilityRole="alert" style={[small, { color: theme.color.feedback.warning.text }]}>
                  {error}
                </Text>
              ) : null}
              {on && agreed ? (
                <Text style={[small, { color: theme.color.text.secondary }]}>
                  {profile.email_verified
                    ? `You agreed on ${agreed}. Turn this off at any time.`
                    : `You agreed on ${agreed}. We'll start once you open the link we emailed to ${profile.email}; until then we send nothing there.`}
                </Text>
              ) : null}
            </View>
          </Card>
        </View>
      </ScrollView>
      {toast ? (
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: 16 }}>
          <Toast variant="neutral" title={toast} onDismiss={() => setToast(null)} />
        </View>
      ) : null}
    </>
  );
}
