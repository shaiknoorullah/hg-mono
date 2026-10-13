/**
 * DataTable specimens for the design preview (packages/ui-web/preview).
 *
 * `Full` reproduces the live design system's components/DataTable/preview.html (the live table
 * with sort, selection, row actions and "Load more", then the loading, filtered-to-nothing and
 * error tables). The others show the remaining states one by one. Layout uses inline styles and
 * the preview's own classes, never Tailwind utilities.
 */

import { useState } from 'react';

import { DataTable, type DataTableColumn, type DataTableMenuItem } from './DataTable.js';
import { MoneyCell, StatusCell } from './cells.js';

/** The live design system's component name, pairing these specimens with its preview page. */
export const component = 'DataTable';

type Order = { id: string; restaurant: string; state: string; total: number };

const COLS: DataTableColumn<Order>[] = [
  { key: 'id', label: 'Order', mono: true },
  { key: 'restaurant', label: 'Restaurant', sortable: true },
  {
    key: 'state',
    label: 'State',
    render: (r) => <StatusCell label={r.state} />,
  },
  {
    key: 'total',
    label: 'Total',
    align: 'end',
    numeric: true,
    sortable: true,
    render: (r) => <MoneyCell cents={r.total} />,
  },
];
const ROWS: Order[] = [
  {
    id: 'HG-10482',
    restaurant: 'Zaytoun Grill',
    state: 'Preparing',
    total: 4187,
  },
  {
    id: 'HG-10481',
    restaurant: 'Karahi House',
    state: 'On the way',
    total: 2650,
  },
  {
    id: 'HG-10479',
    restaurant: 'Anatolia Doner',
    state: 'Delivered',
    total: 1899,
  },
];
const ACTIONS = (): DataTableMenuItem[] => [
  { key: 'open', label: 'Open order' },
  { key: 'refund', label: 'Issue refund' },
  { type: 'separator' },
  { key: 'cancel', label: 'Cancel order', destructive: true },
];
const getRowId = (r: Order) => r.id;

function LiveOrders() {
  const [sort, setSort] = useState<{
    key: string;
    direction: 'ascending' | 'descending';
  }>({ key: 'total', direction: 'descending' });
  const [selection, setSelection] = useState<string[]>(['HG-10481']);
  return (
    <DataTable<Order>
      caption="Live orders"
      columns={COLS}
      rows={ROWS}
      getRowId={getRowId}
      sort={sort}
      onSortChange={setSort}
      selection={selection}
      onSelectionChange={setSelection}
      rowActions={ACTIONS}
      rowLabel={(r) => `order ${r.id}`}
      onRowActivate={() => {}}
      hasMore
      onLoadMore={() => {}}
    />
  );
}

/** The reference page as a whole: the live table, then three states side by side. */
export function Full() {
  return (
    <div style={{ width: 1100, display: 'grid', gap: 12 }}>
      <LiveOrders />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 16,
          alignItems: 'start',
        }}
      >
        <DataTable<Order> caption="Loading" columns={COLS} rows={[]} status="loading" />
        <DataTable<Order>
          caption="Filtered to nothing"
          columns={COLS}
          rows={[]}
          filtersActive
          onClearFilters={() => {}}
        />
        <DataTable<Order> caption="Error" columns={COLS} rows={[]} status="error" onRetry={() => {}} />
      </div>
    </div>
  );
}

/** No records at all: says why and what next. */
export function Empty() {
  return (
    <div style={{ width: 720 }}>
      <DataTable<Order>
        caption="Payouts"
        columns={COLS}
        rows={[]}
        emptyState={{
          title: 'No payouts yet',
          description: 'Your first payout appears here after your first delivered order.',
        }}
      />
    </div>
  );
}

/** The next page is loading: a tail skeleton row. */
export function LoadingMore() {
  return (
    <div style={{ width: 720 }}>
      <DataTable<Order>
        caption="Orders"
        columns={COLS}
        rows={ROWS}
        getRowId={getRowId}
        hasMore
        loadingMore
        onLoadMore={() => {}}
      />
    </div>
  );
}

/** The next page failed: loaded rows stay, an inline alert offers Try again. */
export function PagingError() {
  return (
    <div style={{ width: 720 }}>
      <DataTable<Order>
        caption="Orders"
        columns={COLS}
        rows={ROWS}
        getRowId={getRowId}
        hasMore
        onLoadMore={() => {}}
        loadMoreError="The server did not answer in time. The orders above are still current."
      />
    </div>
  );
}

/** Comfortable density (64px rows) with the open row drawn as a filled tile. */
export function ComfortableActiveRow() {
  return (
    <div style={{ width: 720 }}>
      <DataTable<Order>
        caption="Orders"
        columns={COLS}
        rows={ROWS}
        getRowId={getRowId}
        density="comfortable"
        activeRowId="HG-10481"
      />
    </div>
  );
}
