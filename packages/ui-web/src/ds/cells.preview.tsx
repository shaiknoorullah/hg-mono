/**
 * DataTable cell specimens for the design preview. The live design system has no page for the
 * cells (they are drawn inside the admin grids), so these are candidate-only: one specimen per
 * cell, with its missing-value and state variants. Layout uses the preview's own classes.
 */

import {
  CountdownCell,
  DateCell,
  HalalStateCell,
  IdCell,
  MeterCell,
  MoneyCell,
  StatusCell,
  TextCell,
  TimeCell,
} from './cells.js';

/** Not a live design-system page: the cells only appear inside DataTable. */
export const component = 'DataCells';

const NOW = new Date('2026-10-09T18:00:00Z');

/** TextCell with a secondary line, truncated, and missing. */
export function Text() {
  return (
    <div className="hg-specimen-col" style={{ width: 240 }}>
      <TextCell value="Zaytoun Grill" secondary="Toronto, ON" />
      <TextCell value="A restaurant name long enough to be truncated in the column" />
      <TextCell value={null} />
    </div>
  );
}

/** IdCell plain, with copy, as a link. */
export function Id() {
  return (
    <div className="hg-specimen-col">
      <IdCell value="HG-10482" />
      <IdCell value="HG-10482" copy noun="order" />
      <IdCell value="CERT-ON-2231" href="#certificate" />
    </div>
  );
}

/** MoneyCell default, signed, with code, failed payout, missing. */
export function Money() {
  return (
    <div className="hg-specimen-col" style={{ width: 160 }}>
      <MoneyCell cents={4187} />
      <MoneyCell cents={-300} sign="always" showCode />
      <MoneyCell cents={12500} tone="negative-ops" />
      <MoneyCell cents={null} />
    </div>
  );
}

/** TimeCell and DateCell: 12-hour time and short dates, the full date in a tooltip. */
export function TimeAndDate() {
  return (
    <div className="hg-specimen-row">
      <TimeCell at="2026-10-09T21:14:00Z" />
      <TimeCell at="2026-10-09T17:48:00Z" mode="absolute+relative" serverNow="2026-10-09T18:00:00Z" />
      <DateCell value="2026-09-26T21:55:00Z" now={NOW} />
      <DateCell value="2025-09-26" now={NOW} />
      <DateCell value="2026-09-26T21:55:00Z" mode="datetime" now={NOW} />
      <DateCell value={null} emptyText="Not set" />
    </div>
  );
}

/** CountdownCell: normal, due soon, overdue. Silent. */
export function Countdown() {
  const now = Date.now();
  const at = (ms: number) => new Date(now + ms).toISOString();
  const server = new Date(now).toISOString();
  return (
    <div className="hg-specimen-row">
      <CountdownCell deadlineAt={at(42 * 60_000)} serverNow={server} windowSeconds={3600} />
      <CountdownCell deadlineAt={at(9 * 60_000)} serverNow={server} windowSeconds={3600} />
      <CountdownCell deadlineAt={at(-4 * 60_000)} serverNow={server} windowSeconds={3600} />
    </div>
  );
}

/** StatusCell in every tint. No success solid exists. */
export function Status() {
  return (
    <div className="hg-specimen-row">
      <StatusCell label="New" variant="brand" />
      <StatusCell label="Preparing" variant="info" icon="clock" />
      <StatusCell label="Waiting on rider" variant="warning" />
      <StatusCell label="Payout failed" variant="danger" />
      <StatusCell label="Delivered" />
      <StatusCell label="Draft" variant="outline" />
    </div>
  );
}

/** HalalStateCell: the four states, operational; missing says "No status on file". */
export function HalalState() {
  return (
    <div className="hg-specimen-row">
      <HalalStateCell state="CERTIFIED" />
      <HalalStateCell state="EXPIRING_SOON" expiresOn="2026-10-20" />
      <HalalStateCell state="EXPIRED" />
      <HalalStateCell state="UNVERIFIED" />
      <HalalStateCell state={null} />
    </div>
  );
}

/** MeterCell: checklist progress (info, never green) and a stacked split. */
export function Meter() {
  return (
    <div className="hg-specimen-col" style={{ width: 240 }}>
      <MeterCell value={5} max={7} label="5 / 7 checks" />
      <MeterCell value={7} max={7} label="7 / 7 checks" />
      <MeterCell
        value={5800}
        max={5800}
        label="$58.00 refund"
        segments={[
          { value: 3000, token: 'viz-1', label: 'Platform $30.00' },
          { value: 2000, token: 'viz-2', label: 'Restaurant $20.00' },
          { value: 800, token: 'viz-6', label: 'Rider $8.00' },
        ]}
      />
    </div>
  );
}
