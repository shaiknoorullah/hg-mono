/**
 * Specimens for `WeeklyHoursEditor`, named after the Menu & Hours canvas `HoursView` modes
 * (`HoursEdit`, `HoursDayClosed`, `HoursOverlap`, `HoursOverlapNight`, `HoursTwentyFour`,
 * `HoursLimits`, `HoursSaving`, `HoursView`) and the Onboarding `HoursBlock` (the live design
 * system has no preview page for it). Each sits in the edit pane's width beside Special dates.
 */

import { useState, type ReactNode } from 'react';

import { WeeklyHoursEditor } from './WeeklyHoursEditor.js';
import type { WeeklyHours } from './weekly-hours.js';

/** Grouped under one heading in the preview. */
export const component = 'WeeklyHoursEditor';

const Pane = ({ children, width = 780 }: { children: ReactNode; width?: number }) => <div style={{ width }}>{children}</div>;
const one = (open: string, close: string) => ({ closed: false, ranges: [{ open, close }] });

/** The week drawn on `HoursView`. */
const WEEK: WeeklyHours = {
  mon: one('11:00', '22:00'),
  tue: one('11:00', '22:00'),
  wed: one('11:00', '22:00'),
  thu: one('11:00', '23:00'),
  fri: { closed: false, ranges: [{ open: '11:00', close: '15:00' }, { open: '17:00', close: '02:00' }] },
  sat: one('12:00', '02:00'),
  sun: { closed: true, ranges: [] },
};

function Live({ initial, saved = WEEK, ...rest }: { initial: WeeklyHours; saved?: WeeklyHours } & Partial<Parameters<typeof WeeklyHoursEditor>[0]>) {
  const [value, setValue] = useState(initial);
  return (
    <WeeklyHoursEditor
      value={value}
      savedValue={saved}
      onValueChange={setValue}
      onSave={() => undefined}
      onDiscard={() => setValue(saved)}
      {...rest}
    />
  );
}

/** `HoursEdit`: editing, no changes yet. */
export function HoursEdit() {
  return (
    <Pane>
      <Live initial={WEEK} />
    </Pane>
  );
}

/** `HoursDayClosed`: Friday at 3 ranges (Add unavailable), Saturday just closed with Undo. */
export function HoursDayClosed() {
  return (
    <Pane>
      <Live
        initial={{
          ...WEEK,
          fri: { closed: false, ranges: [{ open: '07:00', close: '10:30' }, { open: '11:00', close: '15:00' }, { open: '17:00', close: '02:00' }] },
          sat: { closed: true, ranges: [{ open: '12:00', close: '02:00' }] },
        }}
      />
    </Pane>
  );
}

/** `HoursOverlap`: two Friday ranges overlap; the summary and the field say so. */
export function HoursOverlap() {
  return (
    <Pane>
      <Live initial={{ ...WEEK, fri: { closed: false, ranges: [{ open: '11:00', close: '15:00' }, { open: '14:00', close: '02:00' }] } }} showErrors />
    </Pane>
  );
}

/** `HoursOverlapNight`: Friday runs into Saturday, Sunday into Monday. */
export function HoursOverlapNight() {
  return (
    <Pane>
      <Live
        initial={{
          ...WEEK,
          sat: { closed: false, ranges: [{ open: '01:00', close: '04:00' }, { open: '12:00', close: '02:00' }] },
          sun: one('20:00', '03:00'),
          mon: { closed: false, ranges: [{ open: '02:00', close: '10:00' }, { open: '11:00', close: '22:00' }] },
        }}
        showErrors
      />
    </Pane>
  );
}

/** `HoursTwentyFour`: the same opening and closing time is open 24 hours. */
export function HoursTwentyFour() {
  return (
    <Pane>
      <Live initial={{ ...WEEK, wed: one('09:00', '09:00') }} />
    </Pane>
  );
}

/** `HoursLimits`: all 21 time ranges used. */
export function HoursLimits() {
  const three = { closed: false, ranges: [{ open: '07:00', close: '11:00' }, { open: '12:00', close: '15:00' }, { open: '17:00', close: '23:00' }] };
  return (
    <Pane>
      <Live initial={{ mon: three, tue: three, wed: three, thu: three, fri: three, sat: three, sun: three }} />
    </Pane>
  );
}

/** `HoursSaving`: controls hold, Save shows Saving…. */
export function HoursSaving() {
  return (
    <Pane>
      <Live initial={{ ...WEEK, mon: one('11:00', '23:00') }} saving />
    </Pane>
  );
}

/** `HoursView`: the read-only schedule, today marked. */
export function HoursView() {
  return (
    <Pane>
      <WeeklyHoursEditor value={WEEK} readOnly today="mon" />
    </Pane>
  );
}

/** Onboarding `HoursBlock`: Closed is a checkbox, plain inside the onboarding section. */
export function HoursBlock() {
  return (
    <Pane width={700}>
      <Live initial={WEEK} closedControl="checkbox" appearance="plain" heading={null} />
    </Pane>
  );
}
