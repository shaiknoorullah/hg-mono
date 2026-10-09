/**
 * S3 Your details: first-run profile capture (boards `SI/ProfileCapture`, `SI/Profile-*`), ported
 * from #635's `ProfileCaptureScreen` onto design-system components.
 *
 * Two ways in:
 * - First run: the Shell shows it in session phase `profile` (`next_route = PROFILE_CAPTURE`, or an
 *   account with no first name). After Save, a customer with no default address gets the address
 *   step; otherwise Home. "Not you? Use a different number" signs this phone out to Sign in with
 *   the "Not you?" note.
 * - From the cart (`{ name: 'yourDetails', fromCart: true }`, checkout's `PROFILE_INCOMPLETE`):
 *   "Back to cart", and "Save and go to checkout" replaces this page with Checkout.
 *
 * `first_name` is required; last name and email are optional. The news-by-email box stays unticked
 * and disabled until an email is typed, and its reason is a separate text.secondary paragraph
 * outside the control (Sign-in canvas, DS issue 1). Consent is sent with the details; nothing is
 * emailed until the address is confirmed (decision log). Save stays enabled and validates on press;
 * only offline disables it, with the reason as its hint.
 */
import * as React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { isApiError, unwrap } from '@hg/api-client';
import type { Schema } from '@hg/api-client';

import { signOut } from '../api/auth';
import { api } from '../api/client';
import { AppBar, Banner, Button, Checkbox, Icon, Input, Skeleton, tokens, useTheme, useTypeStyle } from '../ds';
import { useConnectivity } from '../lib/connectivity';
import { NavContext } from '../navigation/context';
import { finishProfileCapture } from '../session/session';

type CustomerProfile = Schema['CustomerProfile'];
type ProfileInput = Schema['CustomerProfileUpdateInput'];

/** Loose on purpose: the server is the judge (422); this only catches the obvious slip. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** What Save sends: ids and text only, never anything the server works out. */
export function profileInput(first: string, last: string, email: string, consent: boolean): ProfileInput {
  return {
    first_name: first.trim(),
    ...(last.trim() ? { last_name: last.trim() } : {}),
    ...(email.trim() ? { email: email.trim() } : {}),
    ...(email.trim() && consent ? { marketing_consent: true } : {}),
  };
}

const EMAIL_FORMAT = 'Enter an email like name@example.com, or leave it blank.';
const EMAIL_REJECTED = "We couldn't use this email. Check it's typed correctly, or leave it blank.";

