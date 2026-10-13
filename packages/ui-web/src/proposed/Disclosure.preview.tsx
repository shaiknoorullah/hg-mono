/**
 * Disclosure specimens (proposed, packet P14), after `admin/rider-onboarding/FocusSpecimens`
 * and `restaurant/payouts/PartPayoutDetail`.
 */

import { Disclosure } from './index.js';

/** The proposed component's name. */
export const component = 'Disclosure';

/** Closed. */
export function Closed() {
  return (
    <div style={{ width: 360 }}>
      <Disclosure summary="Rider details">
        <p style={{ margin: 0 }}>Vehicle: bicycle</p>
      </Disclosure>
    </div>
  );
}

/** Open, with a nested disclosure inside. */
export function OpenNested() {
  return (
    <div style={{ width: 360 }}>
      <Disclosure summary="Payout B-2210 · fees" defaultOpen>
        <p style={{ margin: 0 }}>Platform fee and card processing for 41 orders.</p>
        <Disclosure summary="Adjustments (2)" headingLevel={4} appearance="plain" defaultOpen>
          <p style={{ margin: 0 }}>Goodwill credit on order B3M9.</p>
        </Disclosure>
      </Disclosure>
    </div>
  );
}
