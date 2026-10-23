/**
 * `DataTable` — admin and restaurant lists (02-components.md §24; #141), on LyteNyte Grid Core
 * 2.x with the design-system contract of the live `index.d.ts`:
 *
 * - **Named.** `caption` is required. LyteNyte renders ARIA grid roles, not table elements, so the
 *   grid is `role="grid"` named by the caption through `aria-labelledby` (design-system plan,
 *   risk 9). `hideCaption` keeps the name and hides the text.
 * - **Server-side sort.** Sortable headers are buttons; the header cell carries `aria-sort`; a
 *   change of `sort` is announced ("Sorted by Total, descending").
 * - **Selection.** With `onSelectionChange`, a checkbox column (and a select-all header) appears.
 *   The selected row is a filled tint AND a checked box, never colour alone. The count is
 *   announced. Space toggles the focused row.
 * - **Activation.** Enter on a cell, or a click, calls `onRowActivate` (not from a control
 *   inside the cell).
 * - **Row actions.** `rowActions` adds a pinned end column with a menu button named
 *   "Actions for {rowLabel}".
 * - **Density.** `compact` rows are the token `density.compact.rowHeight` (44px);
 *   `comfortable` 64px.
 * - **States, header always kept.** `loading` draws 5 skeleton rows in the real column
 *   geometry; `loadingMore` adds a tail skeleton; `error` shows ErrorState with Retry; empty
 *   says why and what next, and "no results for these filters" (with Clear filters) is distinct
 *   from "no records". A failed next page (`loadMoreError`) keeps the loaded rows and shows an
 *   inline alert with Try again.
 * - **Cursor paging only.** `hasMore` + `onLoadMore` → "Load more"; no page numbers, no total.
 *
 * Styling is LyteNyte's structural `grid.css` plus our generated `grid-theme.css`, scoped under
 * `.ln-grid` (#145). Cells come from `./cells.tsx`.
 */

import '@1771technologies/lytenyte-core/grid.css';
import '../tokens/grid-theme.css';

import { Grid, useClientDataSource } from '@1771technologies/lytenyte-core';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ComponentProps,
  type ReactNode,
} from 'react';

import { cn } from '../lib/utils.js';
import {
  GridCheckGlyph,
  GridCheckbox,
  GridChevronGlyph,
  GridMinusGlyph,
  GridMoreGlyph,
  GridRowMenu,
  GridRowMenuContent,
  GridRowMenuItem,
  GridRowMenuSeparator,
  GridRowMenuTrigger,
  GridSortButton,
} from '../lib/ui/data-grid.js';
import { Banner, EmptyState, ErrorState, Skeleton } from '../proposed/index.js';
import { density as densityTokens } from '../tokens/tokens.js';
import { Button, Icon, type DsIconName } from './index.js';

/** A sort: the column key and direction. */
export interface DataTableSortState {
  key: string;
  direction: 'ascending' | 'descending';
}

/** One row-action item; the same shape as the live `MenuItem`. */
export type DataTableMenuItem =
  | {
      /** Returned to onSelect. Defaults to the label. */
      key?: string;
      label: string;
      icon?: DsIconName;
      hint?: string;
      /** Danger TEXT with a verb, never a fill. */
      destructive?: boolean;
      /** Stays focusable (aria-disabled) so its reason can be read; cannot be activated. */
      disabled?: boolean;
      disabledReason?: string;
      onSelect?: (item: DataTableMenuItem) => void;
      type?: undefined;
    }
  | { type: 'separator' };

/** A column of the live `DataTableColumn`, plus `header` (a node instead of the label text). */
export interface DataTableColumn<Row> {
  key: string;
  label: string;
  /** Logical alignment; money and counts are `end`. */
  align?: 'start' | 'end';
  /** Ids: mono family, tabular. */
  mono?: boolean;
  numeric?: boolean;
  muted?: boolean;
  sortable?: boolean;
  /** px number, or a CSS length in px or rem. */
  width?: string | number;
  render?: (row: Row) => ReactNode;
  /** Optional header content in place of `label` (the admin stub's `header`); `label` stays the name. */
  header?: ReactNode;
}

