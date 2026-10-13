/**
 * W6 contract: every DataTable state and every cell renders with the role and accessible name
 * its README declares, keeps the header in every state, and measures to its target classes.
 * One registry, iterated; the invariant-bearing behaviour is in w6.invariants.test.tsx.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  CountdownCell,
  DataTable,
  DateCell,
  HalalStateCell,
  IdCell,
  MeterCell,
  MoneyCell,
  StatusCell,
  TextCell,
  TimeCell,
  type DataTableColumn,
} from '../index.js';
import { EventLog, FilterBar, FilterChip, ListPane, ListPaneRow } from '../../proposed/index.js';

type Order = { id: string; restaurant: string; total: number };
const ROWS: Order[] = [
  { id: 'HG-10482', restaurant: 'Zaytoun Grill', total: 4187 },
  { id: 'HG-10481', restaurant: 'Karahi House', total: 2650 },
];
const COLS: DataTableColumn<Order>[] = [
  { key: 'id', label: 'Order', mono: true },
  { key: 'restaurant', label: 'Restaurant', sortable: true },
  {
    key: 'total',
    label: 'Total',
    align: 'end',
    numeric: true,
    sortable: true,
    render: (r) => <MoneyCell cents={r.total} />,
  },
];

const table = (extra: Partial<Parameters<typeof DataTable<Order>>[0]> = {}) => (
  <DataTable<Order> caption="Live orders" columns={COLS} rows={ROWS} getRowId={(r) => r.id} {...extra} />
);

/** Each DataTable state: what must be true of it. */
const TABLE_STATES: {
  name: string;
  el: ReactElement;
  busy?: boolean;
  text?: RegExp;
  rows: number;
}[] = [
  { name: 'ready', el: table(), rows: 2 },
  { name: 'loading', el: table({ status: 'loading' }), busy: true, rows: 5 },
  {
    name: 'loading more',
    el: table({ loadingMore: true, hasMore: true, onLoadMore: () => {} }),
    busy: true,
    rows: 3,
    text: /Loading more/,
  },
  {
    name: 'error',
    el: table({ status: 'error', onRetry: () => {} }),
    rows: 0,
    text: /Couldn't load this list/,
  },
  { name: 'empty', el: table({ rows: [] }), rows: 0, text: /No records yet/ },
  {
    name: 'filtered empty',
    el: table({ rows: [], filtersActive: true, onClearFilters: () => {} }),
    rows: 0,
    text: /No results match these filters/,
  },
  {
    name: 'has more',
    el: table({ hasMore: true, onLoadMore: () => {} }),
    rows: 2,
    text: /more below/,
  },
];

