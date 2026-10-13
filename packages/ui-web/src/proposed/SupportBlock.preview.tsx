/**
 * SupportBlock specimens (proposed, #737), after `SignIn-LockedPermanent` and
 * `Ref-SupportUnavailable`. The live design system has no preview page for it, so it is
 * compared with the boards by eye. The phone is the contract fixture's.
 */

import { SupportBlock } from './Support.js';

/** The proposed component's name. */
export const component = 'SupportBlock';

const box = { width: 416 };

/** support_enabled = true: label, the phone as a tel: link, hours. */
export function Available() {
  return (
    <div style={box}>
      <SupportBlock supportEnabled phoneE164="+18005550199" hours="Every day, 9 am to 9 pm" />
    </div>
  );
}

/** support_enabled = false: the replacement, no phone. */
export function Unavailable() {
  return (
    <div style={box}>
      <SupportBlock supportEnabled={false} phoneE164="+18005550199" />
    </div>
  );
}

/** The public config is still loading: a placeholder that names no number. */
export function Loading() {
  return (
    <div style={box}>
      <SupportBlock loading />
    </div>
  );
}
