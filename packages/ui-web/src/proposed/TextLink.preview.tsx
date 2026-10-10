/**
 * TextLink specimens (proposed, #737), after the restaurant sign-in boards (`SignIn-TooMany`,
 * `SignIn-LockedPermanent`, `Focus-States`). The live design system has no preview page for it,
 * so it is compared with the boards by eye.
 */

import { useEffect, useRef } from 'react';

import { TextLink } from './TextLink.js';

/** The proposed component's name. */
export const component = 'TextLink';

const sentence = { margin: 0, fontSize: 'var(--hg-text-body-sm-size)', color: 'var(--hg-text-secondary)', lineHeight: 1.5 };

/** Inside a sentence: weight 600, the sentence's size. */
export function Inline() {
  return (
    <p style={{ ...sentence, width: 416 }}>
      Forgot your password? <TextLink href="#forgot">Reset it by email</TextLink>.
    </p>
  );
}

/** On its own line: weight 500, body-md, 44px target. */
export function Standalone() {
  return (
    <div className="hg-specimen-col">
      <TextLink href="#sign-in" variant="standalone">Back to sign in</TextLink>
      <TextLink href="#register" variant="standalone">Register your restaurant</TextLink>
    </div>
  );
}

/** The support phone, as a tel: link inside the footer sentence. */
export function Tel() {
  return (
    <p style={{ ...sentence, width: 480, textAlign: 'center' }}>
      Need help signing in? Call partner support on <TextLink href="tel:+18005550199">1-800-555-0199</TextLink>,
      every day, 9 am to 9 pm.
    </p>
  );
}

/** Keyboard focus: the two-layer DS ring around the link. */
export function Focused() {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector('a')?.focus({ preventScroll: true });
  }, []);
  return (
    <div ref={box} style={{ padding: 8 }}>
      <TextLink href="#support" variant="standalone">Call partner support</TextLink>
    </div>
  );
}