describe('DataTable states', () => {
  it.each(TABLE_STATES)('$name: grid named by its caption, header kept', ({ el, busy, text, rows }) => {
    render(el);
    const grid = screen.getByRole('grid', { name: 'Live orders' });
    expect(
      within(grid)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Order', 'Restaurant', 'Total']);
    expect(
      within(grid)
        .queryAllByRole('row')
        .filter((r) => r.getAttribute('data-ln-row') === 'true'),
    ).toHaveLength(rows);
    if (busy) expect(grid).toHaveAttribute('aria-busy', 'true');
    else expect(grid).not.toHaveAttribute('aria-busy');
    if (text) expect(screen.getByTestId('DataTable')).toHaveTextContent(text);
  });

  it('density: compact rows are 44px, comfortable (the default) 64px', () => {
    const { unmount } = render(table({ density: 'compact' }));
    expect(screen.getAllByRole('gridcell')[0]!.style.height).toBe('44px');
    unmount();
    render(table());
    expect(screen.getAllByRole('gridcell')[0]!.style.height).toBe('64px');
  });

  it('sortable headers carry aria-sort; unsortable ones do not', () => {
    render(
      table({
        sort: { key: 'total', direction: 'descending' },
        onSortChange: () => {},
      }),
    );
    const [order, restaurant, total] = screen.getAllByRole('columnheader');
    expect(order).not.toHaveAttribute('aria-sort');
    expect(restaurant).toHaveAttribute('aria-sort', 'none');
    expect(total).toHaveAttribute('aria-sort', 'descending');
  });

  it('row actions: one menu button per row, named "Actions for {rowLabel}", with a 44px hit area', () => {
    render(
      table({
        rowActions: () => [{ key: 'open', label: 'Open order' }],
        rowLabel: (r) => `order ${r.id}`,
      }),
    );
    const trigger = screen.getByRole('button', {
      name: 'Actions for order HG-10482',
    });
    expect(trigger.className).toContain('after:size-11');
    expect(screen.getByRole('button', { name: 'Actions for order HG-10481' })).toBeInTheDocument();
  });

  it('selection: a checkbox per row plus select-all, each with a 44px hit area', () => {
    render(
      table({
        selection: ['HG-10481'],
        onSelectionChange: () => {},
        rowLabel: (r) => `order ${r.id}`,
      }),
    );
    expect(screen.getByRole('checkbox', { name: 'Select all rows' })).toHaveAttribute('aria-checked', 'mixed');
    expect(screen.getByRole('checkbox', { name: 'Select order HG-10481' })).toHaveAttribute('aria-checked', 'true');
    const box = screen.getByRole('checkbox', { name: 'Select order HG-10482' });
    expect(box).toHaveAttribute('aria-checked', 'false');
    expect(box.className).toContain('after:size-11');
    expect(screen.getByRole('grid')).toHaveAttribute('aria-multiselectable', 'true');
  });

  it('Load more is a 44px button; a paging error keeps the loaded rows and offers Try again', () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(table({ hasMore: true, onLoadMore }));
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(onLoadMore).toHaveBeenCalledOnce();
    rerender(
      table({
        hasMore: true,
        onLoadMore,
        loadMoreError: 'The server did not answer.',
      }),
    );
    expect(screen.getAllByRole('gridcell').some((c) => c.textContent === 'HG-10482')).toBe(true);
    expect(screen.getByText("More didn't load.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  it('testId defaults to the component name and style passes through', () => {
    render(table({ style: { maxWidth: 900 } }));
    expect(screen.getByTestId('DataTable')).toHaveStyle({ maxWidth: '900px' });
  });
});

/** Each cell: what a screen reader gets. */
const NOW = '2026-10-09T18:00:00Z';
const CELLS: {
  name: string;
  el: ReactElement;
  testId: string;
  text: RegExp;
}[] = [
  {
    name: 'TextCell',
    el: <TextCell value="Zaytoun Grill" secondary="Toronto" />,
    testId: 'TextCell',
    text: /Zaytoun Grill.*Toronto/,
  },
  {
    name: 'TextCell missing',
    el: <TextCell value={null} />,
    testId: 'TextCell',
    text: /Not available/,
  },
  {
    name: 'IdCell',
    el: <IdCell value="HG-10482" />,
    testId: 'IdCell',
    text: /HG-10482/,
  },
  {
    name: 'MoneyCell',
    el: <MoneyCell cents={4187} />,
    testId: 'MoneyCell',
    text: /41\.87/,
  },
  {
    name: 'MoneyCell missing',
    el: <MoneyCell cents={null} />,
    testId: 'MoneyCell',
    text: /Not available/,
  },
  {
    name: 'TimeCell',
    el: <TimeCell at="2026-10-09T21:14:00Z" />,
    testId: 'TimeCell',
    text: /Friday 9 October 2026, 5:14 pm/,
  },
  {
    name: 'DateCell',
    el: <DateCell value="2026-09-26T21:55:00Z" now={new Date(NOW)} />,
    testId: 'DateCell',
    text: /Saturday 26 September 2026/,
  },
  {
    name: 'DateCell empty text',
    el: <DateCell value={null} emptyText="Not set" />,
    testId: 'DateCell',
    text: /Not set/,
  },
  {
    name: 'StatusCell',
    el: <StatusCell label="Preparing" variant="info" />,
    testId: 'StatusCell',
    text: /Preparing/,
  },
  {
    name: 'HalalStateCell',
    el: <HalalStateCell state="CERTIFIED" />,
    testId: 'HalalStateCell',
    text: /Halal certified/,
  },
  {
    name: 'MeterCell',
    el: <MeterCell value={5} max={7} label="5 / 7 checks" />,
    testId: 'MeterCell',
    text: /5 \/ 7 checks/,
  },
];

describe('cells', () => {
  it.each(CELLS)('$name renders its value as text', ({ el, testId, text }) => {
    render(el);
    expect(screen.getByTestId(testId)).toHaveTextContent(text);
  });

  it('TimeCell shows 12-hour time and a <time> with the wire value', () => {
    render(<TimeCell at="2026-10-09T21:14:00Z" />);
    const time = screen.getByTestId('TimeCell').querySelector('time')!;
    expect(time).toHaveAttribute('dateTime', '2026-10-09T21:14:00Z');
    expect(time.querySelector('[aria-hidden="true"]')).toHaveTextContent('5:14 pm');
  });

  it('DateCell shows the short date; the year only when it is not this year', () => {
    const { unmount } = render(<DateCell value="2026-09-26T21:55:00Z" now={new Date(NOW)} />);
    expect(screen.getByTestId('DateCell').querySelector('[aria-hidden="true"]')).toHaveTextContent(/^26 Sep$/);
    unmount();
    render(<DateCell value="2025-09-26" now={new Date(NOW)} />);
    expect(screen.getByTestId('DateCell').querySelector('[aria-hidden="true"]')).toHaveTextContent(/^26 Sep 2025$/);
  });

  it('IdCell copy button is named and reports "Copied"', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(<IdCell value="HG-10482" copy noun="order" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy order HG-10482' }));
    });
    expect(writeText).toHaveBeenCalledWith('HG-10482');
    expect(screen.getByRole('status')).toHaveTextContent('Copied');
  });
});