export function YourDetailsScreen({ fromCart = false }: { fromCart?: boolean }): React.ReactElement {
  const theme = useTheme();
  const nav = React.useContext(NavContext);
  const body = useTypeStyle('body.md');
  const small = useTypeStyle('body.sm');
  const { online } = useConnectivity();
  const offline = !online;

  const [loading, setLoading] = React.useState(true);
  const [first, setFirst] = React.useState('');
  const [last, setLast] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [consent, setConsent] = React.useState(false);
  const [errors, setErrors] = React.useState<{ first?: string; email?: string }>({});
  const [saving, setSaving] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  // Fill in what the account already has (a returning customer from the cart may have an email).
  // A failed read leaves the form empty: nothing is lost, the customer types it.
  React.useEffect(() => {
    let live = true;
    unwrap(api.GET('/v1/me/profile'))
      .then((res) => {
        if (!live) return;
        const p = res.data as CustomerProfile;
        setFirst(p.first_name ?? '');
        setLast(p.last_name ?? '');
        setEmail(p.email ?? '');
      })
      .catch(() => {})
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const hasEmail = looksLikeEmail(email) && !errors.email;

  async function save(): Promise<void> {
    const next: { first?: string; email?: string } = {};
    if (!first.trim()) next.first = 'Enter your first name.';
    if (email.trim() && !looksLikeEmail(email)) next.email = EMAIL_FORMAT;
    setErrors(next);
    if (next.first || next.email) return;
    setFailed(false);
    setSaving(true);
    try {
      const res = await unwrap(api.PATCH('/v1/me/profile', { body: profileInput(first, last, email, consent) }));
      const profile = res.data as CustomerProfile;
      if (fromCart && nav) {
        nav.replace({ name: 'checkout' });
        return;
      }
      finishProfileCapture(Boolean(profile.default_address_id));
    } catch (e) {
      setSaving(false);
      const details = isApiError(e) ? e.details : undefined;
      const emailRejected =
        isApiError(e) &&
        e.code === 'VALIDATION_FAILED' &&
        (Array.isArray(details) ? details.some((f: { field?: string }) => f.field === 'email') : true);
      if (emailRejected && email.trim()) setErrors({ email: EMAIL_REJECTED });
      else setFailed(true);
    }
  }

  const fields = loading ? (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading your details" testID="Profile-loading">
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ gap: tokens.space['4'] }}>
        <Skeleton variant="rect" height={48} />
        <Skeleton variant="rect" height={48} />
        <Skeleton variant="rect" height={48} />
      </View>
    </View>
  ) : (
    <View style={{ gap: tokens.space['4'] }}>
      <Input
        label="First name"
        required
        autoComplete="given-name"
        maxLength={50}
        value={first}
        onChange={(v) => {
          setFirst(v);
          if (errors.first) setErrors({ ...errors, first: undefined });
        }}
        readOnly={saving}
        errorText={errors.first}
        testID="Profile-first"
      />
      <Input
        label="Last name (optional)"
        autoComplete="family-name"
        maxLength={50}
        value={last}
        onChange={setLast}
        readOnly={saving}
        testID="Profile-last"
      />
      <Input
        label="Email (optional)"
        variant="email"
        autoComplete="email"
        maxLength={254}
        value={email}
        onChange={(v) => {
          setEmail(v);
          if (errors.email) setErrors({ ...errors, email: undefined });
          if (!v.trim()) setConsent(false);
        }}
        readOnly={saving}
        helperText={
          errors.email ? undefined : "For your account and, only if you tick the box below, news from us. We'll send a link to confirm it."
        }
        errorText={errors.email}
        testID="Profile-email"
      />
      <View>
        <Checkbox
          label="Email me news and offers from HalalGoes"
          checked={consent && hasEmail}
          disabled={!hasEmail}
          onChange={setConsent}
          testID="Profile-consent"
        />
        <Text nativeID="consent-why" style={[small, { color: theme.color.text.secondary, paddingLeft: 32 }]}>
          {hasEmail
            ? "We'll only start once you confirm your email with the link we send. You can turn this off at any time in Account."
            : 'Add an email first to get news by email.'}
        </Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="YourDetailsScreen">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        <AppBar
          title="Your details"
          back={fromCart && nav ? { onPress: nav.back, previousTitle: 'cart' } : undefined}
        />
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: tokens.space['4'], paddingTop: tokens.space['2'], paddingBottom: tokens.space['4'], gap: tokens.space['5'] }}
        >
          <Text style={[body, { color: theme.color.text.secondary }]}>
            Tell us what to call you. Only your first name is needed to order.
          </Text>
          {fromCart ? (
            <Banner
              variant="info"
              title="Add your name to order"
              description="Your cart is saved. We'll take you back to it when you're done."
              icon={<Icon name="cart" size={24} color={theme.color.text.secondary} />}
              testID="Profile-fromcart"
            />
          ) : null}
          {failed ? (
            <Banner
              variant="warning"
              title="We couldn't save your details"
              description="What you typed is still here. Check your connection and try again."
              testID="Profile-error"
            />
          ) : null}
          {offline ? (
            <Banner
              variant="neutral"
              title="You're offline"
              description="What you type stays here. Connect to Wi-Fi or mobile data to save it."
              testID="Profile-offline"
            />
          ) : null}
          {fields}
        </ScrollView>
        <View style={{ paddingHorizontal: tokens.space['4'], paddingBottom: tokens.space['4'], paddingTop: tokens.space['2'], gap: tokens.space['3'] }}>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            loading={saving}
            disabled={offline}
            accessibilityHint={offline ? 'Connect to the internet to save.' : undefined}
            onPress={save}
            testID="Profile-save"
          >
            {saving ? 'Saving' : fromCart ? 'Save and go to checkout' : 'Save and continue'}
          </Button>
          {offline ? (
            <Text style={[small, styles.center, { color: theme.color.text.secondary }]}>Connect to the internet to save.</Text>
          ) : null}
          <Button variant="ghost" size="lg" fullWidth onPress={() => signOut('notYou')} testID="Profile-notyou">
            Not you? Use a different number
          </Button>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { textAlign: 'center' },
});
