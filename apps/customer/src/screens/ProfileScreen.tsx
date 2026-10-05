/**
 * Account (C-03), as the approved Account canvas draws it: the customer's card (initials, name,
 * phone, email and whether it is confirmed), then one group of rows each for Ordering,
 * Notifications and Help, Sign out, and how to delete the account.
 *
 * Only rows the contract and this app can honour are drawn. Payment methods shows the saved card
 * from `listPaymentMethods` (cards are added at checkout; there is no card screen yet). Support is
 * a phone line during set hours only: Call support while `support_enabled`, otherwise a static
 * line saying it is closed. In-app deletion is a later version (owner decision, 1 October,
 * docs/decisions/README.md "Account deletion"); at launch the page says to ask by phone.
 *
 * Edit opens "Your details" in a sheet: first name required; last name and email can be changed
 * but not cleared once set (`CustomerProfileUpdateInput` has `minLength: 1`); the phone number
 * is how the customer signs in and is never editable. Sign out asks first, then always works on
 * this phone, whatever the network does.
 */
import * as React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { isApiError } from '@hg/api-client';
import {
  AppBar,
  Badge,
  Button,
  Card,
  Icon,
  Input,
  Modal,
  Sheet,
  Skeleton,
  Toast,
  initialsOf,
  tokens,
  useTheme,
  useTypeStyle,
} from '@hg/ui-native';

import { getProfile, updateProfile, type CustomerProfile } from '../api/profile';
import { listAddresses, type Address } from '../api/addresses';
import { cardSummary, listPaymentMethods } from '../api/paymentMethods';
import { authFailureOf, logout, resendEmailVerification } from '../api/auth';
import { callSupport, useSupport } from '../api/support';
import { useAsync } from '../api/async';
import { ListGroup, ListRow } from '../components/ListRow';
import { Notice } from '../components/Notice';
import { StateMessage } from '../components/StateMessage';
import { useNavigation } from '../navigation/stack';
import { CustomerTabBar } from '../navigation/TabBar';
import { displayPhone, clockTime, waitUntil } from '../signin/phone';
import { noteSignedOut } from '../signin/session';
import { looksLikeEmail } from './ProfileCaptureScreen';

/** "Home · 14 Ellesmere Rd" for the default address, or a prompt with none saved. */
export function addressSummary(addresses: Address[]): string {
  const a = addresses.find((x) => x.is_default) ?? addresses[0];
  if (!a) return 'No saved addresses';
  return a.label ? `${a.label} · ${a.line1}` : a.line1;
}

export function ProfileScreen(): React.ReactElement {
  const theme = useTheme();
  const nav = useNavigation();
  const { state, reload } = useAsync(() => getProfile(), []);
  const [confirmSignOut, setConfirmSignOut] = React.useState(false);

  const signOut = (): void => {
    noteSignedOut('signedOut');
    logout();
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface.base }}>
      <AppBar tone="cream" title="Account" loading={state.kind === 'loading'} />
      <View style={{ flex: 1 }}>
        {state.kind === 'loading' ? (
          <AccountSkeleton />
        ) : state.kind === 'error' ? (
          <AccountError onRetry={reload} onSignOut={() => setConfirmSignOut(true)} />
        ) : (
          <AccountBody
            profile={state.data}
            onSaved={reload}
            onOpenAddresses={() => nav.push({ name: 'addresses' })}
            onOpenNotifications={() => nav.push({ name: 'notificationSettings' })}
            onSignOut={() => setConfirmSignOut(true)}
          />
        )}
      </View>
      <CustomerTabBar active="profile" />
      <Modal
        open={confirmSignOut}
        onClose={() => setConfirmSignOut(false)}
        variant="confirm"
        size="sm"
        title="Sign out of HalalGoes?"
        description="Your addresses stay saved to your account. To sign in again, we'll send a code to your phone."
        actions={[
          { label: 'Stay signed in', onPress: () => setConfirmSignOut(false) },
          { label: 'Sign out', onPress: signOut, testID: 'Account-confirm-signout' },
        ]}
        testID="Account-signout-modal"
      />
    </View>
  );
}

