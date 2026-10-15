/**
 * A9 Email link verification, opened from the emailed link (`hgcustomer://verify-email?token=...`;
 * boards `AC/EmailVerify-checking`, `EmailVerify`, `-successconsent`, `-error`, `-expired`,
 * `-expiredsending`, `-expiredsent`, `-expiredlimited`, `-expiredday`, `-used`, `-usedconfirmed`,
 * `-usedunconfirmed`, `-dark`, `-error-dark`, `-lt`).
 *
 * The page calls `verifyEmail` once on arrival; it issues no session, so this only runs for a
 * customer who is already signed in (the link opens on the Account tab). The result is one of:
 *
 * - confirmed: "Your email is confirmed", naming the address from `getCustomerProfile`, and whether
 *   news by email starts now (`marketing_consent_at` set) or stays off.
 * - run out (410 `VERIFICATION_TOKEN_EXPIRED`): "Send a new link" calls `resendEmailVerification`
 *   for the profile's email, with its sending, sent, per-minute and per-day states as on Account.
 * - already used (410 `VERIFICATION_TOKEN_USED`): the profile says whether the email is confirmed
 *   (`email_verified`); if the profile cannot be read, the neutral "already used" page.
 * - a connection or server failure: "Try again". The link still works.
 *
 * Result pages have no live region: focus moves to the heading on arrival.
 *
 * Not built: the browser page and "link was for another account" (the 204 does not say whose
 * email it was), and the signed-out page, which needs a deep link to be accepted before sign-in.
 * The tracking issue lists them.
 */
import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  AppBar,
  Button,
  EmptyState,
  Icon,
  Skeleton,
  space,
  useTheme,
  useTypeStyle,
} from '../ds';
import { getNow } from '../lib/now';
import { useNav } from '../navigation/context';
import { formatTime } from '../lib/time';
import { getProfile, resendEmailLink, verifyEmailToken, VerifyError } from './accountApi';
import type { CustomerProfile, ResendLimit } from './rules';

type IconName = React.ComponentProps<typeof Icon>['name'];

export type VerifyPhase =
  | { kind: 'checking' }
  | { kind: 'confirmed'; profile: CustomerProfile | null }
  | { kind: 'expired'; profile: CustomerProfile | null }
  | { kind: 'used'; profile: CustomerProfile | null }
  | { kind: 'failed' };

type Resend = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'limited'; limit: ResendLimit };

export const VERIFY_COPY = {
  checkingTitle: 'Confirming your email',
  checkingBody: 'This takes a moment.',
  confirmedTitle: 'Your email is confirmed',
  newsOff: 'News and offers still come only if you turn them on in Notification settings.',
  newsOn: 'News and offers by email start now. You can turn them off in Notification settings.',
  failedTitle: "We couldn't confirm your email",
  failedBody: 'The problem is with the connection or on our side. The link still works, so try again.',
  failedMore: 'Links work for 24 hours after we send them.',
  expiredTitle: 'This link has run out',
  sentTitle: 'We sent a new link',
  usedTitle: 'This link was already used',
  usedBody: 'Each link works once. If you opened it before, your email may already be confirmed.',
  usedMore: 'Check Account to see.',
  usedConfirmedTitle: 'Your email is already confirmed',
  usedConfirmedBody: 'You opened this link before, so there is nothing more to do.',
  usedUnconfirmedBody: "Your email isn't confirmed yet. Send a new link to confirm it.",
  dayLimit: "You've asked 5 times today. Try again tomorrow.",
} as const;

/** What the page shows for a phase; pure, so every board's wording is testable without a screen. */
export function verifyContent(
  phase: VerifyPhase,
  resend: Resend,
): { icon: IconName; title: string; body: string; more?: string; status?: string; primary: 'account' | 'retry' | 'resend'; secondary?: 'account' } {
  const email = phase.kind === 'checking' || phase.kind === 'failed' ? null : phase.profile?.email ?? null;
  if ((phase.kind === 'expired' || phase.kind === 'used') && resend.kind === 'sent') {
    return {
      icon: 'check',
      title: VERIFY_COPY.sentTitle,
      body: `Open the email we sent to ${email}. The new link works for 24 hours.`,
      primary: 'account',
    };
  }
  switch (phase.kind) {
    case 'checking':
      return { icon: 'clock', title: VERIFY_COPY.checkingTitle, body: VERIFY_COPY.checkingBody, primary: 'account' };
    case 'failed':
      return { icon: 'warning', title: VERIFY_COPY.failedTitle, body: VERIFY_COPY.failedBody, more: VERIFY_COPY.failedMore, primary: 'retry' };
    case 'confirmed': {
      const consent = Boolean(phase.profile?.marketing_consent_at);
      return {
        icon: 'check',
        title: VERIFY_COPY.confirmedTitle,
        body: email ? `We can now email you at ${email}.` : 'We can now email you.',
        more: phase.profile ? (consent ? VERIFY_COPY.newsOn : VERIFY_COPY.newsOff) : undefined,
        primary: 'account',
      };
    }
    case 'expired': {
      const limited = resend.kind === 'limited' ? resend.limit : null;
      return {
        icon: 'clock',
        title: VERIFY_COPY.expiredTitle,
        body: limited?.kind === 'day'
          ? 'Confirmation links work for 24 hours.'
          : email
            ? `Confirmation links work for 24 hours. We'll send a new one to ${email}.`
            : 'Confirmation links work for 24 hours.',
        status:
          limited?.kind === 'minute'
            ? `You can ask for a new link at ${formatTime(limited.until)}.`
            : limited?.kind === 'day'
              ? VERIFY_COPY.dayLimit
              : undefined,
        primary: email ? 'resend' : 'account',
        secondary: email ? 'account' : undefined,
      };
    }
    case 'used': {
      const profile = phase.profile;
      if (profile?.email_verified) {
        return {
          icon: 'check',
          title: VERIFY_COPY.usedConfirmedTitle,
          body: VERIFY_COPY.usedConfirmedBody,
          more: profile.email ? `We can email you at ${profile.email}.` : undefined,
          primary: 'account',
        };
      }
      if (profile && profile.email) {
        const limited = resend.kind === 'limited' ? resend.limit : null;
        return {
          icon: 'info',
          title: VERIFY_COPY.usedTitle,
          body: VERIFY_COPY.usedUnconfirmedBody,
          status:
            limited?.kind === 'minute'
              ? `You can ask for a new link at ${formatTime(limited.until)}.`
              : limited?.kind === 'day'
                ? VERIFY_COPY.dayLimit
                : undefined,
          primary: 'resend',
          secondary: 'account',
        };
      }
      return { icon: 'info', title: VERIFY_COPY.usedTitle, body: VERIFY_COPY.usedBody, more: VERIFY_COPY.usedMore, primary: 'account' };
    }
  }
}

