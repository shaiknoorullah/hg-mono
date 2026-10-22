/**
 * A1 Account, with A2 Edit details and A10 Sign out (boards `AC/Account` and its `-unverified`,
 * `-resent`, `-resendlimited`, `-resendday`, `-pendingemail`, `-noemail`, `-nosupport`,
 * `-supportclosed`, `-loading`, `-error`, `-edit*`, `-addemail`, `-signout`, `-dark`, `-360`, `-lt`).
 *
 * The profile loads first and alone (`getCustomerProfile`): while it loads the page is skeletons,
 * and if it fails the page is an error that still offers Sign out. The rows' sublines come from
 * their own reads and never hold the page back: the default address (`listAddresses`), the phone
 * line (`getPublicConfig`) and this phone's push permission. A subline that cannot load is left
 * out, not guessed.
 *
 * Built: the profile card (name, number, email and its confirmed state, Send the link again), the
 * Ordering group (Addresses), Notifications and privacy (Notification settings), Help and about
 * (Call support or its closed and unavailable forms, How we check halal certificates, Terms and
 * privacy), the deletion-by-request paragraph, Sign out and the app version.
 *
 * Not built, and why: Payment methods and Refunds (no board draws the pages they open) and App
 * settings (needs a location-permission module the app does not ship). Their rows are left out
 * rather than leading nowhere; the tracking issue lists them. What's new is built (`../whatsnew`).
 *
 * Sign out always works on this phone: the session is cleared at once and the server is told
 * best-effort, so the board's "We couldn't sign you out" never occurs here (`api/auth.ts`).
 *
 * Contract notes: `CustomerProfile` has no pending or previous email, so after a change the page
 * shows the new address as "Not confirmed" and never says the old one stays in use. A 429 on
 * resend names no limit, so a wait over an hour is read as the daily one (`rules.ts`).
 */
import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';

import { signOut } from '../api/auth';
import { callSupport, getPublicConfig, supportFrom, type Support } from '../api/config';
import {
  AppBar,
  Avatar,
  Badge,
  Button,
  Card,
  ErrorState,
  Icon,
  Modal,
  Skeleton,
  Toast,
  radius,
  space,
  useTheme,
  useTypeStyle,
} from '../ds';
import { useConnectivity } from '../lib/connectivity';
import { useNow } from '../lib/now';
import { useQuery } from '../lib/query';
import { formatTime } from '../lib/time';
import { useNav } from '../navigation/context';
import { listAddresses, getProfile, resendEmailLink } from './accountApi';
import { EditDetailsSheet } from './EditDetailsSheet';
import { usePushState } from './pushPermission';
import {
  addressesSubline,
  deletionText,
  displayName,
  formatPhone,
  initialsOf,
  notificationsSubline,
  type CustomerProfile,
  type ResendLimit,
} from './rules';
import { SettingsGroup, SettingsRow } from './SettingsRow';
import { WHATS_NEW } from '../whatsnew/copy';
import { appVersion } from '../whatsnew/releaseNotes';

export const ACCOUNT_COPY = {
  title: 'Account',
  errorTitle: "We couldn't load your account",
  errorBody: 'Check your connection and try again. You can still sign out.',
  notConfirmed: 'Not confirmed',
  confirmHint: 'Open the link we emailed you to confirm this address.',
  confirmHintNew: "Open the link we emailed to this new address to confirm it. Until then we won't send email here.",
  resend: 'Send the link again',
  noEmail: "No email on your account. Add one if you'd like to hear from us by email.",
  addEmail: 'Add an email',
  dayLimit: "You've asked 5 times today. Try again tomorrow.",
  signOutTitle: 'Sign out of HalalGoes?',
  signOutBody: "Your addresses stay saved to your account. To sign in again, we'll send a code to your phone.",
} as const;

type Toasted = { title: string; description?: string; variant?: 'success' | 'neutral' | 'warning' } | null;
type Resend = { kind: 'idle' } | { kind: 'sending' } | { kind: 'limited'; limit: ResendLimit };