function AccountSkeleton(): React.ReactElement {
  const theme = useTheme();
  const bar = (width: `${number}%` | number, height: number) => (
    <View style={{ width }}>
      <Skeleton variant="rect" height={height} animated={false} />
    </View>
  );
  return (
    <View
      style={{ padding: tokens.space['4'], paddingTop: tokens.space['2'], gap: tokens.space['4'] }}
      accessibilityLabel="Loading your account"
      testID="Account-loading"
    >
      <Card variant="outlined" style={{ backgroundColor: theme.color.surface.raised }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space['3'] }}>
          <Skeleton variant="circle" height={56} animated={false} />
          <View style={{ flex: 1, gap: tokens.space['2'] }}>
            {bar('50%', 16)}
            {bar('40%', 12)}
          </View>
        </View>
      </Card>
      <ListGroup>
        {[45, 55, 35].map((w) => (
          <View
            key={w}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: tokens.space['3'],
              minHeight: theme.density.rowHeight,
              paddingHorizontal: tokens.space['4'],
            }}
          >
            {bar(36, 36)}
            {bar(`${w}%`, 14)}
          </View>
        ))}
      </ListGroup>
    </View>
  );
}

function AccountError({ onRetry, onSignOut }: { onRetry: () => void; onSignOut: () => void }): React.ReactElement {
  return (
    <StateMessage
      tone="error"
      icon="refresh"
      title="We couldn't load your account"
      description="Check your connection and try again. You can still sign out."
      onRetry={onRetry}
      testID="Account-error"
    >
      <Button variant="ghost" onPress={onSignOut}>
        Sign out
      </Button>
    </StateMessage>
  );
}

