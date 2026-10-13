/**
 * Specimens for the W6 proposed composites: FilterBar with FilterChips, the admin list pane
 * (ListPane + ListPaneRow) and EventLog. No live design-system page exists for them; compare
 * with the canvases (admin/orders/OrdersGrid, OrderDetail; admin/refunds/Refunds).
 */

import { useState } from 'react';

import { EventLog } from './EventLog.js';
import { FilterBar } from './FilterBar.js';
import { FilterChip } from './FilterChip.js';
import { ListPane, ListPaneRow } from './ListPaneRow.js';

/** Not a live design-system page. */
export const component = 'DataComposites';

/** FilterBar with chips: off, on, with counts; Clear filters while one is on. */
export function Filters() {
  const [on, setOn] = useState<Record<string, boolean>>({ overdue: true });
  const set = (key: string) => (pressed: boolean) => setOn((s) => ({ ...s, [key]: pressed }));
  const active = Object.values(on).some(Boolean);
  return (
    <div style={{ width: 900 }}>
      <FilterBar active={active} onClearAll={() => setOn({})} resultCountLabel="12 orders">
        <FilterChip label="Overdue" count={3} pressed={Boolean(on.overdue)} onPressedChange={set('overdue')} />
        <FilterChip label="Needs a rider" count={5} pressed={Boolean(on.rider)} onPressedChange={set('rider')} />
        <FilterChip label="Refund open" pressed={Boolean(on.refund)} onPressedChange={set('refund')} />
        <FilterChip label="Paused" pressed={false} onPressedChange={() => {}} disabled />
      </FilterBar>
    </div>
  );
}

/** The list beside an open order: the current row is a filled tile, bold. */
export function ListPaneRows() {
  return (
    <div style={{ width: 320, border: '1px solid var(--hg-border-decorative)' }}>
      <ListPane label="Orders">
        <ListPaneRow
          code="HG-6RN4KP"
          href="#1"
          status={{ label: 'Preparing', tone: 'info' }}
          subline="Zaytoun Grill · 6:42 pm"
        />
        <ListPaneRow
          code="HG-8F3K2Q"
          href="#2"
          current
          status={{ label: 'Waiting', tone: 'warning' }}
          subline="Karahi House · 6:38 pm"
        />
        <ListPaneRow code="HG-7Q2M4K" href="#3" status={{ label: 'Delivered' }} subline="Anatolia Doner · 6:12 pm" />
      </ListPane>
    </div>
  );
}

/** EventLog: times, sources, actors; then the loading, empty and error states. */
export function EventLogStates() {
  return (
    <div style={{ width: 520, display: 'grid', gap: 16 }}>
      <EventLog
        events={[
          {
            id: '1',
            at: '2026-10-09T22:38:00Z',
            source: 'Customer',
            text: 'placed the order',
          },
          {
            id: '2',
            at: '2026-10-09T22:39:00Z',
            source: 'System',
            text: 'authorised $41.87',
          },
          {
            id: '3',
            at: '2026-10-09T22:41:00Z',
            source: 'Restaurant',
            actor: 'Zaytoun Grill',
            text: 'accepted the order',
          },
          {
            id: '4',
            at: '2026-10-09T22:52:00Z',
            source: 'Staff',
            actor: 'Aisha K.',
            text: 'revealed the address (rider support)',
          },
        ]}
      />
      <EventLog events={[]} status="loading" />
      <EventLog events={[]} />
      <EventLog events={[]} status="error" onRetry={() => {}} />
    </div>
  );
}
