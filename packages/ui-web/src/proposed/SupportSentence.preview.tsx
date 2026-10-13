/**
 * SupportSentence specimens (proposed, #737), after the footer sentence under the sign-in cards
 * (`SignIn-TooMany`, `SignIn-Locked`, `SignIn-ReuseDetected`). Compared with the boards by eye.
 */

import { SupportSentence } from './Support.js';

/** The proposed component's name. */
export const component = 'SupportSentence';

const config = { support_enabled: true, support_phone_e164: '+18005550199', support_hours: 'every day, 9 am to 9 pm' };

/** Under a sign-in card. */
export function Available() {
  return (
    <div style={{ width: 480 }}>
      <SupportSentence config={config} />
    </div>
  );
}

/** The "Partner support:" lead (SI `SignIn-Locked`). */
export function Lead() {
  return (
    <div style={{ width: 480 }}>
      <SupportSentence config={config} lead="Partner support:" />
    </div>
  );
}

/** support_enabled = false, with the board's fallback (SI `SignIn-ReuseDetected`). */
export function Fallback() {
  return (
    <div style={{ width: 480 }}>
      <SupportSentence
        config={{ support_enabled: false }}
        fallback="If you didn't expect this, contact HalalGoes after signing in."
      />
    </div>
  );
}