/** Props of the live `DataTable`, plus the admin console's additions (all optional). */
export interface DataTableProps<Row = Record<string, unknown>> {
  /** REQUIRED: names the grid. */
  caption: string;
  hideCaption?: boolean;
  columns: DataTableColumn<Row>[];
  rows: Row[];
  getRowId?: (row: Row) => string;
  /** Server-side sort. Headers get aria-sort; changes are announced. */
  sort?: DataTableSortState;
  onSortChange?: (sort: DataTableSortState) => void;
  /** Selected row ids; with onSelectionChange renders a checkbox column. Count is announced. */
  selection?: string[];
  onSelectionChange?: (ids: string[]) => void;
  /** Enter (keyboard) or click activates a row. */
  onRowActivate?: (row: Row) => void;
  /** Items for a per-row menu button named "Actions for {rowLabel}". */
  rowActions?: (row: Row) => DataTableMenuItem[];
  /** Also called when a row action is chosen, with its key. */
  onRowAction?: (key: string, row: Row) => void;
  /** Unique human name of a row, e.g. r => `order ${r.id}`. */
  rowLabel?: (row: Row) => string;
  /** compact = density.rowHeight (44 in compact density); comfortable 64 (the default, as the live preview draws it). */
  density?: 'compact' | 'comfortable';
  stickyHeader?: boolean;
  status?: 'ready' | 'loading' | 'error';
  errorMessage?: string;
  onRetry?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  /** The next page failed: the loaded rows stay and an inline alert offers Try again. */
  loadMoreError?: string | null;
  /** Distinguishes "no results for these filters" from "no records". */
  filtersActive?: boolean;
  onClearFilters?: () => void;
  /** Empty copy must say why it is empty and what to do next. */
  emptyState?: { title: string; description: string; action?: ReactNode };
  /** The row open beside the list (in a DetailPanel): a filled tile and `aria-current`. */
  activeRowId?: string | null;
  /** Height of the grid's scroll region (fills a split pane). Default: the rows' height. */
  height?: number | string;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: CSSProperties;
}

/** Rows the grid draws: a record, or a placeholder in the real geometry while loading. */
type GridRow<Row> = { id: string; kind: 'data'; row: Row } | { id: string; kind: 'skeleton' };
interface Spec<Row> {
  data: GridRow<Row>;
}

/** LyteNyte's layout row (the argument of `Grid.RowsCenter`'s render function). */
type LayoutRow = Parameters<NonNullable<ComponentProps<typeof Grid.RowsCenter>['children']>>[0];

/** Rows on the raised (white) surface, as the live preview draws them. Token references only. */
const RAISED = {
  '--ln-bg-ui-panel': 'var(--hg-surface-raised)',
  '--ln-bg-row-alternate': 'var(--hg-surface-raised)',
} as CSSProperties;

const SELECT_COLUMN = 'hg-select';
const ACTIONS_COLUMN = 'hg-actions';
const LOADING_ROWS = 5;

/** Header height per density: equal to the row in compact, 48 otherwise. */
const HEADER_HEIGHT = {
  compact: densityTokens.compact.rowHeight,
  comfortable: 48,
} as const;

function toPx(width: string | number | undefined, fallback: number): number {
  if (typeof width === 'number') return width;
  if (!width) return fallback;
  const n = Number.parseFloat(width);
  if (Number.isNaN(n)) return fallback;
  return width.trim().endsWith('rem') ? n * 16 : n;
}

function defaultRowId(row: unknown, index: number): string {
  const id = (row as { id?: unknown } | null)?.id;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : String(index);
}

function defaultCell(value: unknown): ReactNode {
  if (value === null || value === undefined || value === '') {
    return (
      <span className="text-fg-tertiary">
        <span aria-hidden="true">—</span>
        <span className="sr-only">Not available</span>
      </span>
    );
  }
  return typeof value === 'object' ? null : String(value);
}

/** The interactive controls inside a cell; a click on one never activates the row. */
const CONTROL_SELECTOR = 'button, a, input, select, textarea, [role="checkbox"], [role="menuitem"]';

