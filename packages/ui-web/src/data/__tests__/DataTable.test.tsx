import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DataTable } from '../DataTable.js';
import type { DataTableColumn, PageMeta } from '../types.js';

afterEach(() => {
  cleanup();
  // A test that times out under fake timers must not poison the next one.
  vi.useRealTimers();
});

/**
 * The admin projection as the server actually sends it: PII already masked server-side
 * (A-42 R1 — "a masked field is never present in the response payload in unmasked form").
 * The full value only ever arrives from a justified reveal.
 */
interface OrderRow {
  id: string;
  reference: string;
  customer_phone_masked: string;
  total_cents: number;
}

const ROWS: OrderRow[] = [
  { id: 'o-1', reference: 'HG-10482', customer_phone_masked: '••• ••• 4821', total_cents: 4696 },
  { id: 'o-2', reference: 'HG-10483', customer_phone_masked: '••• ••• 7710', total_cents: 2199 },
];

const COLUMNS: DataTableColumn<OrderRow>[] = [
  {
    key: 'reference',
    header: 'Order',
    contentClass: 'id',
    sortKey: 'reference',
    cell: (row) => row.reference,
    textValue: (row) => row.reference,
  },
  {
    key: 'customer_phone',
    header: 'Phone',
    // Declaring `pii` is the *only* switch there is. There is no `masked: false`.
    pii: { field: 'customer_phone', noun: 'phone number' },
    cell: (row, context) => context.revealedValue ?? row.customer_phone_masked,
  },
  {
    key: 'total',
    header: 'Total',
    contentClass: 'money',
    sortKey: 'total_cents',
    cell: (row) => `$${(row.total_cents / 100).toFixed(2)}`,
  },
];

function renderTable(overrides: Partial<React.ComponentProps<typeof DataTable<OrderRow>>> = {}) {
  return render(
    <DataTable<OrderRow>
      caption="Orders"
      columns={COLUMNS}
      rows={ROWS}
      getRowId={(row) => row.id}
      getRowLabel={(row) => `order ${row.reference}`}
      entityPlural="orders"
      {...overrides}
    />,
  );
}

