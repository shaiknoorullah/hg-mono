/**
 * The customer's account profile (C-03): `GET`/`PATCH /v1/me/profile`.
 *
 * `phone_e164` is read-only here by contract — there is no phone-change flow at any version —
 * so it renders but never as an editable `Input`. Saving `email` flips `email_verified` false
 * server-side; the screen reflects that back rather than assuming the new address is verified.
 */
import * as React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AppBar,
  Avatar,
  Badge,
  Button,
  Card,
  Divider,
  ErrorState,
  Icon,
  Input,
  Spinner,
  Switch,
  Toast,
  useTheme,
  useTypeStyle,
} from '@hg/ui-native';

import { getProfile, updateProfile, type CustomerProfile } from '../api/profile';
import { useAsync } from '../api/async';
import { useNavigation } from '../navigation/stack';
import { CustomerTabBar } from '../navigation/TabBar';
import { logout } from '../api/auth';

export function ProfileScreen(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const nav = useNavigation();
  const { state, reload } = useAsync(() => getProfile(), []);

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface.sunken }}>
      <AppBar title="Profile" />
      <View style={{ flex: 1 }}>
        {state.kind === 'loading' ? (
          <View style={{ flex: 1, padding: 16 }}>
            <Spinner label="Loading profile" />
          </View>
        ) : state.kind === 'error' ? (
          <View style={{ flex: 1, justifyContent: 'center', padding: 16 }}>
            <ErrorState errorCode={state.code} onRetry={reload} />
          </View>
        ) : (
          <ProfileForm
            profile={state.data}
            onSaved={reload}
            bottomInset={insets.bottom}
            onOpenAddresses={() => nav.push({ name: 'addresses' })}
            onOpenOrders={() => nav.reset({ name: 'orders' })}
            onSignOut={logout}
          />
        )}
      </View>
      <CustomerTabBar active="profile" />
    </View>
  );
}

function ProfileForm({
  profile,
  onSaved,
  bottomInset,
  onOpenAddresses,
  onOpenOrders,
  onSignOut,
}: {
  profile: CustomerProfile;
  onSaved: () => void;
  bottomInset: number;
  onOpenAddresses: () => void;
  onOpenOrders: () => void;
  onSignOut: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const heading = useTypeStyle('heading.sm');
  const body = useTypeStyle('body.sm');

  const [firstName, setFirstName] = React.useState(profile.first_name);
  const [lastName, setLastName] = React.useState(profile.last_name ?? '');
  const [email, setEmail] = React.useState(profile.email ?? '');
  const [marketing, setMarketing] = React.useState(profile.marketing_consent_at !== null);
  const [saving, setSaving] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);
  const [errorText, setErrorText] = React.useState<string | null>(null);

  const dirty =
    firstName !== profile.first_name ||
    lastName !== (profile.last_name ?? '') ||
    email !== (profile.email ?? '') ||
    marketing !== (profile.marketing_consent_at !== null);

  async function save(): Promise<void> {
    if (!firstName.trim()) {
      setErrorText('First name is required.');
      return;
    }
    setErrorText(null);
    setSaving(true);
    try {
      await updateProfile({
        first_name: firstName.trim(),
        last_name: lastName.trim() || undefined,
        email: email.trim() || undefined,
        marketing_consent: marketing,
      });
      setToast('Profile updated.');
      onSaved();
    } catch {
      setToast("Couldn't save your changes — please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 16 + bottomInset, gap: 16 }}>
      <Card variant="outlined">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Avatar name={`${profile.first_name} ${profile.last_name ?? ''}`.trim()} src={profile.avatar_url ?? undefined} size="lg" />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[heading, { color: theme.color.text.primary }]}>
              {profile.first_name} {profile.last_name ?? ''}
            </Text>
            <Text style={[body, { color: theme.color.text.secondary }]}>{profile.phone_e164}</Text>
          </View>
        </View>
      </Card>

      <Card variant="outlined">
        <View style={{ gap: 14 }}>
          <Input label="First name" value={firstName} onChange={setFirstName} required />
          <Input label="Last name" value={lastName} onChange={setLastName} />
          <Input
            label="Email"
            value={email}
            onChange={setEmail}
            helperText={
              profile.email && !profile.email_verified ? 'Not yet verified.' : undefined
            }
            success={Boolean(profile.email) && profile.email_verified && email === profile.email}
            autoComplete="email"
          />
          {errorText ? <Text style={{ color: theme.color.feedback.danger.text }}>{errorText}</Text> : null}
          <Switch
            checked={marketing}
            onChange={setMarketing}
            label="Marketing emails"
            description="Occasional offers and news. Off by default (CASL)."
          />
          <Button variant="primary" onPress={save} loading={saving} disabled={!dirty} fullWidth>
            Save changes
          </Button>
        </View>
      </Card>

      <Card variant="outlined" onPress={onOpenAddresses}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={[body, { color: theme.color.text.primary, fontWeight: '700' }]}>
            Saved addresses
          </Text>
          <View style={{ transform: [{ scaleX: -1 }] }}>
            <Icon name="back" weight="linear" size={18} color={theme.color.text.tertiary} />
          </View>
        </View>
      </Card>

      <Card variant="outlined" onPress={onOpenOrders}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={[body, { color: theme.color.text.primary, fontWeight: '700' }]}>
            Order history
          </Text>
          <View style={{ transform: [{ scaleX: -1 }] }}>
            <Icon name="back" weight="linear" size={18} color={theme.color.text.tertiary} />
          </View>
        </View>
      </Card>

      <Divider />

      <Button variant="secondary" onPress={onSignOut} fullWidth>
        Sign out
      </Button>

      {toast ? <Toast variant={toast.startsWith("Couldn't") ? 'danger' : 'success'} title={toast} onDismiss={() => setToast(null)} /> : null}
    </ScrollView>
  );
}
