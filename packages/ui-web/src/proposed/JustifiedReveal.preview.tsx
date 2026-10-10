/**
 * JustifiedReveal specimens, after the email row of the canvas board
 * `admin/rider-onboarding/DetailReview` (modes `pii*`; a proposed composite, compared by eye).
 */

import { JustifiedReveal } from './JustifiedReveal.js';

/** Grouped under its own heading in the preview. */
export const component = 'JustifiedReveal';

const pane = { width: 440 } as const;
const reveal = async () => 'fatima.noor@gmail.com';

/** Masked, with Reveal. */
export function Masked() {
  return (
    <div style={pane}>
      <JustifiedReveal fieldLabel="email" maskedValue="f••••••••@gmail.com" onReveal={reveal} />
    </div>
  );
}

/** Choosing a reason (opened on mount for the specimen). */
export function Asking() {
  return (
    <div style={pane}>
      <JustifiedReveal fieldLabel="email" maskedValue="f••••••••@gmail.com" onReveal={reveal} defaultOpen />
    </div>
  );
}

/** Revealed (controlled). */
export function Revealed() {
  return (
    <div style={pane}>
      <JustifiedReveal fieldLabel="email" maskedValue="f••••••••@gmail.com" onReveal={reveal} revealed="fatima.noor@gmail.com" />
    </div>
  );
}

/** Denied by role: the reveal stays off and says why. */
export function Denied() {
  return (
    <div style={pane}>
      <JustifiedReveal fieldLabel="email" maskedValue="f••••••••@gmail.com" onReveal={reveal} denied defaultOpen />
    </div>
  );
}