async function readProfile(): Promise<CustomerProfile | null> {
  try {
    return await getProfile();
  } catch {
    return null;
  }
}

export function EmailVerifyScreen({ token }: { token: string }): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const small = useTypeStyle('body.sm');
  const h1 = useTypeStyle('heading.lg');
  const bodyStyle = useTypeStyle('body.md');
  const [phase, setPhase] = React.useState<VerifyPhase>({ kind: 'checking' });
  const [resend, setResend] = React.useState<Resend>({ kind: 'idle' });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let live = true;
    setPhase({ kind: 'checking' });
    verifyEmailToken(token)
      .then(async () => {
        const profile = await readProfile();
        if (live) setPhase({ kind: 'confirmed', profile });
      })
      .catch(async (e: unknown) => {
        const code = e instanceof VerifyError ? e.code : null;
        if (code === 'VERIFICATION_TOKEN_EXPIRED' || code === 'VERIFICATION_TOKEN_USED') {
          const profile = await readProfile();
          if (live) setPhase({ kind: code === 'VERIFICATION_TOKEN_EXPIRED' ? 'expired' : 'used', profile });
        } else if (live) {
          setPhase({ kind: 'failed' });
        }
      });
    return () => {
      live = false;
    };
  }, [token, attempt]);

  const profile = phase.kind === 'expired' || phase.kind === 'used' ? phase.profile : null;
  const content = verifyContent(phase, resend);

  async function sendNewLink(): Promise<void> {
    if (!profile?.email || resend.kind === 'sending') return;
    setResend({ kind: 'sending' });
    try {
      const result = await resendEmailLink(profile.email);
      if (result.ok) setResend({ kind: 'sent' });
      else if (result.limit) setResend({ kind: 'limited', limit: result.limit });
      else setResend({ kind: 'idle' });
    } catch {
      setResend({ kind: 'idle' });
    }
  }

  const limited = resend.kind === 'limited';
  // A minute limit lifts at its static time.
  React.useEffect(() => {
    if (resend.kind === 'limited' && resend.limit.kind === 'minute') {
      const wait = resend.limit.until - getNow();
      const t = setTimeout(() => setResend({ kind: 'idle' }), Math.max(wait, 0));
      return () => clearTimeout(t);
    }
    return undefined;
  }, [resend]);

  const goAccount = () => nav.reset({ name: 'account' });
  const actions =
    content.primary === 'account'
      ? { label: 'Go to Account', onPress: goAccount }
      : content.primary === 'retry'
        ? { label: 'Try again', onPress: () => setAttempt((n) => n + 1) }
        : { label: resend.kind === 'sending' ? 'Sending link' : 'Send a new link', onPress: sendNewLink, loading: resend.kind === 'sending', disabled: limited };

  return (
    <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="EmailVerifyScreen">
      <AppBar title="Confirm your email" tone="cream" isPageHeading={false} loading={phase.kind === 'checking'} />
      <ScrollView contentContainerStyle={[styles.content, { paddingHorizontal: theme.density.gutter }]}>
        {phase.kind === 'checking' ? (
          <View accessibilityRole="progressbar" accessibilityLabel="Checking your link" aria-busy style={styles.center} testID="EmailVerify-checking">
            <Icon name="clock" size={48} color={theme.color.text.secondary} />
            <Text style={[h1, { color: theme.color.text.primary, textAlign: 'center' }]}>{content.title}</Text>
            <Text style={[bodyStyle, { color: theme.color.text.secondary, textAlign: 'center' }]}>{content.body}</Text>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.skeleton}>
              <Skeleton variant="text" width="60%" height={12} />
            </View>
          </View>
        ) : (
          <View style={styles.center}>
            <EmptyState
              variant="page"
              headingLevel={1}
              autoFocus
              illustration={<Icon name={content.icon} size={48} color={theme.color.text.secondary} />}
              title={content.title}
              description={[content.body, content.more].filter(Boolean).join(' ')}
              primaryAction={actions}
              secondaryAction={content.secondary ? { label: 'Go to Account', onPress: goAccount } : undefined}
              testID={`EmailVerify-${phase.kind}`}
            />
            {content.status ? (
              <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[small, { color: theme.color.text.secondary, textAlign: 'center' }]} testID="EmailVerify-status">
                {content.status}
              </Text>
            ) : null}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', paddingVertical: space['6'] },
  center: { alignItems: 'center', gap: space['4'] },
  skeleton: { alignSelf: 'stretch', alignItems: 'center' },
});