/** A design-system data grid on LyteNyte Core. */
export function DataTable<Row>(props: DataTableProps<Row>) {
  const {
    caption,
    hideCaption = false,
    columns,
    rows,
    getRowId,
    sort,
    onSortChange,
    selection,
    onSelectionChange,
    onRowActivate,
    rowActions,
    onRowAction,
    rowLabel,
    density = 'comfortable',
    stickyHeader = false,
    status = 'ready',
    errorMessage,
    onRetry,
    hasMore = false,
    loadingMore = false,
    onLoadMore,
    loadMoreError,
    filtersActive = false,
    onClearFilters,
    emptyState,
    activeRowId,
    height,
    testId = 'DataTable',
    style,
  } = props;

  const uid = useId();
  const captionId = `${uid}-caption`;
  const footerId = `${uid}-footer`;
  const rowHeight = densityTokens[density].rowHeight;
  const headerHeight = HEADER_HEIGHT[density];

  const idOf = useCallback(
    (row: Row, index: number) => (getRowId ? getRowId(row) : defaultRowId(row, index)),
    [getRowId],
  );
  const labelOf = useCallback(
    (row: Row, index: number) => (rowLabel ? rowLabel(row) : `row ${idOf(row, index)}`),
    [rowLabel, idOf],
  );

  const loading = status === 'loading';
  const errored = status === 'error';
  const dataRows = loading || errored ? [] : rows;
  const selectable = Boolean(onSelectionChange);
  const selected = useMemo(() => new Set(selection ?? []), [selection]);

  /* ── Grid rows: records, then placeholders for a load in progress. ── */
  const gridRows = useMemo<GridRow<Row>[]>(() => {
    if (loading)
      return Array.from({ length: LOADING_ROWS }, (_, i) => ({
        id: `${uid}-sk-${i}`,
        kind: 'skeleton' as const,
      }));
    const list: GridRow<Row>[] = dataRows.map((row, i) => ({
      id: idOf(row, i),
      kind: 'data' as const,
      row,
    }));
    if (loadingMore) list.push({ id: `${uid}-sk-more`, kind: 'skeleton' });
    return list;
  }, [loading, dataRows, loadingMore, idOf, uid]);

  const source = useClientDataSource<GridRow<Row>>({
    data: gridRows,
    leafIdFn: (r) => r.id,
    rowsIsolatedSelection: true,
    rowSelection: {
      kind: 'isolated',
      selected: false,
      exceptions: new Set(selection ?? []),
    },
  });

  // A controlled selection change does not repaint rows on its own: invalidate them.
  const selectionKey = (selection ?? []).join('\u0000');
  useEffect(() => {
    source.rowInvalidate();
  }, [source, selectionKey]);

  /* ── Announcements: sort and selection changes, politely. ── */
  const [announcement, setAnnouncement] = useState('');
  // Announce changes only, never the initial value: compare with the last value seen, so a
  // StrictMode double-run of the effects (dev) or a remount stays silent.
  const sortKey = sort ? `${sort.key}\u0000${sort.direction}` : '';
  const lastSort = useRef(sortKey);
  useEffect(() => {
    if (lastSort.current === sortKey) return;
    lastSort.current = sortKey;
    if (!sort) return;
    const label = columns.find((c) => c.key === sort.key)?.label ?? sort.key;
    setAnnouncement(`Sorted by ${label}, ${sort.direction}`);
    // Only the sort itself triggers the announcement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortKey]);
  const selectionCount = selection?.length ?? 0;
  const lastSelectionCount = useRef(selectionCount);
  useEffect(() => {
    if (lastSelectionCount.current === selectionCount) return;
    lastSelectionCount.current = selectionCount;
    setAnnouncement(
      selectionCount === 0 ? 'No rows selected' : `${selectionCount} ${selectionCount === 1 ? 'row' : 'rows'} selected`,
    );
  }, [selectionCount]);

  /* ── Selection helpers. ── */
  const allIds = useMemo(() => dataRows.map((row, i) => idOf(row, i)), [dataRows, idOf]);
  const toggle = useCallback(
    (id: string) => {
      if (!onSelectionChange) return;
      const next = new Set(selection ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onSelectionChange(allIds.filter((x) => next.has(x)).concat([...next].filter((x) => !allIds.includes(x))));
    },
    [onSelectionChange, selection, allIds],
  );
  const selectedOnPage = allIds.filter((id) => selected.has(id)).length;
  const allState: boolean | 'indeterminate' =
    selectedOnPage === 0 ? false : selectedOnPage === allIds.length ? true : 'indeterminate';

  /* ── Columns. ── */
  const gridColumns = useMemo(() => {
    const list: Grid.Column<Spec<Row>>[] = [];
    if (selectable) {
      list.push({
        id: SELECT_COLUMN,
        name: 'Select',
        width: 56,
        widthMin: 56,
        headerRenderer: () => (
          <span className="flex w-full justify-center">
            <GridCheckbox
              aria-label="Select all rows"
              checked={allState}
              disabled={allIds.length === 0}
              checkedGlyph={<GridCheckGlyph />}
              indeterminateGlyph={<GridMinusGlyph />}
              onCheckedChange={() => onSelectionChange?.(allState === true ? [] : allIds)}
            />
          </span>
        ),
        cellRenderer: (p) => {
          const d = p.row.kind === 'leaf' ? p.row.data : null;
          if (!d || d.kind !== 'data') return null;
          const id = d.id;
          return (
            <span className="flex w-full justify-center">
              <GridCheckbox
                aria-label={`Select ${labelOf(d.row, p.rowIndex)}`}
                checked={selected.has(id)}
                checkedGlyph={<GridCheckGlyph />}
                onCheckedChange={() => toggle(id)}
              />
            </span>
          );
        },
      });
    }
    for (const col of columns) {
      const end = col.align === 'end' || col.numeric;
      list.push({
        id: col.key,
        name: col.label,
        type: end ? 'number' : 'string',
        width: toPx(col.width, end ? 72 : 80),
        widthMin: Math.min(toPx(col.width, 56), 56),
        headerRenderer: () => {
          const content = col.header ?? col.label;
          if (!col.sortable || !onSortChange) return <span className="truncate">{content}</span>;
          const current = sort?.key === col.key ? sort.direction : null;
          return (
            <GridSortButton
              alignEnd={end}
              onClick={() =>
                onSortChange({
                  key: col.key,
                  direction: current === 'ascending' ? 'descending' : 'ascending',
                })
              }
            >
              <span className="truncate">{content}</span>
              <span
                aria-hidden="true"
                className={cn(
                  'inline-flex transition-transform',
                  current ? 'text-fg-primary' : 'text-fg-tertiary',
                  current === 'ascending' && 'rotate-180',
                )}
              >
                <GridChevronGlyph bold={Boolean(current)} />
              </span>
            </GridSortButton>
          );
        },
        cellRenderer: (p) => {
          const d = p.row.kind === 'leaf' ? p.row.data : null;
          if (!d) return null;
          if (d.kind === 'skeleton') {
            return (
              <span
                className="flex w-full"
                data-skeleton="true"
                style={{ justifyContent: end ? 'flex-end' : 'flex-start' }}
              >
                <Skeleton variant="rect" width="70%" height={12} />
              </span>
            );
          }
          const value = col.render ? col.render(d.row) : defaultCell((d.row as Record<string, unknown>)[col.key]);
          return (
            <span
              className={cn(
                'min-w-0 truncate text-body-sm',
                col.mono && 'font-mono text-mono-sm',
                (col.mono || col.numeric || end) && 'tabular-nums',
                col.muted ? 'text-fg-secondary' : 'text-fg-primary',
              )}
            >
              {value}
            </span>
          );
        },
      });
    }
    if (rowActions) {
      list.push({
        id: ACTIONS_COLUMN,
        name: 'Actions',
        width: 64,
        widthMin: 64,
        pin: 'end',
        headerRenderer: () => <span className="sr-only">Actions</span>,
        cellRenderer: (p) => {
          const d = p.row.kind === 'leaf' ? p.row.data : null;
          if (!d || d.kind !== 'data') return null;
          const items = rowActions(d.row);
          if (!items.length) return null;
          return (
            <RowActionsMenu
              label={`Actions for ${labelOf(d.row, p.rowIndex)}`}
              items={items}
              onChoose={(key) => onRowAction?.(key, d.row)}
            />
          );
        },
      });
    }
    return list;
  }, [
    selectable,
    columns,
    rowActions,
    onRowAction,
    sort,
    onSortChange,
    allState,
    allIds,
    selected,
    toggle,
    labelOf,
    onSelectionChange,
  ]);

  /* ── Events: activation and Space-to-select on the focused cell. ── */
  const events = useMemo<Grid.Events<Spec<Row>>>(
    () => ({
      cell: {
        click: ({ row, event }) => {
          const d = row.kind === 'leaf' ? row.data : null;
          if (!d || d.kind !== 'data' || !onRowActivate) return;
          const target = event.target as HTMLElement;
          if (target.closest(CONTROL_SELECTOR)) return;
          onRowActivate(d.row);
        },
        keyDown: ({ row, event }) => {
          const d = row.kind === 'leaf' ? row.data : null;
          if (!d || d.kind !== 'data') return;
          const target = event.target as HTMLElement;
          if (target.getAttribute('data-ln-cell') !== 'true') return;
          if (event.key === 'Enter' && onRowActivate) {
            event.preventDefault();
            onRowActivate(d.row);
          } else if (event.key === ' ' && selectable) {
            event.preventDefault();
            toggle(d.id);
          }
        },
      },
    }),
    [onRowActivate, selectable, toggle],
  );

  /* ── Rows: the open row gets aria-current and the filled tile. ── */
  const renderRow = useCallback(
    (row: LayoutRow) => {
      if (row.kind === 'full-width') return <Grid.RowFullWidth row={row} />;
      const active = activeRowId != null && row.id === activeRowId;
      return (
        <Grid.Row row={row} aria-current={active ? 'true' : undefined} data-hg-active={active || undefined}>
          {row.cells.map((cell) => (
            <Grid.Cell key={cell.id} cell={cell} />
          ))}
        </Grid.Row>
      );
    },
    [activeRowId],
  );

  /* ── Body states, below the kept header. ── */
  const empty = status === 'ready' && rows.length === 0;
  let body: ReactNode = null;
  if (errored) {
    body = (
      <ErrorState
        variant="table"
        title="Couldn't load this list."
        description={errorMessage ?? 'Nothing has changed. Try again, or check your connection.'}
        onRetry={onRetry}
      />
    );
  } else if (empty && filtersActive) {
    body = (
      <EmptyState
        variant="table"
        title="No results match these filters"
        description="Records exist, but none match. Clear the filters to see everything."
        secondaryAction={onClearFilters ? { label: 'Clear filters', onPress: onClearFilters } : undefined}
      />
    );
  } else if (empty) {
    body = (
      <div className="flex flex-col items-center">
        <EmptyState
          variant="table"
          title={emptyState?.title ?? 'No records yet'}
          description={emptyState?.description ?? 'Records appear here as soon as there are any.'}
        />
        {emptyState?.action ? <div className="pb-6">{emptyState.action}</div> : null}
      </div>
    );
  }

  const bodyRows = gridRows.length;
  const contentHeight = headerHeight + bodyRows * rowHeight + 2;
  const gridHeight: string | number = height ?? (stickyHeader ? `min(${contentHeight}px, 70vh)` : contentHeight);

  const footerText = loadingMore
    ? 'Loading more…'
    : hasMore
      ? `Showing ${rows.length} · more below`
      : rows.length > 0
        ? 'End of list'
        : '';
  const showFooter = status === 'ready' && rows.length > 0;

  return (
    <section
      data-testid={testId}
      data-status={status}
      data-density={density}
      data-hg-density={density}
      style={style}
      className="flex min-w-0 flex-col gap-2"
    >
      <div
        className={cn(
          // grid-theme.css is unlayered, so the raised surface is set on the children (inline
          // custom properties inherit) rather than fought on `.ln-grid` itself.
          'ln-grid relative flex flex-col',
          // LyteNyte draws a rule between header cells; the design system's header has none.
          '[&_[data-ln-header-cell=true]]:before:content-none',
          // Tailwind's preflight (layer base) can load after grid.css (layer ln-grid) and zero the
          // cell padding and row rules; restate them as utilities, from the density tokens.
          '[&_:is([data-ln-cell=true],[data-ln-header-cell=true])]:px-(--hg-density-card-padding)',
          '[&_:is([data-ln-cell=true],[data-ln-header-cell=true])]:border-0 [&_:is([data-ln-cell=true],[data-ln-header-cell=true])]:border-b',
          '[&_:is([data-ln-cell=true],[data-ln-header-cell=true])]:border-solid [&_:is([data-ln-cell=true],[data-ln-header-cell=true])]:border-line-decorative',
          '[&_[data-hg-active=true]_[data-ln-cell=true]]:bg-accent [&_[data-hg-active=true]_[data-ln-cell=true]]:font-semibold',
        )}
      >
        <div
          id={captionId}
          className={cn(
            'border-0 border-b border-solid border-line-decorative bg-surface-raised px-3 py-3 text-label-lg font-semibold text-fg-primary',
            hideCaption && 'sr-only',
          )}
        >
          {caption}
        </div>
        <div style={{ height: gridHeight, ...RAISED }}>
          <Grid<Spec<Row>>
            columns={gridColumns}
            rowSource={source}
            rowHeight={rowHeight}
            headerHeight={headerHeight}
            columnBase={{ widthFlex: 1 }}
            rowSelectionMode={selectable ? 'multiple' : 'none'}
            rowSelectionActivator="none"
            virtualizeRows={bodyRows > 60}
            viewportInitialHeight={typeof gridHeight === 'number' ? gridHeight : 600}
            viewportInitialWidth={1024}
            events={events}
          >
            <Grid.Viewport
              aria-labelledby={captionId}
              aria-describedby={showFooter ? footerId : undefined}
              aria-busy={loading || loadingMore || undefined}
            >
              <Grid.Header>
                {(cells) => (
                  <Grid.HeaderRow>
                    {cells.map((cell) => {
                      if (cell.kind !== 'cell') return null;
                      const col = columns.find((c) => c.key === cell.id);
                      const ariaSort = col?.sortable ? (sort?.key === col.key ? sort.direction : 'none') : undefined;
                      return <Grid.HeaderCell key={cell.id} cell={cell} aria-sort={ariaSort} />;
                    })}
                  </Grid.HeaderRow>
                )}
              </Grid.Header>
              <Grid.RowsContainer>
                <Grid.RowsCenter>{renderRow}</Grid.RowsCenter>
              </Grid.RowsContainer>
            </Grid.Viewport>
          </Grid>
        </div>
        {loading ? (
          <span role="status" className="sr-only">
            Loading {caption}
          </span>
        ) : null}
        {body ? (
          <div className="border-0 border-t border-solid border-line-decorative bg-surface-raised">{body}</div>
        ) : null}
        {showFooter ? (
          <div className="relative flex min-h-14 items-center justify-center gap-3 border-0 border-t border-solid border-line-decorative bg-surface-raised px-3 py-2">
            <p id={footerId} className="absolute start-3 m-0 text-body-sm tabular-nums text-fg-secondary">
              {footerText}
            </p>
            {hasMore && onLoadMore && !loadMoreError ? (
              <Button variant="tertiary" size="md" loading={loadingMore} onPress={() => onLoadMore()}>
                Load more
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {loadMoreError && rows.length > 0 ? (
        <Banner
          variant="danger"
          title="More didn't load."
          description={loadMoreError}
          action={onLoadMore ? { label: 'Try again', onPress: onLoadMore } : undefined}
        />
      ) : null}

      <p aria-live="polite" className="sr-only" data-testid={`${testId}-announcer`}>
        {announcement}
      </p>
    </section>
  );
}

/** The per-row menu: Radix DropdownMenu until the design-system Menu is wired in. */
function RowActionsMenu({
  label,
  items,
  onChoose,
}: {
  label: string;
  items: DataTableMenuItem[];
  onChoose: (key: string) => void;
}) {
  return (
    <GridRowMenu>
      <GridRowMenuTrigger aria-label={label}>
        <GridMoreGlyph />
      </GridRowMenuTrigger>
      <GridRowMenuContent aria-label={label}>
        {items.map((item, i) =>
          item.type === 'separator' ? (
            <GridRowMenuSeparator key={`sep-${i}`} />
          ) : (
            <GridRowMenuItem
              key={item.key ?? item.label}
              destructive={item.destructive}
              unavailable={item.disabled}
              onSelect={() => {
                item.onSelect?.(item);
                onChoose(item.key ?? item.label);
              }}
            >
              {item.icon ? <Icon name={item.icon} size="sm" /> : null}
              <span className="flex flex-1 flex-col">
                <span>{item.label}</span>
                {item.disabled && item.disabledReason ? (
                  <span className="text-body-sm text-fg-secondary">{item.disabledReason}</span>
                ) : null}
              </span>
              {item.hint ? <span className="text-label-sm text-fg-tertiary">{item.hint}</span> : null}
            </GridRowMenuItem>
          ),
        )}
      </GridRowMenuContent>
    </GridRowMenu>
  );
}
