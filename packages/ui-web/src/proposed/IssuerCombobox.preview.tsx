/**
 * IssuerCombobox specimens, after the canvas board `admin/restaurant-verification/Verify-IssuerList`
 * (a proposed composite, compared with the board by eye). Every registry status is in the list.
 */

import { IssuerCombobox, type IssuerOption } from './IssuerCombobox.js';

/** Grouped under its own heading in the preview. */
export const component = 'IssuerCombobox';

const noop = () => {};
const pane = { width: 420 } as const;
const issuers: IssuerOption[] = [
  { id: 'b1', name: 'Halal Monitoring Authority (HMA Canada)', status: 'ACCEPTED' },
  { id: 'b2', name: 'ISNA Canada Halal', status: 'ACCEPTED' },
  { id: 'b3', name: 'Halal Food Standards Alliance of America (HFSAA)', status: 'SUSPENDED' },
  { id: 'b4', name: 'Halal Certification Council of Ontario (HCCO)', status: 'PROPOSED' },
  { id: 'b5', name: 'Canadian Halal Bureau', status: 'RETIRED' },
  { id: 'b6', name: 'Northern Halal Registry', status: 'REJECTED' },
];

/** Accepted body chosen. */
export function Chosen() {
  return (
    <div style={pane}>
      <IssuerCombobox label="Issuing body" issuers={issuers} value="b1" onValueChange={noop} onPropose={noop} />
    </div>
  );
}

/** A suspended body chosen: its status in words, warning tone, never danger. */
export function Suspended() {
  return (
    <div style={pane}>
      <IssuerCombobox label="Issuing body" issuers={issuers} value="b3" onValueChange={noop} />
    </div>
  );
}

/** Nothing chosen yet, with a field error. */
export function Invalid() {
  return (
    <div style={pane}>
      <IssuerCombobox label="Issuing body" issuers={issuers} value={null} onValueChange={noop} errorText="Choose the body printed on the certificate." />
    </div>
  );
}
