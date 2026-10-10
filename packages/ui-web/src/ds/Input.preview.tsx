/**
 * Input specimens for the design preview. `full` mirrors the live components/Input/preview.html
 * (it has no labelled rows, so the whole page is the one state); the others show the additions.
 * Layout is inline style, not Tailwind, so these files add nothing to the released apps' CSS.
 */

import { useState, type CSSProperties } from 'react';

import { Input } from './Input.js';

/** The live design system's component name. */
export const component = 'Input';

const G2: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: 16,
  alignItems: 'start',
  width: 1408,
};

/** The reference page: tel, email error, search, otp, success, counter + loading, read-only, disabled. */
export function Full() {
  const [code, setCode] = useState('');
  return (
    <div style={G2}>
      <Input label="Mobile number" variant="tel" placeholder="(416) 555-0134" helperText="We text a code to sign you in." required />
      <Input label="Email" variant="email" defaultValue="chef@zaytoun" errorText="Enter a valid email address" />
      <Input label="Search" variant="search" placeholder="Biryani, shawarma, grill" />
      <Input label="Sign-in code" variant="otp" value={code} onValueChange={setCode} helperText="Six digits. Paste works." />
      <Input label="Promo code" defaultValue="EID2026" success />
      <Input label="Delivery instructions" maxLength={40} characterCount defaultValue="Side door, ring twice" loading />
      <Input label="Restaurant ID" defaultValue="rst_01JBX7Q2" readOnly />
      <Input label="Legal name" disabled defaultValue="Zaytoun Grill Inc." />
    </div>
  );
}

/** Sizes md 44, lg 52 and the packet's field 56, and the 4-cell handover code. */
export function SizesAndOtp4() {
  return (
    <div style={G2}>
      <Input label="md (44)" placeholder="Default" />
      <Input label="lg (52)" size="lg" placeholder="Large" />
      <Input label="field (56)" size="field" placeholder="Rider field" />
      <Input label="Handover code" variant="otp" otpLength={4} defaultValue="48" />
    </div>
  );
}