function AccountBody({
  profile,
  onSaved,
  onOpenAddresses,
  onOpenNotifications,
  onSignOut,
}: {
  profile: CustomerProfile;
  onSaved: () => void;
  onOpenAddresses: () => void;
  onOpenNotifications: () => void;
  onSignOut: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const nameType = useTypeStyle('heading.md');
  const body = useTypeStyle('body.md');
  const small = useTypeStyle('body.sm');
  const groupLabel = useTypeStyle('label.md');
  const support = useSupport();

  // The sublines load after the profile; each row is a live link before they answer.
  const addresses = useAsync(() => listAddresses(), []);
  const cards = useAsync(() => listPaymentMethods(), []);

  const [editing, setEditing] = React.useState<'details' | 'email' | null>(null);
  const [toast, setToast] = React.useState<{ title: string; description?: string } | null>(null);
  const [resending, setResending] = React.useState(false);
  const [resendWait, setResendWait] = React.useState<number | null>(null);

  const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ');
  const version = Constants.expoConfig?.version;

  async function resendLink(): Promise<void> {
    if (!profile.email) return;
    setResending(true);
    try {
      await resendEmailVerification(profile.email);
      setToast({ title: 'Link sent', description: `Check ${profile.email}. The link works for 24 hours.` });
    } catch (e) {
      const f = authFailureOf(e);
      if (f.kind === 'rate_limited') setResendWait(waitUntil(Date.now(), f.retryAfterS));
      else setToast({ title: "We couldn't send the link", description: 'Check your connection and try again.' });
    } finally {
      setResending(false);
    }
  }
  const resendBlocked = resendWait !== null && Date.now() < resendWait;

  const addressSub =
    addresses.state.kind === 'loading'
      ? null
      : addresses.state.kind === 'error'
        ? 'Your saved delivery addresses'
        : addressSummary(addresses.state.data);
  const cardSub =
    cards.state.kind === 'loading'
      ? null
      : cards.state.kind === 'error'
        ? "Couldn't load your cards."
        : (cardSummary(cards.state.data) ?? 'No saved cards. You can save one at checkout.');

  return (
    <>
      <ScrollView
        contentContainerStyle={{
          padding: tokens.space['4'],
          paddingTop: tokens.space['2'],
          paddingBottom: tokens.space['6'] + insets.bottom,
          gap: tokens.space['6'],
        }}
        testID="Account-content"
      >
        <Card variant="outlined" style={{ backgroundColor: theme.color.surface.raised }}>
          <View style={{ gap: tokens.space['4'] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space['3'] }}>
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: tokens.radius.full,
                  backgroundColor: theme.color.surface.sunken,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={[nameType, { color: theme.color.text.primary }]}>{initialsOf(fullName)}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={[nameType, { color: theme.color.text.primary }]}>{fullName}</Text>
                <Text style={[small, { color: theme.color.text.secondary }]}>
                  {displayPhone(profile.phone_e164)}
                </Text>
              </View>
              <Button
                variant="tertiary"
                size="sm"
                accessibilityLabel="Edit your details"
                onPress={() => setEditing('details')}
                testID="Account-edit"
              >
                Edit
              </Button>
            </View>
            <View
              style={{
                gap: tokens.space['2'],
                paddingTop: tokens.space['3'],
                borderTopWidth: 1,
                borderTopColor: theme.color.border.decorative,
              }}
            >
              {profile.email ? (
                <>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: tokens.space['2'] }}>
                    <Text style={[body, { color: theme.color.text.primary }]}>{profile.email}</Text>
                    {!profile.email_verified ? (
                      <Badge
                        label="Not confirmed"
                        variant="warning"
                        size="sm"
                        icon={<Icon name="warning" size={12} color={theme.color.feedback.warning.icon} />}
                      />
                    ) : null}
                  </View>
                  {!profile.email_verified ? (
                    <>
                      <Text style={[small, { color: theme.color.text.secondary }]}>
                        Open the link we emailed you to confirm this address.
                      </Text>
                      <Button
                        variant="tertiary"
                        size="sm"
                        loading={resending}
                        disabled={resendBlocked}
                        onPress={resendLink}
                      >
                        Send the link again
                      </Button>
                      {resendBlocked ? (
                        <Text accessibilityLiveRegion="polite" style={[small, { color: theme.color.text.secondary }]}>
                          You can ask for a new link at {clockTime(resendWait!)}.
                        </Text>
                      ) : null}
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  <Text style={[small, { color: theme.color.text.secondary }]}>
                    No email on your account. Add one if you'd like to hear from us by email.
                  </Text>
                  <Button
                    variant="tertiary"
                    size="sm"
                    iconStart={<Icon name="plus" size={16} color={theme.color.text.primary} />}
                    onPress={() => setEditing('email')}
                  >
                    Add an email
                  </Button>
                </>
              )}
            </View>
          </View>
        </Card>

        <ListGroup label="Ordering">
          <ListRow
            icon="map"
            title="Addresses"
            subtitle={addressSub}
            onPress={onOpenAddresses}
            testID="Account-addresses"
          />
          {/* No card screen in this app yet: the row says what is saved and opens nothing. */}
          <ListRow icon="card" title="Payment methods" subtitle={cardSub} testID="Account-payment" />
        </ListGroup>

        <ListGroup label="Notifications">
          <ListRow
            icon="bell"
            title="Notification settings"
            subtitle={`Order updates · News by email ${profile.marketing_consent_at ? 'on' : 'off'}`}
            onPress={onOpenNotifications}
            testID="Account-notifications"
          />
        </ListGroup>

        <ListGroup label="Help">
          {support?.phoneE164 ? (
            <ListRow
              icon="phone"
              title="Call support"
              subtitle={`${support.hours ? `${support.hours}. ` : ''}Have your order code ready.`}
              onPress={() => callSupport(support.phoneE164!)}
              testID="Account-support"
            />
          ) : (
            <ListRow
              icon="phone"
              title={support?.hours ? 'Phone support is closed now' : "Phone support isn't available right now"}
              subtitle={`${support?.hours ? `Open ${support.hours}. ` : ''}For a problem with an order, open it in Orders and choose Get help.`}
              testID="Account-support"
            />
          )}
        </ListGroup>

        <View style={{ gap: tokens.space['6'] }}>
          <Button variant="tertiary" size="lg" fullWidth onPress={onSignOut} testID="Account-signout">
            Sign out
          </Button>
          <View style={{ gap: tokens.space['1'] }}>
            <Text accessibilityRole="header" style={[groupLabel, { color: theme.color.text.secondary }]}>
              Delete your account
            </Text>
            <Text style={[small, { color: theme.color.text.primary }]}>
              To delete your account, call us during phone hours. We'll check it's really you, then
              delete it.
            </Text>
          </View>
          {version ? (
            <Text style={[small, { color: theme.color.text.secondary, textAlign: 'center' }]}>
              HalalGoes {version}
            </Text>
          ) : null}
        </View>
      </ScrollView>

      {toast ? (
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: 16 }}>
          <Toast variant="success" title={toast.title} description={toast.description} onDismiss={() => setToast(null)} />
        </View>
      ) : null}

      <DetailsSheet
        open={editing !== null}
        focusEmail={editing === 'email'}
        profile={profile}
        onClose={() => setEditing(null)}
        onSaved={(updated) => {
          setEditing(null);
          const newEmail = updated.email && updated.email !== profile.email;
          setToast({
            title: 'Details saved',
            description: newEmail ? `We sent a link to ${updated.email}. Open it to confirm your new email.` : undefined,
          });
          onSaved();
        }}
      />
    </>
  );
}

