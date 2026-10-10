/**
 * Specimens for `SpecialDatesList`, named after the Menu & Hours canvas `HoursView` modes
 * (`HoursView`, `HoursSpecialEmpty`, `HoursHolidayToday`, `HoursSpecialEmptyEdit` while the
 * weekly editor is open, `HoursLimits`, `HoursLoading`, `HoursError`). The live design system has
 * no preview page for it. Each sits in the 420px Special dates pane.
 */

import type { ReactNode } from 'react';

import { SpecialDatesList } from './SpecialDatesList.js';
import type { HoursOverride } from './weekly-hours.js';

/** Grouped under one heading in the preview. */
export const component = 'SpecialDatesList';

const Pane = ({ children }: { children: ReactNode }) => <div style={{ width: 420 }}>{children}</div>;
const act = () => undefined;

const DATES: HoursOverride[] = [
  { date: '2026-10-12', is_closed: false, opens_at: '12:00', closes_at: '20:00', reason: 'Thanksgiving' },
  { date: '2026-10-24', is_closed: true, opens_at: null, closes_at: null, reason: 'Staff training' },
  { date: '2026-12-24', is_closed: false, opens_at: '11:00', closes_at: '16:00', reason: 'Christmas Eve' },
  { date: '2026-12-31', is_closed: false, opens_at: '18:00', closes_at: '01:00', reason: 'New Year’s Eve' },
  { date: '2026-09-07', is_closed: true, opens_at: null, closes_at: null, reason: 'Labour Day' },
];

/** `HoursView`: upcoming dates, past dates folded away. */
export function HoursView() {
  return (
    <Pane>
      <SpecialDatesList overrides={DATES} today="2026-09-28" onAdd={act} onEdit={act} />
    </Pane>
  );
}

/** `HoursHolidayToday`: a date in effect now. */
export function HoursHolidayToday() {
  return (
    <Pane>
      <SpecialDatesList overrides={[{ date: '2026-09-28', is_closed: true, opens_at: null, closes_at: null, reason: 'Staff training' }, ...DATES]} today="2026-09-28" onAdd={act} onEdit={act} />
    </Pane>
  );
}

/** While the weekly editor is open: Remove per row and the count. */
export function HoursEditOpen() {
  return (
    <Pane>
      <SpecialDatesList overrides={DATES} today="2026-09-28" editing onAdd={act} onEdit={act} onRemove={act} />
    </Pane>
  );
}

/** `HoursSpecialEmpty`: no special dates. */
export function HoursSpecialEmpty() {
  return (
    <Pane>
      <SpecialDatesList overrides={[]} today="2026-09-28" onAdd={act} onEdit={act} />
    </Pane>
  );
}

/** `HoursLimits`: 90 dates, Add date unavailable. */
export function HoursLimits() {
  const ninety: HoursOverride[] = Array.from({ length: 90 }, (_, i) => ({
    date: `2027-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
    is_closed: true,
    opens_at: null,
    closes_at: null,
    reason: 'Closed',
  }));
  return (
    <Pane>
      <div style={{ maxHeight: 420, overflow: 'hidden' }}>
        <SpecialDatesList overrides={ninety} today="2026-09-28" editing onAdd={act} onEdit={act} onRemove={act} />
      </div>
    </Pane>
  );
}

/** `HoursLoading`. */
export function HoursLoading() {
  return (
    <Pane>
      <SpecialDatesList overrides={undefined} today="2026-09-28" loading />
    </Pane>
  );
}

/** `HoursError`: the hours failed to load. */
export function HoursError() {
  return (
    <Pane>
      <SpecialDatesList overrides={undefined} today="2026-09-28" error="Your special dates haven’t changed. Check your connection and try again." onRetry={act} />
    </Pane>
  );
}
