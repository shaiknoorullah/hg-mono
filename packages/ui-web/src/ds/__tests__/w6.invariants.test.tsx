/**
 * W6 invariants: the behaviour that, if it broke, would mislead someone.
 *
 * - Invariant 8: a missing halal state renders no badge ("No status on file") and is reported.
 * - Invariant 9: no halal state in a cell paints a danger (red) class.
 * - Invariant 10 / L-4: no W6 file asks for a success solid or a ramp step; no left-border state.
 * - Sorting and selection are announced; Enter activates, Space selects, a control in a cell
 *   never activates its row; "no results for these filters" is not "no records".
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DataTable,
  HalalStateCell,
  HALAL_STATE_MISSING_TEXT,
  setClientErrorReporter,
  type DataTableColumn,
} from '../index.js';

type Row = { id: string; name: string; total: number };
const ROWS: Row[] = [
  { id: 'a', name: 'Zaytoun Grill', total: 4187 },
  { id: 'b', name: 'Karahi House', total: 2650 },
];
const COLS: DataTableColumn<Row>[] = [
  { key: 'name', label: 'Restaurant', sortable: true },
  { key: 'total', label: 'Total', align: 'end', sortable: true },
];

afterEach(() => setClientErrorReporter(null));

describe('HalalStateCell (invariants 8 and 9)', () => {
  it.each([null, undefined, 'PENDING'])('%s renders text, never a badge, and is reported', (state) => {
    const report = vi.fn();
    setClientErrorReporter(report);
    render(<HalalStateCell state={state as never} restaurantId="r-1" />);
    const cell = screen.getByTestId('HalalStateCell');
    expect(cell).toHaveTextContent(HALAL_STATE_MISSING_TEXT);
    expect(cell.querySelector('[data-testid="HalalBadge"], svg, [role="img"]')).toBeNull();
    expect(report).toHaveBeenCalledWith(
      'HALAL_DISPLAY_STATE_MISSING',
      expect.objectContaining({ restaurantId: 'r-1' }),
    );
  });

  it.each(['CERTIFIED', 'EXPIRING_SOON', 'EXPIRED', 'UNVERIFIED'] as const)('%s paints no danger class', (state) => {
    render(<HalalStateCell state={state} expiresOn="2026-10-20" />);
    const html = screen.getByTestId('HalalStateCell').outerHTML;
    expect(html).not.toMatch(/danger|(?<![a-z])red-/);
    expect(screen.getByTestId('HalalStateCell')).not.toHaveTextContent(HALAL_STATE_MISSING_TEXT);
  });
});

describe('W6 sources (invariant 10, fills not left borders, tokens only)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const files = [
    '../DataTable.tsx',
    '../cells.tsx',
    '../data-format.ts',
    '../../lib/ui/data-grid.tsx',
    '../../lib/ui/toggle.tsx',
    '../../lib/ui/list-pane.tsx',
    '../../proposed/FilterBar.tsx',
    '../../proposed/FilterChip.tsx',
    '../../proposed/ListPaneRow.tsx',
    '../../proposed/EventLog.tsx',
  ];
  it.each(files)('%s: no success solid, ramp step, colour literal or left-border state', (file) => {
    // Code only: comments cite issue numbers ("#141") that look like colour literals.
    const source = readFileSync(join(here, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/bg-(feedback-)?success(?!-tint)/);
    expect(source).not.toMatch(/\b(brand|accent|neutral|success|warning|danger|info)-\d{2,3}\b/);
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(source).not.toMatch(/border-l\b|border-l-|border-s-|borderLeft|border-inline-start/);
  });
});

function Harness({ onActivate }: { onActivate: (r: Row) => void }) {
  const [sort, setSort] = useState<{
    key: string;
    direction: 'ascending' | 'descending';
  }>({ key: 'total', direction: 'descending' });
  const [selection, setSelection] = useState<string[]>([]);
  return (
    <DataTable<Row>
      caption="Restaurants"
      columns={COLS}
      rows={ROWS}
      sort={sort}
      onSortChange={setSort}
      selection={selection}
      onSelectionChange={setSelection}
      onRowActivate={onActivate}
      rowLabel={(r) => r.name}
      rowActions={() => [{ key: 'open', label: 'Open' }]}
    />
  );
}

describe('DataTable behaviour', () => {
  it('a sort change is announced and moves aria-sort', () => {
    render(<Harness onActivate={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Restaurant/ }));
    expect(screen.getByTestId('DataTable-announcer')).toHaveTextContent('Sorted by Restaurant, ascending');
    const [, name, total] = screen.getAllByRole('columnheader');
    expect(name).toHaveAttribute('aria-sort', 'ascending');
    expect(total).toHaveAttribute('aria-sort', 'none');
  });

  it('selection: the count is announced; select-all selects the page; selected rows are aria-selected', () => {
    render(<Harness onActivate={() => {}} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Karahi House' }));
    expect(screen.getByTestId('DataTable-announcer')).toHaveTextContent('1 row selected');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }));
    expect(screen.getByTestId('DataTable-announcer')).toHaveTextContent('2 rows selected');
    const rows = screen.getAllByRole('row').filter((r) => r.getAttribute('data-ln-row') === 'true');
    expect(rows.every((r) => r.getAttribute('aria-selected') === 'true')).toBe(true);
  });

  it('Enter on a cell activates the row; Space toggles its selection; a control in a cell does not activate', () => {
    const onActivate = vi.fn();
    render(<Harness onActivate={onActivate} />);
    const cell = screen.getAllByRole('gridcell').find((c) => c.textContent === 'Zaytoun Grill')!;
    fireEvent.keyDown(cell, { key: 'Enter' });
    expect(onActivate).toHaveBeenCalledWith(ROWS[0]);
    fireEvent.click(cell);
    expect(onActivate).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(cell, { key: ' ' });
    expect(screen.getByRole('checkbox', { name: 'Select Zaytoun Grill' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Zaytoun Grill' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Karahi House' }));
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it('filtered-to-nothing offers Clear filters; no records does not', () => {
    const onClearFilters = vi.fn();
    const { rerender } = render(
      <DataTable<Row> caption="Restaurants" columns={COLS} rows={[]} filtersActive onClearFilters={onClearFilters} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClearFilters).toHaveBeenCalledOnce();
    rerender(
      <DataTable<Row>
        caption="Restaurants"
        columns={COLS}
        rows={[]}
        emptyState={{
          title: 'No restaurants yet',
          description: 'Approved restaurants appear here.',
        }}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    expect(screen.getByText('No restaurants yet')).toBeInTheDocument();
  });

  it('error keeps the header and Retry calls back', () => {
    const onRetry = vi.fn();
    render(
      <DataTable<Row>
        caption="Restaurants"
        columns={COLS}
        rows={ROWS}
        status="error"
        onRetry={onRetry}
        errorMessage="Timed out."
      />,
    );
    expect(screen.getAllByRole('columnheader')).toHaveLength(2);
    expect(screen.queryAllByRole('gridcell')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /Retry|Try again/ }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('the row open beside the list is aria-current', () => {
    render(<DataTable<Row> caption="Restaurants" columns={COLS} rows={ROWS} activeRowId="b" />);
    const rows = screen.getAllByRole('row').filter((r) => r.getAttribute('data-ln-row') === 'true');
    expect(rows.map((r) => r.getAttribute('aria-current'))).toEqual([null, 'true']);
  });
});