export function AccountScreen(): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const now = useNow(30_000);
  const headingSm = useTypeStyle('heading.sm');
  const smallStyle = useTypeStyle('body.sm');
  const { online } = useConnectivity();
  const { query, reload } = useQuery(getProfile, []);
  const addresses = useQuery(listAddresses, []);
  const config = useQuery(getPublicConfig, []);
  const push = usePushState();

  const [saved, setSaved] = React.useState<CustomerProfile | null>(null);
  const [sheet, setSheet] = React.useState<null | 'edit' | 'addEmail'>(null);
  const [signOutOpen, setSignOutOpen] = React.useState(false);
  const [resend, setResend] = React.useState<Resend>({ kind: 'idle' });
  const [toast, setToast] = React.useState<Toasted>(null);
  const [newEmail, setNewEmail] = React.useState(false);

  const profile: CustomerProfile | null = saved ?? (query.kind === 'ready' ? query.data : null);
  const support: Support | null = config.query.kind === 'ready' ? supportFrom(config.query.data) : config.query.kind === 'error' ? { kind: 'unavailable' } : null;
  const supportEmail = config.query.kind === 'ready' ? config.query.data.support_email ?? null : null;
  const version = Constants.expoConfig?.version ?? null;

  async function sendLink(): Promise<void> {
    if (!profile?.email || resend.kind === 'sending') return;
    setResend({ kind: 'sending' });
    try {
      const result = await resendEmailLink(profile.email);
      if (result.ok) {
        setResend({ kind: 'idle' });
        setToast({
          variant: 'success',
          title: 'Link sent',
          description: `Check ${profile.email}. The link works for 24 hours.`,
        });
      } else if (result.limit) {
        setResend({ kind: 'limited', limit: result.limit });
      } else {
        setResend({ kind: 'idle' });
        setToast({ variant: 'warning', title: "We couldn't send the link", description: 'Check your connection and try again.' });
      }
    } catch {
      setResend({ kind: 'idle' });
      setToast({ variant: 'warning', title: "We couldn't send the link", description: 'Check your connection and try again.' });
    }
  }

  // A minute limit lifts at its static time; the button never ticks.
  const limit = resend.kind === 'limited' ? resend.limit : null;
  const minuteOver = limit?.kind === 'minute' && now >= limit.until;
  React.useEffect(() => {
    if (minuteOver) setResend({ kind: 'idle' });
  }, [minuteOver]);

  const loading = query.kind === 'loading' && !saved;
  const failed = query.kind === 'error' && !saved;

  let body: React.ReactElement;
  if (loading) {
    body = (
      <View accessibilityRole="progressbar" accessibilityLabel="Loading your account" aria-busy testID="Account-loading">
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.stack}>
          <Skeleton variant="rect" height={96} />
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} variant="rect" height={64} />
          ))}
        </View>
      </View>
    );
  } else if (failed || !profile) {
    body = (
      <View style={styles.stack}>
        <ErrorState
          variant="inline"
          errorCode={failed && query.kind === 'error' ? query.code : null}
          offline={!online}
          title={ACCOUNT_COPY.errorTitle}
          description={ACCOUNT_COPY.errorBody}
          onRetry={reload}
          testID="Account-error"
        />
        <Button variant="ghost" size="lg" fullWidth onPress={() => setSignOutOpen(true)} testID="Account-signout">
          Sign out
        </Button>
      </View>
    );
  } else {
    const defaultLine =
      addresses.query.kind === 'ready' ? addressesSubline(addresses.query.data, profile.default_address_id) : null;
    const notifLine = notificationsSubline(push.state, profile);
    const deletion = deletionText(support, supportEmail);
    body = (
      <View style={styles.stack}>
        <ProfileCard
          profile={profile}
          resend={resend}
          newEmail={newEmail}
          onEdit={() => setSheet('edit')}
          onAddEmail={() => setSheet('addEmail')}
          onResend={sendLink}
        />

        <SettingsGroup title="Ordering" testID="Account-ordering">
          <SettingsRow
            title="Addresses"
            icon="map"
            subline={defaultLine}
            sublineLoading={addresses.query.kind === 'loading'}
            onPress={() => nav.push({ name: 'addresses' })}
            testID="Account-addresses"
          />
        </SettingsGroup>

        <SettingsGroup title="Notifications and privacy" testID="Account-notifications">
          <SettingsRow
            title="Notification settings"
            icon="bell"
            subline={notifLine}
            onPress={() => nav.push({ name: 'notificationSettings' })}
            testID="Account-notificationSettings"
          />
        </SettingsGroup>

        <SettingsGroup title="Help and about" testID="Account-help">
          <SupportRow support={support} />
          <SettingsRow
            title="How we check halal certificates"
            subline="What we verify, and what we don't"
            icon="info"
            onPress={() => nav.push({ name: 'howWeCheck' })}
            testID="Account-howWeCheck"
          />
          {/* The board leaves the icon slot empty: `gift` is not in the design system's icon set. */}
          <SettingsRow
            title={WHATS_NEW.title}
            subline={WHATS_NEW.rowSubline(appVersion())}
            onPress={() => nav.push({ name: 'whatsNew' })}
            testID="Account-whatsNew"
          />
          <SettingsRow title="Terms and privacy" onPress={() => nav.push({ name: 'terms' })} testID="Account-terms" />
        </SettingsGroup>

        {deletion ? (
          <View style={styles.deletion} testID="Account-deletion">
            <Text accessibilityRole="header" aria-level={2} style={[headingSm, { color: theme.color.text.primary }]}>
              Delete your account
            </Text>
            <Text style={[smallStyle, { color: theme.color.text.secondary }]}>{deletion}</Text>
          </View>
        ) : null}

        <Button variant="tertiary" size="lg" fullWidth onPress={() => setSignOutOpen(true)} testID="Account-signout">
          Sign out
        </Button>
        {version ? (
          <Text style={[smallStyle, styles.version, { color: theme.color.text.secondary }]} testID="Account-version">
            HalalGoes {version}
          </Text>
        ) : null}
      </View>
    );
  }

  const offlineNote = !online && profile ? `Showing your account as of ${formatTime(query.kind === 'ready' ? query.asOf : now)}.` : null;

  return (
    <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="AccountScreen">
      <AppBar title={ACCOUNT_COPY.title} tone="cream" loading={loading} isPageHeading={!failed} />
      <ScrollView contentContainerStyle={[styles.content, { paddingHorizontal: theme.density.gutter }]} keyboardShouldPersistTaps="handled">
        {offlineNote ? (
          <Text style={[smallStyle, { color: theme.color.text.secondary }]} testID="Account-offline">
            {`You're offline. ${offlineNote}`}
          </Text>
        ) : null}
        {body}
      </ScrollView>

      {toast ? (
        <View pointerEvents="box-none" style={styles.toastDock}>
          <Toast
            variant={toast.variant}
            title={toast.title}
            description={toast.description}
            onDismiss={() => setToast(null)}
            testID="Account-toast"
          />
        </View>
      ) : null}

      {sheet && profile ? (
        <EditDetailsSheet
          profile={profile}
          mode={sheet}
          onClose={() => setSheet(null)}
          onSaved={(next, emailChanged) => {
            setSaved(next);
            setSheet(null);
            setNewEmail(emailChanged);
            setResend({ kind: 'idle' });
            setToast({
              variant: 'success',
              title: 'Details saved',
              description: emailChanged
                ? `We sent a link to ${next.email}. Open it to confirm your new email.`
                : undefined,
            });
          }}
        />
      ) : null}

      <Modal
        open={signOutOpen}
        onClose={() => setSignOutOpen(false)}
        variant="confirm"
        title={ACCOUNT_COPY.signOutTitle}
        description={ACCOUNT_COPY.signOutBody}
        actions={[
          { label: 'Stay signed in', onPress: () => setSignOutOpen(false) },
          { label: 'Sign out', destructive: true, onPress: () => signOut() },
        ]}
        testID="Account-signOutDialog"
      />
    </View>
  );
}

