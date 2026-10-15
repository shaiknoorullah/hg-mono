/**
 * Checkbox specimens for the design preview. `full` mirrors the live
 * components/Checkbox/preview.html.
 */

import { useState, type CSSProperties } from 'react';

import { Checkbox } from './Checkbox.js';

/** The live design system's component name. */
export const component = 'Checkbox';

const G2: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: 16,
  alignItems: 'start',
  width: 1408,
};

/** The reference page: consent with description, mixed, error; add-ons with price and a disabled reason. */
export function Full() {
  const [a, setA] = useState(true);
  const [b, setB] = useState(false);
  return (
    <div style={G2}>
      <div>
        <Checkbox
          label="Text me when we launch"
          description="Unsubscribe any time. Consent timestamped (CASL)."
          checked={a}
          onCheckedChange={setA}
        />
        <Checkbox label="Select all 24 restaurants" indeterminate />
        <Checkbox label="I agree to the terms" checked={b} onCheckedChange={setB} error="Agree to the terms to continue" />
      </div>
      <div>
        <Checkbox label="Extra garlic sauce" priceDeltaCents={150} size={24} checked />
        <Checkbox label="Add falafel" priceDeltaCents={399} disabled disabledReason="Out of stock" />
      </div>
    </div>
  );
}
