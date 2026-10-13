/**
 * SegmentedControl specimens for the design preview. `full` mirrors the live
 * components/SegmentedControl/preview.html (light full width; chrome sm with icons).
 */

import { useState } from 'react';

import { SegmentedControl } from './SegmentedControl.js';

/** The live design system's component name. */
export const component = 'SegmentedControl';

/** The reference page. */
export function Full() {
  const [a, setA] = useState('eat');
  const [b, setB] = useState('delivery');
  return (
    <div style={{ display: 'grid', gap: 12, width: 1408 }}>
      <SegmentedControl
        label="I want to"
        value={a}
        onChange={setA}
        fullWidth
        options={[
          { value: 'eat', label: 'Order food' },
          { value: 'own', label: 'List your restaurant' },
        ]}
      />
      <div style={{ background: 'var(--hg-surface-chrome)', padding: 12, borderRadius: 'var(--hg-radius-lg)' }}>
        <SegmentedControl
          label="Fulfilment"
          tone="chrome"
          size="sm"
          value={b}
          onChange={setB}
          options={[
            { value: 'delivery', label: 'Delivery', icon: 'map' },
            { value: 'pickup', label: 'Pickup', icon: 'cart' },
          ]}
        />
      </div>
    </div>
  );
}

/** md and lg, three options with one disabled. */
export function Sizes() {
  return (
    <div style={{ display: 'grid', gap: 12, justifyItems: 'start' }}>
      <SegmentedControl label="View" value="list" options={[{ value: 'list', label: 'List' }, { value: 'map', label: 'Map' }, { value: 'grid', label: 'Grid', disabled: true }]} />
      <SegmentedControl label="View" size="lg" value="map" options={[{ value: 'list', label: 'List' }, { value: 'map', label: 'Map' }]} />
    </div>
  );
}
