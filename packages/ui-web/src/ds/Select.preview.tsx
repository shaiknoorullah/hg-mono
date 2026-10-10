/**
 * Select specimens for the design preview. `full` mirrors the live components/Select/preview.html
 * (native with an error, native loading, and a searchable listbox).
 */

import { useState, type CSSProperties } from 'react';

import { Select, type SelectOption } from './Select.js';

/** The live design system's component name. */
export const component = 'Select';

const G2: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: 16,
  alignItems: 'start',
  width: 1408,
};

const BODIES: SelectOption[] = [
  { value: 'hma', label: 'Halal Monitoring Authority (HMA)', description: 'Ontario' },
  { value: 'isna', label: 'ISNA Canada Halal', description: 'National' },
  { value: 'hcc', label: 'Halal Certification Canada' },
  { value: 'x', label: 'Suspended body', disabled: true },
];

/** The reference page. */
export function Full() {
  const [prov, setProv] = useState('');
  const [body, setBody] = useState('isna');
  return (
    <div style={G2}>
      <div style={{ display: 'grid', gap: 12 }}>
        <Select
          label="Province"
          value={prov}
          onValueChange={setProv}
          required
          errorText={prov ? null : 'Choose a province'}
          options={[
            { value: 'ON', label: 'Ontario' },
            { value: 'QC', label: 'Quebec', disabled: true },
          ]}
        />
        <Select label="Cuisine" loading options={[]} />
      </div>
      <Select
        label="Certifying body"
        variant="listbox"
        searchable
        value={body}
        onValueChange={setBody}
        options={BODIES}
        helperText="From the registry. Free text is not permitted."
      />
    </div>
  );
}

/** Option groups, the empty list, disabled and large. */
export function GroupsEmptyDisabled() {
  return (
    <div style={G2}>
      <Select
        label="Reason"
        options={[
          { value: 'late', label: 'Arrived late', group: 'Delivery' },
          { value: 'cold', label: 'Food was cold', group: 'Food' },
          { value: 'missing', label: 'Item missing', group: 'Food' },
        ]}
      />
      <Select label="Rider" variant="listbox" emptyText="No riders online" options={[]} />
      <Select label="Province" disabled value="ON" options={[{ value: 'ON', label: 'Ontario' }]} />
      <Select label="Size lg" size="lg" options={[{ value: 'a', label: 'A' }]} />
    </div>
  );
}