function DetailsSheet({
  open,
  focusEmail,
  profile,
  onClose,
  onSaved,
}: {
  open: boolean;
  focusEmail: boolean;
  profile: CustomerProfile;
  onClose: () => void;
  onSaved: (updated: CustomerProfile) => void;
}): React.ReactElement {
  const theme = useTheme();
  const label = useTypeStyle('label.md');
  const body = useTypeStyle('body.md');
  const small = useTypeStyle('body.sm');

  const [first, setFirst] = React.useState(profile.first_name);
  const [last, setLast] = React.useState(profile.last_name ?? '');
  const [email, setEmail] = React.useState(profile.email ?? '');
  const [errors, setErrors] = React.useState<{ first?: string; last?: string; email?: string }>({});
  const [saving, setSaving] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setFirst(profile.first_name);
    setLast(profile.last_name ?? '');
    setEmail(profile.email ?? '');
    setErrors({});
    setFailed(false);
  }, [open, profile]);

  async function save(): Promise<void> {
    const next: typeof errors = {};
    if (!first.trim()) next.first = 'Enter your first name.';
    if (profile.last_name && !last.trim()) next.last = "Your last name can be changed but not removed.";
    if (email.trim() && !looksLikeEmail(email)) next.email = "We couldn't use this email. Check it's typed correctly.";
    if (profile.email && !email.trim()) next.email = 'You can change your email but not remove it.';
    setErrors(next);
    if (next.first || next.last || next.email) return;
    setFailed(false);
    setSaving(true);
    try {
      const updated = await updateProfile({
        first_name: first.trim(),
        ...(last.trim() && last.trim() !== (profile.last_name ?? '') ? { last_name: last.trim() } : {}),
        ...(email.trim() && email.trim() !== (profile.email ?? '') ? { email: email.trim() } : {}),
      });
      onSaved(updated);
    } catch (e) {
      if (isApiError(e) && e.code === 'VALIDATION_FAILED') {
        setErrors({ email: "We couldn't use this email. Check it's typed correctly." });
      } else {
        setFailed(true);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Your details"
      snapPoints={[0.88]}
      scrollable
      keyboardAvoiding
      testID="Account-details-sheet"
      footer={
        <Button variant="primary" size="lg" fullWidth loading={saving} onPress={save} testID="Account-details-save">
          {saving ? 'Saving' : 'Save changes'}
        </Button>
      }
    >
      <View style={{ gap: tokens.space['4'] }}>
        {failed ? (
          <Notice
            tone="warning"
            icon="warning"
            title="We couldn't save your changes"
            description="What you typed is still here."
          />
        ) : null}
        {!focusEmail ? (
          <>
            <Input
              label="First name"
              required
              autoComplete="given-name"
              maxLength={50}
              value={first}
              onChange={setFirst}
              readOnly={saving}
              errorText={errors.first}
            />
            <Input
              label="Last name"
              autoComplete="family-name"
              maxLength={50}
              value={last}
              onChange={setLast}
              readOnly={saving}
              errorText={errors.last}
            />
          </>
        ) : null}
        <Input
          label="Email"
          variant="email"
          autoComplete="email"
          maxLength={254}
          value={email}
          onChange={setEmail}
          readOnly={saving}
          helperText={
            errors.email
              ? undefined
              : profile.email
                ? 'You can change your email but not remove it.'
                : "We'll email a link to confirm it. Once added, you can change it but not remove it."
          }
          errorText={errors.email}
        />
        <View style={{ gap: tokens.space['1'] }}>
          <Text style={[label, { color: theme.color.text.secondary }]}>Mobile number</Text>
          <Text style={[body, { color: theme.color.text.primary }]}>{displayPhone(profile.phone_e164)}</Text>
          <Text style={[small, { color: theme.color.text.secondary }]}>
            Your number is how you sign in, so it can't be changed here.
          </Text>
        </View>
      </View>
    </Sheet>
  );
}
