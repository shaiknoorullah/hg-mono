/**
 * KeyValueList specimens (approved; no live preview page yet): the admin order detail's
 * "People and place" list, stacked, loading and empty.
 */

import { Badge } from './Badge.js';
import { KeyValueList } from './KeyValueList.js';

/** The design-system component name. */
export const component = 'KeyValueList';

const ITEMS = [
  { label: 'Restaurant', value: 'Zaytoun Grill', helper: 'rst_01J9Z6' },
  { label: 'Restaurant halal status now', value: null, helper: "The restaurant's status today. It does not describe this order." },
  { label: 'Rider', value: 'Assigned · Bicycle' },
  { label: 'Delivery address', value: <Badge icon="lock">Masked</Badge> },
];

/** Label column and values, as drawn on admin OrderDetail. */
export function Columns() {
  return (
    <div className="hg-specimen-pane">
      <KeyValueList items={ITEMS} emptyValue="No halal status on file" />
    </div>
  );
}

/** Label above value, for narrow panes. */
export function Stacked() {
  return (
    <div className="hg-specimen-pane">
      <KeyValueList layout="stacked" items={ITEMS.slice(0, 2)} emptyValue="No halal status on file" />
    </div>
  );
}

/** Loading keeps the labels; empty says so. */
export function States() {
  return (
    <div className="hg-specimen-col hg-specimen-pane">
      <KeyValueList loading items={ITEMS.map(({ label }) => ({ label }))} />
      <KeyValueList items={[]} />
    </div>
  );
}

/** Dense rows with mono identifiers, for side panes (#699). */
export function Dense() {
  return (
    <div className="hg-specimen-pane">
      <KeyValueList
        dense
        labelWidth="9rem"
        items={[
          { label: 'Legal name', value: 'Zaytoun Grill Inc.' },
          { label: 'Certificate', value: 'HMA-2291-0047', mono: true },
          { label: 'Order', value: 'HG-7Q4K', mono: true },
          { label: 'Premises', value: null },
        ]}
      />
    </div>
  );
}