function SupportRow({ support }: { support: Support | null }): React.ReactElement | null {
  if (!support) return <SettingsRow title="Call support" sublineLoading testID="Account-support" />;
  if (support.kind === 'open') {
    return (
      <SettingsRow
        title="Call support"
        subline={`${support.hours ? `${support.hours}. ` : ''}Have your order code ready.`}
        onPress={() => callSupport(support.phoneE164)}
        testID="Account-support"
      />
    );
  }
  const orders = 'For a problem with an order, open it in Orders and choose Get help, then Report a problem.';
  return (
    <SettingsRow
      title={support.kind === 'closed' ? 'Phone support is closed now' : "Phone support isn't available right now"}
      subline={support.kind === 'closed' ? `Open ${support.hours}. ${orders}` : orders}
      testID="Account-support"
    />
  );
}

function ProfileCard({
  profile,
  resend,
  newEmail,
  onEdit,
  onAddEmail,
  onResend,
}: {
  profile: CustomerProfile;
  resend: Resend;
  newEmail: boolean;
  onEdit: () => void;
  onAddEmail: () => void;
  onResend: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const name = displayName(profile);
  const nameStyle = useTypeStyle('heading.md');
  const body = useTypeStyle('body.md');
  const small = useTypeStyle('body.sm');
  const limit = resend.kind === 'limited' ? resend.limit : null;
  const unconfirmed = Boolean(profile.email) && !profile.email_verified;

  return (
    <Card variant="outlined" radius={radius.lg} testID="Account-profile">
      <View style={styles.stack}>
        <View style={styles.identity}>
          <Avatar name={name || formatPhone(profile.phone_e164)} id={profile.account_id} src={profile.avatar_url ?? undefined} size="lg" />
          <View style={styles.identityText}>
            {name ? (
              <Text style={[nameStyle, { color: theme.color.text.primary }]} testID="Account-name">
                {name}
              </Text>
            ) : null}
            <Text style={[small, { color: theme.color.text.secondary }]} testID="Account-phone">
              {formatPhone(profile.phone_e164)}
            </Text>
          </View>
          <Button variant="tertiary" size="sm" accessibilityLabel="Edit your details" onPress={onEdit} testID="Account-edit">
            Edit
          </Button>
        </View>

        <View style={[styles.emailBlock, { borderTopColor: theme.color.border.decorative }]}>
          {profile.email ? (
            <>
              <View style={styles.emailRow}>
                <Text style={[body, { color: theme.color.text.primary }]} testID="Account-email">
                  {profile.email}
                </Text>
                {unconfirmed ? (
                  <Badge
                    variant="warning"
                    size="sm"
                    label={ACCOUNT_COPY.notConfirmed}
                    icon={<Icon name="warning" size={16} />}
                    testID="Account-unconfirmed"
                  />
                ) : null}
              </View>
              {unconfirmed ? (
                <>
                  <Text style={[small, { color: theme.color.text.secondary }]}>
                    {newEmail ? ACCOUNT_COPY.confirmHintNew : ACCOUNT_COPY.confirmHint}
                  </Text>
                  <View style={styles.start}>
                    <Button
                      variant="tertiary"
                      size="sm"
                      loading={resend.kind === 'sending'}
                      disabled={limit !== null}
                      onPress={onResend}
                      testID="Account-resend"
                    >
                      {ACCOUNT_COPY.resend}
                    </Button>
                  </View>
                  {limit?.kind === 'minute' ? (
                    <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[small, { color: theme.color.text.secondary }]} testID="Account-resendMinute">
                      {`You can ask for a new link at ${formatTime(limit.until)}.`}
                    </Text>
                  ) : null}
                  {limit?.kind === 'day' ? (
                    <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[small, { color: theme.color.text.secondary }]} testID="Account-resendDay">
                      {ACCOUNT_COPY.dayLimit}
                    </Text>
                  ) : null}
                </>
              ) : null}
            </>
          ) : (
            <>
              <Text style={[small, { color: theme.color.text.secondary }]}>{ACCOUNT_COPY.noEmail}</Text>
              <View style={styles.start}>
                <Button variant="tertiary" size="sm" iconStart="plus" onPress={onAddEmail} testID="Account-addEmail">
                  {ACCOUNT_COPY.addEmail}
                </Button>
              </View>
            </>
          )}
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingTop: space['2'], paddingBottom: space['6'], gap: space['6'] },
  stack: { gap: space['4'] },
  identity: { flexDirection: 'row', alignItems: 'center', gap: space['3'] },
  identityText: { flex: 1, minWidth: 0, gap: 2 },
  emailBlock: { gap: space['2'], paddingTop: space['3'], borderTopWidth: StyleSheet.hairlineWidth },
  emailRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space['2'] },
  start: { alignSelf: 'flex-start' },
  deletion: { gap: space['1'] },
  version: { textAlign: 'center' },
  toastDock: { position: 'absolute', left: space['4'], right: space['4'], bottom: space['4'] },
});