describe('PII masking is the default, not an opt-in', () => {
  it('renders the server-masked value and never the full one', () => {
    renderTable();

    const cell = screen.getAllByTestId('data-table-pii-customer_phone')[0]!;
    expect(cell.getAttribute('data-masked')).toBe('true');
    expect(cell.getAttribute('data-revealed')).toBeNull();
    expect(cell.textContent).toContain('••• ••• 4821');
    expect(screen.queryByText(/4165550123/)).toBeNull();
  });

  it('offers no reveal control at all when the host wires no reveal handler', () => {
    // Without `onRevealPii` there is no code path in this component that can produce an
    // unmasked value, because the unmasked value only exists on the server.
    renderTable();
    expect(screen.queryByTestId('data-table-pii-customer_phone-reveal')).toBeNull();
  });

  it('requires a justification and a case reference before it will call the server', async () => {
    const user = userEvent.setup();
    const onRevealPii = vi.fn().mockResolvedValue('+1 416 555 4821');

    renderTable({ onRevealPii });

    const reveal = screen.getAllByTestId('data-table-pii-customer_phone-reveal')[0]!;
    // The control names the row *and* warns that using it is recorded.
    expect(reveal.getAttribute('aria-label')).toBe(
      'Reveal phone number for order HG-10482. Recorded against your account.',
    );

    await user.click(reveal);

    const dialog = await screen.findByTestId('data-table-pii-customer_phone-confirm');

    // Confirming with nothing filled in must not reach the server.
    await user.click(within(dialog).getByRole('button', { name: /Reveal phone number/ }));
    expect(onRevealPii).not.toHaveBeenCalled();
    expect(within(dialog).getByTestId('data-table-pii-customer_phone-confirm-error')).toBeTruthy();

    await user.selectOptions(within(dialog).getByLabelText(/Justification/), 'FRAUD_INVESTIGATION');
    await user.type(within(dialog).getByRole('textbox'), 'CASE-9911');
    await user.click(within(dialog).getByRole('button', { name: /Reveal phone number/ }));

    await waitFor(() => expect(onRevealPii).toHaveBeenCalledTimes(1));
    expect(onRevealPii).toHaveBeenCalledWith({
      rowId: 'o-1',
      field: 'customer_phone',
      justificationCode: 'FRAUD_INVESTIGATION',
      caseId: 'CASE-9911',
    });

    // Only now — and only with the value the *server* returned — does it unmask.
    await waitFor(() => {
      const cell = screen.getAllByTestId('data-table-pii-customer_phone')[0]!;
      expect(cell.getAttribute('data-revealed')).toBe('true');
      expect(cell.textContent).toContain('+1 416 555 4821');
    });
  });

  it('stays masked when the server refuses the reveal', async () => {
    const user = userEvent.setup();
    const onRevealPii = vi.fn().mockRejectedValue(new Error('CASE_REQUIRED'));

    renderTable({ onRevealPii });

    await user.click(screen.getAllByTestId('data-table-pii-customer_phone-reveal')[0]!);
    const dialog = await screen.findByTestId('data-table-pii-customer_phone-confirm');
    await user.selectOptions(within(dialog).getByLabelText(/Justification/), 'CONTACTING_CUSTOMER');
    await user.type(within(dialog).getByRole('textbox'), 'CASE-1');
    await user.click(within(dialog).getByRole('button', { name: /Reveal phone number/ }));

    await waitFor(() =>
      expect(screen.getByTestId('data-table-pii-customer_phone-confirm-error').textContent).toContain(
        'CASE_REQUIRED',
      ),
    );
    expect(screen.getAllByTestId('data-table-pii-customer_phone')[0]!.getAttribute('data-masked')).toBe(
      'true',
    );
  });

  it('re-masks itself once the reveal window closes', async () => {
    const user = userEvent.setup();
    const onRevealPii = vi.fn().mockResolvedValue('+1 416 555 4821');
    // A short window so the test exercises the real timer rather than a mocked clock.
    renderTable({ onRevealPii, revealTtlMs: 60 });

    await user.click(screen.getAllByTestId('data-table-pii-customer_phone-reveal')[0]!);
    const dialog = await screen.findByTestId('data-table-pii-customer_phone-confirm');
    await user.selectOptions(within(dialog).getByLabelText(/Justification/), 'DELIVERY_ISSUE');
    await user.type(within(dialog).getByRole('textbox'), 'CASE-2');
    await user.click(within(dialog).getByRole('button', { name: /Reveal phone number/ }));

    await waitFor(() =>
      expect(
        screen.getAllByTestId('data-table-pii-customer_phone')[0]!.getAttribute('data-revealed'),
      ).toBe('true'),
    );

    // Bounded exposure: an unattended support screen stops being a data leak.
    await waitFor(() =>
      expect(
        screen.getAllByTestId('data-table-pii-customer_phone')[0]!.getAttribute('data-masked'),
      ).toBe('true'),
    );
  });
});

