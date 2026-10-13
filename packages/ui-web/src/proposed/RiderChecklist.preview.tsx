/**
 * RiderChecklist specimens, after the vehicle-insurance card of the canvas board
 * `admin/rider-onboarding/DetailReview` (a proposed composite, compared with the board by eye).
 */

import { RiderChecklist, type RiderChecklistItem } from './RiderChecklist.js';

/** Grouped under its own heading in the preview. */
export const component = 'RiderChecklist';

const noop = () => {};
const pane = { width: 520 } as const;
const items: RiderChecklistItem[] = [
  { key: 'legible', label: 'Legible, every page present', value: 'pass' },
  { key: 'genuine', label: 'No sign of editing or forgery (dates, names, numbers, photo)', value: 'pass' },
  { key: 'plate', label: 'Policy on the scan covers plate CKRT 482', value: 'pass', note: 'Plate matches on page 1.' },
  { key: 'commercial', label: 'Commercial or delivery use is not excluded', value: null, note: 'Checking permitted use on page 2.' },
  { key: 'consent', label: 'Owner’s signed consent is in the upload (only when the registrant isn’t the rider)', value: 'not_applicable', conditional: true },
  { key: 'age', label: 'Holder is 18 or older (computed from the date of birth on the ID)', value: null, computed: { text: 'Age 24: meets the rule', ok: true } },
];

/** Answering: commercial use not recorded yet. */
export function Editing() {
  return (
    <div style={pane}>
      <RiderChecklist legend="Checks for vehicle insurance" items={items} onChange={noop} onNoteChange={noop} />
    </div>
  );
}

/** A plate mismatch recorded as Fails, with its internal note. */
export function PlateFail() {
  return (
    <div style={pane}>
      <RiderChecklist
        legend="Checks for vehicle registration"
        items={[items[0]!, items[1]!, { key: 'plate', label: 'Plate on the scan matches the profile (CKRT 482)', value: 'fail', note: 'The registration reads CKRT 428.' }]}
        onChange={noop}
        onNoteChange={noop}
      />
    </div>
  );
}

/** Read-only after the decision. */
export function Recorded() {
  return (
    <div style={pane}>
      <RiderChecklist
        readOnly
        recordedAt="28 September 2026, 2:32 pm"
        items={[...items.slice(0, 3), { ...items[3]!, value: 'fail' }, items[4]!, items[5]!]}
      />
    </div>
  );
}
