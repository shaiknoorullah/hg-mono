/**
 * RadioGroup specimens for the design preview. `full` mirrors the live
 * components/Radio/preview.html; the others show `<Radio>` children and roomy rows.
 */

import { useState, type CSSProperties } from 'react';

import { Radio, RadioGroup } from './RadioGroup.js';

/** The live design system's component name (the preview page is under Radio). */
export const component = 'Radio';

const G2: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: 16,
  alignItems: 'start',
  width: 1408,
};

/** The reference page: tip with descriptions; size with prices, a disabled reason and the group error. */
export function Full() {
  const [tip, setTip] = useState('15');
  const [size, setSize] = useState<string | null>(null);
  return (
    <div style={G2}>
      <RadioGroup
        label="Tip for your rider"
        value={tip}
        onValueChange={setTip}
        options={[
          { value: '10', label: '10%' },
          { value: '15', label: '15%', description: 'Most chosen' },
          { value: '20', label: '20%', description: 'Goes entirely to your rider' },
        ]}
      />
      <RadioGroup
        label="Size"
        required
        value={size}
        onValueChange={setSize}
        error={size ? null : 'Choose a size'}
        options={[
          { value: 'r', label: 'Regular', priceDeltaCents: 0 },
          { value: 'l', label: 'Large', priceDeltaCents: 250 },
          { value: 'f', label: 'Family', priceDeltaCents: 900, disabled: true, disabledReason: 'Out of stock' },
        ]}
      />
    </div>
  );
}

/** `<Radio>` children, horizontal, and the packet's roomy 72px rows. */
export function ChildrenAndRoomy() {
  return (
    <div style={G2}>
      <RadioGroup label="Refund reason" value="late" orientation="horizontal">
        <Radio value="late" label="Late" />
        <Radio value="cold" label="Cold food" />
        <Radio value="missing" label="Missing item" />
      </RadioGroup>
      <RadioGroup
        label="Payment"
        roomy
        size={24}
        value="card"
        options={[
          { value: 'card', label: 'Visa ending 4242' },
          { value: 'apple', label: 'Apple Pay' },
        ]}
      />
    </div>
  );
}