describe('proposed data composites', () => {
  it('FilterChip is a toggle with aria-pressed, 44px, the count in its name', () => {
    const onPressedChange = vi.fn();
    render(<FilterChip label="Overdue" pressed={false} count={3} onPressedChange={onPressedChange} />);
    const chip = screen.getByRole('button', { name: 'Overdue, 3' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    expect(chip.className).toContain('min-h-11');
    fireEvent.click(chip);
    expect(onPressedChange).toHaveBeenCalledWith(true);
  });

  it('FilterChip disabled stays focusable and refuses the change', () => {
    const onPressedChange = vi.fn();
    render(<FilterChip label="Overdue" pressed onPressedChange={onPressedChange} disabled />);
    const chip = screen.getByRole('button', { name: 'Overdue' });
    expect(chip).toHaveAttribute('aria-disabled', 'true');
    expect(chip).not.toBeDisabled();
    fireEvent.click(chip);
    expect(onPressedChange).not.toHaveBeenCalled();
  });

  it('FilterBar (composed) is a named group with Clear filters and a polite result count', () => {
    const onClearAll = vi.fn();
    render(
      <FilterBar onClearAll={onClearAll} resultCountLabel="12 orders">
        <FilterChip label="Overdue" pressed onPressedChange={() => {}} />
      </FilterBar>,
    );
    expect(screen.getByRole('group', { name: 'Filters' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClearAll).toHaveBeenCalledOnce();
    expect(screen.getByTestId('FilterBar-result-count')).toHaveAttribute('aria-live', 'polite');
  });

  it('FilterBar keeps the pre-rebuild declarative props working', () => {
    render(
      <FilterBar
        filters={[
          {
            key: 'state',
            label: 'State',
            kind: 'select',
            options: [{ value: 'NEW', label: 'New' }],
          },
        ]}
        value={{ state: 'NEW' }}
        onChange={() => {}}
        onClear={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Remove filter State: New' })).toBeInTheDocument();
  });

  it('ListPane: one tab stop, arrows move, the current row is aria-current', () => {
    render(
      <ListPane label="Orders">
        <ListPaneRow code="HG-1" href="/o/1" status={{ label: 'New', tone: 'info' }} />
        <ListPaneRow code="HG-2" href="/o/2" current />
        <ListPaneRow code="HG-3" href="/o/3" />
      </ListPane>,
    );
    const links = within(screen.getByRole('navigation', { name: 'Orders' })).getAllByRole('link');
    expect(links.map((l) => l.tabIndex)).toEqual([-1, 0, -1]);
    expect(links[1]).toHaveAttribute('aria-current', 'page');
    links[1]!.focus();
    fireEvent.keyDown(links[1]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(links[2]);
    fireEvent.keyDown(links[2]!, { key: 'Home' });
    expect(document.activeElement).toBe(links[0]);
  });

  it('EventLog: ordered list with 12-hour times; loading, error and empty states', () => {
    const { rerender } = render(
      <EventLog
        events={[
          {
            id: '1',
            at: '2026-10-09T21:14:00Z',
            source: 'Staff',
            actor: 'Aisha K.',
            text: 'accepted the order',
          },
        ]}
      />,
    );
    const list = screen.getByRole('list', { name: 'Event log' });
    expect(list).toHaveTextContent('5:14 pm');
    expect(list).toHaveTextContent('Aisha K. accepted the order');
    rerender(<EventLog events={[]} status="loading" />);
    expect(screen.getByTestId('EventLog')).toHaveAttribute('aria-busy', 'true');
    rerender(<EventLog events={[]} status="error" onRetry={() => {}} />);
    expect(screen.getByTestId('EventLog')).toHaveTextContent(/didn't load/);
    rerender(<EventLog events={[]} />);
    expect(screen.getByTestId('EventLog')).toHaveTextContent('No events yet');
  });

  it('CountdownCell is silent: no live region', () => {
    render(<CountdownCell deadlineAt="2099-01-01T00:00:00Z" serverNow={new Date().toISOString()} />);
    const cell = screen.getByTestId('CountdownCell');
    expect(cell.querySelector('[aria-live]')).toBeNull();
    expect(cell).not.toHaveAttribute('role');
  });
});
