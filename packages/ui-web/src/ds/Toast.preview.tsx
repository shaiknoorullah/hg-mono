/**
 * Toast specimens for the design preview. `Full` mirrors the live components/Toast/preview.html
 * (no labelled rows, so it pairs with the reference's `full`).
 */

import { Toast } from './Toast.js';

/** The design system's component name, pairing these specimens with its preview page. */
export const component = 'Toast';

const noop = () => undefined;

/** The reference page: neutral with Undo, success, info, warning, danger. */
export function Full() {
  return (
    <div className="hg-specimen-col" style={{ width: 440 }}>
      <Toast variant="neutral" title="Address saved" action={{ label: 'Undo', onAction: noop }} onDismiss={noop} />
      <Toast variant="success" title="Certificate approved" description="Zaytoun Grill is eligible to go live." />
      <Toast variant="info" title="Menu synced" description="Changes are live for customers." />
      <Toast variant="warning" title="Certificate expires in 21 days" description="Upload the renewal to stay listed." />
      <Toast variant="danger" title="Payment declined" description="Try another card. Your cart is saved." onDismiss={noop} />
    </div>
  );
}
