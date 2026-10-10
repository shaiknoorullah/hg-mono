/**
 * StateCard specimens (proposed, #737), after the restaurant sign-in boards (`Main`,
 * `SignIn-NotRestaurant`, `Verify-Working`, `Reset-Done`, `Phone-Register-320`). The live design
 * system has no preview page for it, so it is compared with the boards by eye.
 */

import type { ReactNode } from 'react';

import { Button } from '../ds/Button.js';
import { Input } from '../ds/Input.js';
import { ProgressBar } from './ProgressBar.js';
import { StateCard } from './StateCard.js';
import { SupportBlock } from './Support.js';
import { TextLink } from './TextLink.js';

/** The proposed component's name. */
export const component = 'StateCard';

function Page({ children }: { children: ReactNode }) {
  return <div style={{ width: 480, maxWidth: '100%' }}>{children}</div>;
}

/** A form card: Sign in (SI `Main`). */
export function SignInForm() {
  return (
    <Page>
      <StateCard
        heading="Sign in to your restaurant"
        description="Use the email and password you registered with."
        onSubmit={(e) => e.preventDefault()}
      >
        <Input label="Email" variant="email" autoComplete="username" defaultValue="samir@zaytoungrill.ca" />
        <Input label="Password" variant="password" autoComplete="current-password" />
        <Button variant="primary" size="lg" fullWidth type="submit">Sign in</Button>
        <p style={{ margin: 0, fontSize: 'var(--hg-text-body-sm-size)', color: 'var(--hg-text-secondary)' }}>
          Forgot your password? <TextLink href="#forgot">Reset it by email</TextLink>.
        </p>
      </StateCard>
    </Page>
  );
}

/** An account-state card with the icon tile (SI `SignIn-NotRestaurant`). */
export function AccountState() {
  return (
    <Page>
      <StateCard
        icon="info"
        heading="This isn't a restaurant account"
        description="samir.h@gmail.com signed in, but it has no restaurant on HalalGoes. It may be a customer or rider account. Restaurant partners sign in with the email they registered the restaurant with."
      >
        <Button variant="primary" size="lg" fullWidth href="#sign-in">Sign in with a different email</Button>
        <TextLink href="#register" variant="standalone">Register your restaurant</TextLink>
      </StateCard>
    </Page>
  );
}

/** Locked until support unlocks it, with the support block (SI `SignIn-LockedPermanent`). */
export function Locked() {
  return (
    <Page>
      <StateCard
        icon="lock"
        heading="This account is locked"
        description="For your security, only partner support can unlock samir@zaytoungrill.ca. They'll check who you are first. Resetting your password won't unlock it."
      >
        <SupportBlock supportEnabled phoneE164="+18005550199" hours="every day, 9 am to 9 pm" />
        <TextLink href="#sign-in" variant="standalone">Back to sign in</TextLink>
      </StateCard>
    </Page>
  );
}

/** Working: the card is busy (SI `Verify-Working`). */
export function Working() {
  return (
    <Page>
      <StateCard
        busy
        heading="Confirming your email"
        description="This only takes a moment. You'll go straight to setting up your restaurant."
      >
        <ProgressBar label="Confirming your email…" tone="neutral" />
      </StateCard>
    </Page>
  );
}

/** Done, with the check tile (SI `Reset-Done`). */
export function Done() {
  return (
    <Page>
      <StateCard
        icon="check"
        heading="Your new password is set"
        description="You're signed out on every device, including your order screen. Sign in with your new password, then open the order screen again so new orders reach it."
      >
        <Button variant="primary" size="lg" fullWidth href="#sign-in">Sign in</Button>
      </StateCard>
    </Page>
  );
}

/** Reflow at 320 CSS px: 24px padding (SI `Phone-Register-320`). */
export function Reflow320() {
  return (
    <div style={{ width: 320, padding: 16, boxSizing: 'border-box' }}>
      <StateCard heading="Register your restaurant" description="Create the owner account.">
        <Input label="Your full name" defaultValue="Samir Haddad" />
      </StateCard>
    </div>
  );
}