describe('pagination matches the contract exactly', () => {
  const meta: PageMeta = { has_more: true, next_cursor: 'eyJpZCI6Im8tMiJ9' };

  it('pages by cursor, offers no page numbers, and invents no total', () => {
    const onNext = vi.fn();
    renderTable({
      pagination: { meta, limit: 20, onNext, unit: 'orders' },
    });

    const pagination = screen.getByTestId('data-table-pagination');
    expect(pagination.getAttribute('data-has-more')).toBe('true');

    // `meta.total` was absent, so the component says what it knows and nothing more.
    expect(screen.getByTestId('data-table-pagination-summary').textContent).toBe(
      'Showing 2 orders, more available',
    );

    // No page numbers anywhere — an opaque keyset cursor cannot produce them.
    expect(within(pagination).queryByRole('button', { name: '1' })).toBeNull();
    expect(within(pagination).queryByRole('button', { name: /last/i })).toBeNull();
  });

  it('disables the next control at the end of the collection', () => {
    renderTable({
      pagination: {
        meta: { has_more: false, next_cursor: null },
        limit: 20,
        onNext: vi.fn(),
      },
    });
    const next = screen.getByRole('button', { name: /Load 20 more/ });
    expect(next.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByTestId('data-table-pagination-summary').textContent).toBe(
      'Showing all 2 orders',
    );
  });

  it('reports the exact count only when the server chose to send one', () => {
    renderTable({
      pagination: {
        meta: { has_more: true, next_cursor: 'c', total: 431 },
        limit: 50,
        onNext: vi.fn(),
      },
    });
    expect(screen.getByTestId('data-table-pagination-summary').textContent).toBe(
      'Showing 2 of 431 orders',
    );
  });

  it('loads the next page on demand', async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    renderTable({ pagination: { meta, limit: 20, onNext } });
    await user.click(screen.getByRole('button', { name: /Load 20 more/ }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});

describe('every declared state is implemented', () => {
  it('keeps the header and shows skeleton rows in the real geometry while loading', () => {
    renderTable({ loading: true, rows: [] });
    expect(screen.getByRole('columnheader', { name: /Order/ })).toBeTruthy();
    expect(screen.getAllByTestId('data-table-skeleton-row')).toHaveLength(5);
    expect(screen.queryByTestId('data-table-row')).toBeNull();
  });

  it('appends a tail skeleton while loading more, leaving the loaded rows in place', () => {
    renderTable({ loadingMore: true });
    expect(screen.getAllByTestId('data-table-row')).toHaveLength(2);
    expect(screen.getByTestId('data-table-skeleton-tail')).toBeTruthy();
  });

  it('distinguishes an empty table from one filtered to nothing', () => {
    const { unmount } = renderTable({ rows: [] });
    expect(screen.getByTestId('data-table-empty').textContent).toContain('No orders yet');
    unmount();

    renderTable({ rows: [], filtersActive: true, onClearFilters: vi.fn() });
    const filtered = screen.getByTestId('data-table-empty');
    expect(filtered.textContent).toContain('No records match these filters');
    expect(filtered.textContent).not.toContain('No orders yet');
    expect(within(filtered).getByRole('button', { name: 'Clear filters' })).toBeTruthy();
  });

  it('renders a drained queue as a positive state, not as an absence', () => {
    renderTable({
      rows: [],
      drained: { queueName: 'Onboarding queue', lastProcessedAt: '2026-08-11T14:02:00.000Z' },
    });
    const empty = screen.getByTestId('data-table-empty');
    expect(empty.getAttribute('data-tone')).toBe('positive');
    expect(empty.textContent).toContain('Onboarding queue is clear');
    expect(empty.textContent).toContain('Last processed');
  });

  it('shows the error inside the body with the header retained', () => {
    renderTable({
      rows: [],
      error: { code: 'INTERNAL_ERROR', requestId: 'req_123', onRetry: vi.fn() },
    });
    expect(screen.getByRole('columnheader', { name: /Order/ })).toBeTruthy();
    expect(screen.getByTestId('data-table-error')).toBeTruthy();
    expect(screen.getByTestId('data-table-error-technical').textContent).toContain('req_123');
  });
});

describe('sorting and keyboard access', () => {
  it('exposes aria-sort on sortable headers and toggles direction server-side', async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    renderTable({ sort: { key: 'reference', direction: 'asc' }, onSortChange });

    expect(screen.getByRole('columnheader', { name: /Order/ }).getAttribute('aria-sort')).toBe(
      'ascending',
    );
    // A column with no `sortKey` advertises nothing rather than advertising "none".
    expect(screen.getByRole('columnheader', { name: 'Phone' }).getAttribute('aria-sort')).toBeNull();

    await user.click(screen.getByTestId('data-table-sort-reference'));
    expect(onSortChange).toHaveBeenCalledWith({ key: 'reference', direction: 'desc' });
  });

  it('is one tab stop with arrow-key movement between cells', async () => {
    const user = userEvent.setup();
    renderTable();

    const table = screen.getByRole('grid');
    const tabbable = table.querySelectorAll('[tabindex="0"]');
    expect(tabbable).toHaveLength(1);

    const firstHeader = table.querySelector<HTMLElement>('[data-grid-row="0"][data-grid-col="0"]')!;
    firstHeader.focus();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement?.getAttribute('data-grid-row')).toBe('1');
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement?.getAttribute('data-grid-col')).toBe('1');
    await user.keyboard('{End}');
    expect(document.activeElement?.getAttribute('data-grid-col')).toBe('2');
  });

  it('gives every row action menu a unique accessible name', () => {
    renderTable({
      rowActions: (row) => [{ key: 'open', label: 'Open', onSelect: () => void row }],
    });
    const triggers = screen.getAllByTestId('data-table-actions');
    expect(triggers.map((trigger) => trigger.getAttribute('aria-label'))).toEqual([
      'Actions for order HG-10482',
      'Actions for order HG-10483',
    ]);
  });

  it('names the table with a caption', () => {
    renderTable();
    expect(screen.getByRole('grid', { name: 'Orders' })).toBeTruthy();
  });
});
