/**
 * Sign-in and account emails: confirming a restaurant's email address,
 * resetting a password, and inviting staff. Each carries one single-use link;
 * the token in it is the only secret any HalalGoes email contains
 * (docs/spec/01-platform.md, "P-24 — Notification router", rule I-24.5:
 * no notification body contains a token, so the link travels only to the
 * email provider, never into the in-app inbox).
 */
import { Action, Layout, P } from '../components/Layout.js';
import { defineTemplate } from '../define.js';

/** The restaurant sign-up email that confirms the address. */
export const emailVerification = defineTemplate({
  name: 'email_verification',
  vars: ['ActionURL', 'ExpiresAt'] as const,
  subject: () => 'Confirm your email for HalalGoes',
  render: (v) => (
    <Layout
      preview="Confirm your email to finish setting up your restaurant on HalalGoes."
      heading="Confirm your email address"
    >
      <P>
        Welcome to HalalGoes. Confirm this is your email address to keep setting up your
        restaurant.
      </P>
      <Action href={v.ActionURL}>Confirm email</Action>
      <P muted>
        The link works once, until {v.ExpiresAt}. If you did not sign up for HalalGoes, you can
        ignore this email and nothing will happen.
      </P>
    </Layout>
  ),
});

/** The forgot-password email. */
export const passwordReset = defineTemplate({
  name: 'password_reset',
  vars: ['ActionURL', 'ExpiresAt'] as const,
  subject: () => 'Reset your HalalGoes password',
  render: (v) => (
    <Layout
      preview="Use this link to choose a new HalalGoes password."
      heading="Reset your password"
    >
      <P>Someone asked to reset the password for your HalalGoes account. To choose a new one, use the button below.</P>
      <Action href={v.ActionURL}>Choose a new password</Action>
      <P muted>
        The link works once, until {v.ExpiresAt}. Choosing a new password signs you out on every
        device. If you did not ask for this, ignore this email: your password stays the same.
      </P>
    </Layout>
  ),
});

/**
 * The invitation to a new HalalGoes staff account to set its password. It holds
 * nothing the inviter typed: only the role, from a fixed list.
 */
export const staffInvite = defineTemplate({
  name: 'staff_invite',
  vars: ['RoleLabel', 'ActionURL', 'ExpiresAt'] as const,
  subject: () => "You're invited to join the HalalGoes team",
  render: (v) => (
    <Layout
      preview="Set your password to join the HalalGoes team."
      heading="You're invited to HalalGoes"
      footer="You are receiving this because someone at HalalGoes invited this address. If you were not expecting it, you can ignore it."
    >
      <P>
        You have been invited to join the HalalGoes team as {v.RoleLabel}. Set a password to accept
        the invitation.
      </P>
      <Action href={v.ActionURL}>Set your password</Action>
      <P muted>
        The link works once, until {v.ExpiresAt}. After you set your password you will be asked to
        turn on two-step sign-in.
      </P>
    </Layout>
  ),
});

/**
 * The security alert: the account's password was changed or reset, or it
 * signed in on a device it has not used before (docs/spec/01-platform.md,
 * "P-24 — Notification router": new-device sign-in and password changed go by
 * email to every role). It has no link and no button, so it can never be used
 * to sign anyone in, and it never names an IP address: only what happened,
 * when, the coarse place when known, and what to do if it wasn't the reader.
 */
export const securityAlert = defineTemplate({
  name: 'security_alert',
  vars: ['Heading', 'Summary', 'When', 'Place', 'IfNotYou'] as const,
  subject: (v) => v.Heading,
  render: (v) => (
    <Layout
      preview={v.Summary}
      heading={v.Heading}
      footer="You are receiving this because it is about the security of your HalalGoes account. We send it for every password change and every new device."
    >
      <P>{v.Summary}</P>
      <P>
        When: {v.When}
        <br />
        Where: {v.Place}
      </P>
      <P>If this was you, there is nothing to do.</P>
      <P>{v.IfNotYou}</P>
      <P muted>HalalGoes will never ask for your password or a sign-in code by email, text or phone.</P>
    </Layout>
  ),
});
