/**
 * "Your details" — first-run profile capture (C-03), the Sign-in canvas's Profile capture board.
 *
 * Shown straight after the code when `verifyOtp` says `next_route = PROFILE_CAPTURE`, or when the
 * account has no first name. `first_name` is required; last name and email are optional
 * (`updateCustomerProfile`). The news-by-email box stays unticked and disabled until an email is
 * typed; once ticked, consent is recorded straight away and nothing is sent until the email is
 * confirmed (owner decision, docs/spec/02-customer.md "C-04 — Preferences", rule 6).
 *
 * After Save, a customer with no default address gets the address step; otherwise Home. "Not
 * you?" signs this phone out to Sign in with a first-run note.
 */
import * as React from 'react';
import { Text, View } from 'react-native';
import { isApiError } from '@hg/api-client';
import { AppBar, Button, Checkbox, Input, tokens, useTheme, useTypeStyle } from '@hg/ui-native';

import { logout } from '../api/auth';
import { updateProfile } from '../api/profile';
import { FlowLayout } from '../components/FlowLayout';
import { Notice } from '../components/Notice';
import { finishProfileCapture, noteSignedOut } from '../signin/session';

/** Loose on purpose: the server is the judge (422), this only catches the obvious slip. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function ProfileCaptureScreen(): React.ReactElement {
  const theme = useTheme();
  const body = useTypeStyle('body.md');
  const small = useTypeStyle('body.sm');

  const [first, setFirst] = React.useState('');
  const [last, setLast] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [consent, setConsent] = React.useState(false);
  const [errors, setErrors] = React.useState<{ first?: string; email?: string }>({});
  const [saving, setSaving] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const hasEmail = looksLikeEmail(email) && !errors.email;

  async function save(): Promise<void> {
    const next: { first?: string; email?: string } = {};
    if (!first.trim()) next.first = 'Enter your first name.';
    if (email.trim() && !looksLikeEmail(email)) {
      next.email = 'Enter an email like name@example.com, or leave it blank.';
    }
    setErrors(next);
    if (next.first || next.email) return;
    setFailed(false);
    setSaving(true);
    try {
      const profile = await updateProfile({
        first_name: first.trim(),
        ...(last.trim() ? { last_name: last.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(email.trim() && consent ? { marketing_consent: true } : {}),
      });
      finishProfileCapture(Boolean(profile.default_address_id));
    } catch (e) {
      const fields = isApiError(e) ? (e.details ?? []) : [];
      const emailRejected =
        isApiError(e) &&
        e.code === 'VALIDATION_FAILED' &&
        (Array.isArray(fields) ? fields.some((f) => f.field === 'email') : true);
      if (emailRejected && email.trim()) {
        setErrors({ email: "We couldn't use this email. Check it's typed correctly, or leave it blank." });
      } else {
        setFailed(true);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <FlowLayout
      testID="ProfileCaptureScreen"
      bodyGap={tokens.space['5']}
      appBar={<AppBar tone="cream" title="Your details" />}
      footer={
        <>
          <Button variant="primary" size="lg" fullWidth loading={saving} onPress={save} testID="Profile-save">
            {saving ? 'Saving' : 'Save and continue'}
          </Button>
          <Button
            variant="ghost"
            size="lg"
            fullWidth
            onPress={() => {
              noteSignedOut('notYou');
              logout();
            }}
          >
            Not you? Use a different number
          </Button>
        </>
      }
    >
      <Text style={[body, { color: theme.color.text.secondary }]}>
        Tell us what to call you. Only your first name is needed to order.
      </Text>

      {failed ? (
        <Notice
          tone="warning"
          icon="warning"
          title="We couldn't save your details"
          description="What you typed is still here. Check your connection and try again."
          testID="Profile-error"
        />
      ) : null}

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
            errors.email
              ? undefined
              : "For your account and, only if you tick the box below, news from us. We'll send a link to confirm it."
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
          />
          {/* The reason sits outside the dimmed box in text.secondary (Sign-in canvas, DS issue 1). */}
          <Text style={[small, { color: theme.color.text.secondary, paddingLeft: 32 }]}>
            {hasEmail
              ? "We'll only start once you confirm your email with the link we send. You can turn this off at any time in Account."
              : 'Add an email first to get news by email.'}
          </Text>
        </View>
      </View>
    </FlowLayout>
  );
}
