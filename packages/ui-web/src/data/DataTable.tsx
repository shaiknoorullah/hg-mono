import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';

import { Checkbox, Skeleton } from '../primitives/index.js';
import {
  EmptyState,
  emptyAfterFilter,
  emptyNoRecords,
  emptyQueueDrained,
} from '../feedback/EmptyState.js';
import { ErrorState } from '../feedback/ErrorState.js';
import {
  cx,
  DENSITY_CELL_PADDING,
  DENSITY_ROW_HEIGHT,
  formatAbsoluteDateTime,
} from '../feedback/internal.js';
import { Pagination, type PaginationMode } from './Pagination.js';
import { PiiCell } from './PiiCell.js';
import { useGridKeyboard } from './useGridKeyboard.js';
import type {
  DataTableColumn,
  DataTableDrained,
  DataTableError,
  DataTableRowAction,
  DataTableSelection,
  DataTableSort,
  Density,
  PageMeta,
  PiiRevealHandler,
} from './types.js';

/**
 * `DataTable` — the load-bearing admin component (§24, patterns §4.1 and §4.4).
 *
 * The four things that make it the load-bearing one:
 *
 * 1. **PII is masked by default and there is no prop to change that.** See `types.ts` for
 *    the full argument. A column is `pii` or it is not; a `pii` column renders through
 *    `PiiCell`, which starts masked and can only unmask via a justified, audited server
 *    round-trip. `onRevealPii` absent ⇒ no reveal control exists.
 * 2. **Keyset pagination exactly as the contract defines it.** `?limit&cursor` in,
 *    `meta.next_cursor` / `meta.has_more` out. No page numbers, no total-driven paging.
 * 3. **Every state is implemented**: loading (skeleton rows in the real column geometry,
 *    never a centred spinner that loses the header and the user's place), loading-more (a
 *    tail skeleton, loaded rows stay put), empty, empty-after-filter, queue-drained, and
 *    error — all with the header retained.
 * 4. **Full keyboard grid navigation** with a single tab stop, `aria-sort` on every
 *    sortable header, a `<caption>` naming the table, and per-row action menus with
 *    unique accessible names.
 */

const SKELETON_ROW_COUNT = 5;

export interface DataTableProps<Row> {
  /**
   * Names the table for AT. Rendered as a visually-hidden `<caption>` unless
   * `captionVisible`. Required — an unnamed table in a list of tables is unusable.
   */
  caption: string;
  captionVisible?: boolean;
  columns: readonly DataTableColumn<Row>[];
  rows: readonly Row[];
  getRowId: (row: Row) => string;
  /** "order HG-10482". Used for per-row action and reveal names. Defaults to the row id. */
  getRowLabel?: (row: Row) => string;

  sort?: DataTableSort | null;
  /**
   * Server-side. Reset the cursor when this fires — a keyset cursor encodes the sort
   * tuple (`useCursorPagination().reset()`).
   */
  onSortChange?: (sort: DataTableSort) => void;

  selection?: DataTableSelection;
  rowActions?: (row: Row) => readonly DataTableRowAction<Row>[];
  onRowActivate?: (row: Row) => void;

  /** Cursor pagination. Omit to render no footer. */
  pagination?: {
    meta: PageMeta | null;
    limit: number;
    onNext: () => void;
    onPrevious?: () => void;
    canGoPrevious?: boolean;
    onLimitChange?: (limit: number) => void;
    mode?: PaginationMode;
    unit?: string;
  };

  density?: Density;
  stickyHeader?: boolean;
  /** Sticks the first data column (after the checkbox), for wide admin tables. */
  stickyFirstColumn?: boolean;

  loading?: boolean;
  loadingMore?: boolean;
  error?: DataTableError | null;

  /** True when any filter is applied. Selects the *filtered-to-nothing* empty copy. */
  filtersActive?: boolean;
  onClearFilters?: () => void;
  /** Present ⇒ the empty state is the positive "queue is clear" one. */
  drained?: DataTableDrained;
  /** Overrides the derived empty state entirely. */
  emptyState?: ReactNode;
  /** Plural noun for the default empty copy: "restaurants", "orders". */
  entityPlural?: string;

  /** Absent ⇒ PII columns can never be unmasked from this table. */
  onRevealPii?: PiiRevealHandler;
  /** How long a revealed value stays visible before re-masking. Default 60 s. */
  revealTtlMs?: number;
  onPiiRevealed?: (field: string, rowId: string) => void;

  /** `id` for the "Skip to table" target. */
  id?: string;
  className?: string;
  testId?: string;
}

/**
 * Column keys that almost always carry personal data. A column whose key matches one of
 * these and carries no `pii` declaration reports itself in development — the mistake this
 * catches (adding `customer_phone` to a table and forgetting the declaration) is exactly
 * the one that would otherwise ship silently.
 */
const PII_FIELD_HEURISTICS =
  /(phone|email|address|full_?name|customer_name|postal|dob|birth|licence|license|passport|sin|iban|account_number)/i;

function useDevPiiAudit<Row>(columns: readonly DataTableColumn<Row>[], caption: string): void {
  useEffect(() => {
    if (process.env['NODE_ENV'] === 'production') return;
    for (const column of columns) {
      if (column.pii) continue;
      if (!PII_FIELD_HEURISTICS.test(column.key) && !PII_FIELD_HEURISTICS.test(column.header)) {
        continue;
      }
      // eslint-disable-next-line no-console -- a masking gap must be loud, never silent.
      console.error(
        `[hg-ui] DataTable "${caption}": column "${column.key}" looks like personal data but ` +
          'carries no `pii` declaration, so it will render unmasked. Declare ' +
          '`pii: { field: "<server field>" }` on it, or rename the column if it is not PII.',
      );
    }
  }, [columns, caption]);
}

const ALIGN_CLASS: Record<'start' | 'end' | 'center', string> = {
  start: 'text-start',
  end: 'text-end',
  center: 'text-center',
};

function contentClassName(column: DataTableColumn<unknown>): string {
  switch (column.contentClass) {
    case 'id':
      return 'font-mono text-mono-md whitespace-nowrap';
    case 'money':
    case 'numeric':
      return 'tabular-nums whitespace-nowrap';
    case 'date':
      return 'tabular-nums whitespace-nowrap';
    default:
      return '';
  }
}

function defaultAlign(column: DataTableColumn<unknown>): 'start' | 'end' | 'center' {
  if (column.align) return column.align;
  if (column.contentClass === 'money' || column.contentClass === 'numeric') return 'end';
  if (column.contentClass === 'actions') return 'end';
  return 'start';
}

export function DataTable<Row>({
  caption,
  captionVisible = false,
  columns,
  rows,
  getRowId,
  getRowLabel,
  sort,
  onSortChange,
  selection,
  rowActions,
  onRowActivate,
  pagination,
  density = 'compact',
  stickyHeader = true,
  stickyFirstColumn = false,
  loading = false,
  loadingMore = false,
  error,
  filtersActive = false,
  onClearFilters,
  drained,
  emptyState,
  entityPlural = 'records',
  onRevealPii,
  revealTtlMs,
  onPiiRevealed,
  id,
  className,
  testId = 'data-table',
}: DataTableProps<Row>): ReactNode {
  useDevPiiAudit(columns, caption);

  const visibleColumns = useMemo(() => columns.filter(Boolean), [columns]);
  const hasSelection = !!selection;
  const hasRowActions = !!rowActions;
  const leadingCols = hasSelection ? 1 : 0;
  const colCount = leadingCols + visibleColumns.length + (hasRowActions ? 1 : 0);

  const rowLabel = (row: Row): string => getRowLabel?.(row) ?? getRowId(row);

  const rowText = useMemo(() => {
    const textColumn = visibleColumns.find((column) => column.textValue);
    if (!textColumn?.textValue) return undefined;
    return rows.map((row) => textColumn.textValue!(row));
  }, [rows, visibleColumns]);

  const grid = useGridKeyboard({
    rowCount: rows.length,
    colCount,
    ...(rowText ? { rowText } : {}),
    ...(onRowActivate ? { onActivate: (index: number) => {
      const row = rows[index];
      if (row) onRowActivate(row);
    } } : {}),
    ...(selection ? { onToggleSelect: (index: number) => {
      const row = rows[index];
      if (row) toggleRow(getRowId(row));
    } } : {}),
  });

  /* Sorting and selection both announce, politely, without moving focus. */
  const liveRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    if (!liveRef.current) return;
    if (!sort) return;
    const column = visibleColumns.find((candidate) => candidate.sortKey === sort.key);
    if (!column) return;
    liveRef.current.textContent = `Sorted by ${column.header}, ${
      sort.direction === 'asc' ? 'ascending' : 'descending'
    }`;
  }, [sort, visibleColumns]);

  const selectedIds = selection?.selectedIds ?? [];
  useEffect(() => {
    if (!liveRef.current || !selection) return;
    liveRef.current.textContent = `${selectedIds.length} of ${rows.length} ${entityPlural} selected`;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- announce on count change only
  }, [selectedIds.length]);

  function toggleRow(rowId: string): void {
    if (!selection) return;
    if (selection.isSelectable && !selection.isSelectable(rowId)) return;
    const set = new Set(selection.selectedIds);
    if (set.has(rowId)) set.delete(rowId);
    else set.add(rowId);
    selection.onChange([...set]);
  }

  function toggleAll(): void {
    if (!selection) return;
    const selectable = rows
      .map(getRowId)
      .filter((rowId) => !selection.isSelectable || selection.isSelectable(rowId));
    const allSelected = selectable.length > 0 && selectable.every((rowId) => selectedIds.includes(rowId));
    selection.onChange(allSelected ? [] : selectable);
  }

  function handleSort(column: DataTableColumn<Row>): void {
    if (!column.sortKey || !onSortChange) return;
    const direction: 'asc' | 'desc' =
      sort?.key === column.sortKey && sort.direction === 'asc' ? 'desc' : 'asc';
    onSortChange({ key: column.sortKey, direction });
  }

  const bodyState: 'rows' | 'loading' | 'empty' | 'error' = error
    ? 'error'
    : loading
      ? 'loading'
      : rows.length === 0
        ? 'empty'
        : 'rows';

  return (
    <div
      id={id}
      data-testid={testId}
      // Switches --hg-density-* for this subtree; every cell reads it rather than
      // hard-coding a height the theme would then silently override.
      data-hg-density={density}
      data-density={density}
      data-state={bodyState}
      className={cx(
        'flex min-w-0 flex-col rounded-md border border-line-decorative bg-surface-base',
        className,
      )}
    >
      <div className="min-w-0 overflow-x-auto">
        <table
          ref={grid.tableRef}
          {...grid.gridProps}
          // Real table semantics, plus the grid role that makes cell navigation legitimate.
          role="grid"
          aria-rowcount={rows.length + 1}
          aria-colcount={colCount}
          aria-busy={loading || undefined}
          className="w-full border-collapse"
        >
          <caption className={cx(captionVisible ? 'px-3 py-2 text-start text-fg-secondary' : 'sr-only')}>
            {caption}
          </caption>

          {/* The header is retained in every single state — loading, empty and error
              included. Losing it loses the user's place. */}
          <thead
            className={cx(
              'bg-surface-subtle',
              stickyHeader && 'sticky top-0 z-[var(--hg-z-sticky)]',
            )}
          >
            <tr>
              {hasSelection ? (
                <th
                  scope="col"
                  {...grid.cellProps(0, 0)}
                  className={cx(
                    'w-12 border-b border-line-decorative',
                    DENSITY_CELL_PADDING,
                    'hg-focus-inset',
                  )}
                >
                  <Checkbox
                    label={`Select all ${entityPlural} on this page`}
                    hideLabel
                    checked={rows.length > 0 && rows.map(getRowId).every((rowId) => selectedIds.includes(rowId))}
                    indeterminate={selectedIds.length > 0 && selectedIds.length < rows.length}
                    onChange={toggleAll}
                  />
                </th>
              ) : null}

              {visibleColumns.map((column, columnIndex) => {
                const sortable = !!column.sortKey && !!onSortChange;
                const active = !!column.sortKey && sort?.key === column.sortKey;
                const ariaSort = !sortable
                  ? undefined
                  : active
                    ? sort!.direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none';

                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={ariaSort}
                    style={column.width ? { inlineSize: column.width } : undefined}
                    {...grid.cellProps(0, leadingCols + columnIndex)}
                    className={cx(
                      'border-b border-line-decorative text-label-md font-semibold text-fg-secondary',
                      DENSITY_CELL_PADDING,
                      ALIGN_CLASS[defaultAlign(column as DataTableColumn<unknown>)],
                      stickyFirstColumn && columnIndex === 0 && 'sticky start-0 bg-surface-subtle',
                      'hg-focus-inset',
                    )}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        data-testid={`${testId}-sort-${column.key}`}
                        onClick={() => handleSort(column)}
                        className={cx(
                          'inline-flex min-h-11 items-center gap-1 text-inherit',
                          'hg-focus-inset',
                        )}
                      >
                        <span>{column.header}</span>
                        <SortGlyph direction={active ? sort!.direction : null} />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}

              {hasRowActions ? (
                <th
                  scope="col"
                  {...grid.cellProps(0, colCount - 1)}
                  className={cx(
                    'w-16 border-b border-line-decorative text-end',
                    DENSITY_CELL_PADDING,
                    'hg-focus-inset',
                  )}
                >
                  <span className="sr-only">Actions</span>
                </th>
              ) : null}
            </tr>
          </thead>

          <tbody>
            {bodyState === 'loading' ? (
              /* Skeleton rows in the real column geometry — never a centred spinner. */
              Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
                <SkeletonRow
                  key={`skeleton-${index}`}
                  colCount={colCount}
                  testId={`${testId}-skeleton-row`}
                />
              ))
            ) : bodyState === 'error' ? (
              <tr>
                <td colSpan={colCount} className="p-0">
                  <ErrorState
                    variant="table"
                    testId={`${testId}-error`}
                    errorCode={error?.code}
                    onRetry={error?.onRetry}
                    technicalDetail={{
                      code: error?.code ?? null,
                      requestId: error?.requestId ?? null,
                      message: error?.message ?? null,
                    }}
                    headingLevel={3}
                    focusOnMount={false}
                  />
                </td>
              </tr>
            ) : bodyState === 'empty' ? (
              <tr>
                <td colSpan={colCount} className="p-0">
                  {emptyState ?? (
                    <EmptyState
                      variant="table"
                      headingLevel={3}
                      testId={`${testId}-empty`}
                      {...(filtersActive
                        ? emptyAfterFilter()
                        : drained
                          ? emptyQueueDrained(drained.queueName, drained.lastProcessedAt)
                          : emptyNoRecords(entityPlural))}
                      {...(filtersActive && onClearFilters
                        ? { primaryAction: { label: 'Clear filters', onPress: onClearFilters } }
                        : {})}
                      {...(!filtersActive && drained?.lastProcessedAt
                        ? {
                            meta: `Last processed ${formatAbsoluteDateTime(drained.lastProcessedAt)}`,
                          }
                        : {})}
                    />
                  )}
                </td>
              </tr>
            ) : (
              rows.map((row, rowIndex) => {
                const rowId = getRowId(row);
                const selected = selectedIds.includes(rowId);
                const label = rowLabel(row);

                return (
                  <tr
                    key={rowId}
                    data-testid={`${testId}-row`}
                    data-row-id={rowId}
                    data-selected={selected || undefined}
                    aria-selected={hasSelection ? selected : undefined}
                    className={cx(
                      'border-b border-line-decorative last:border-b-0',
                      selected ? 'bg-control-selected-bg' : 'hover:bg-surface-subtle',
                    )}
                  >
                    {hasSelection ? (
                      <td
                        {...grid.cellProps(rowIndex + 1, 0)}
                        className={cx(
                          DENSITY_CELL_PADDING,
                          'hg-focus-inset',
                        )}
                      >
                        <Checkbox
                          label={`Select ${label}`}
                          hideLabel
                          checked={selected}
                          disabled={selection?.isSelectable ? !selection.isSelectable(rowId) : false}
                          onChange={() => toggleRow(rowId)}
                        />
                      </td>
                    ) : null}

                    {visibleColumns.map((column, columnIndex) => (
                      <td
                        key={column.key}
                        {...grid.cellProps(rowIndex + 1, leadingCols + columnIndex)}
                        className={cx(
                          'text-body-sm text-fg-primary',
                          DENSITY_CELL_PADDING,
                          ALIGN_CLASS[defaultAlign(column as DataTableColumn<unknown>)],
                          contentClassName(column as DataTableColumn<unknown>),
                          stickyFirstColumn && columnIndex === 0 && 'sticky start-0 bg-inherit',
                          'hg-focus-inset',
                        )}
                      >
                        {column.pii ? (
                          <PiiCell
                            rowId={rowId}
                            rowLabel={label}
                            columnHeader={column.header}
                            spec={column.pii}
                            render={(context) => column.cell(row, context)}
                            testId={`${testId}-pii-${column.key}`}
                            {...(onRevealPii ? { handler: onRevealPii } : {})}
                            {...(revealTtlMs ? { ttlMs: revealTtlMs } : {})}
                            {...(onPiiRevealed ? { onRevealed: onPiiRevealed } : {})}
                          />
                        ) : (
                          // Non-PII cells still receive the context, so a renderer shared
                          // between a masked and an unmasked table cannot drift.
                          column.cell(row, { revealed: false })
                        )}
                      </td>
                    ))}

                    {hasRowActions ? (
                      <td
                        {...grid.cellProps(rowIndex + 1, colCount - 1)}
                        className={cx(
                          'text-end',
                          DENSITY_CELL_PADDING,
                          'hg-focus-inset',
                        )}
                      >
                        <RowActionsMenu
                          actions={rowActions(row)}
                          row={row}
                          /* Unique name per row — never five identical "Actions" buttons. */
                          label={`Actions for ${label}`}
                          testId={`${testId}-actions`}
                        />
                      </td>
                    ) : null}
                  </tr>
                );
              })
            )}

            {/* Loading-more appends at the tail. The loaded rows do not move. */}
            {loadingMore && bodyState === 'rows' ? (
              <SkeletonRow colCount={colCount} testId={`${testId}-skeleton-tail`} />
            ) : null}
          </tbody>
        </table>
      </div>

      {pagination ? (
        <Pagination
          meta={pagination.meta}
          loadedCount={rows.length}
          limit={pagination.limit}
          onNext={pagination.onNext}
          loading={loadingMore}
          unit={pagination.unit ?? entityPlural}
          testId={`${testId}-pagination`}
          {...(pagination.onPrevious ? { onPrevious: pagination.onPrevious } : {})}
          {...(pagination.canGoPrevious !== undefined
            ? { canGoPrevious: pagination.canGoPrevious }
            : {})}
          {...(pagination.onLimitChange ? { onLimitChange: pagination.onLimitChange } : {})}
          {...(pagination.mode ? { mode: pagination.mode } : {})}
        />
      ) : null}

      <p ref={liveRef} aria-live="polite" className="sr-only" />
    </div>
  );
}

function SkeletonRow({ colCount, testId }: { colCount: number; testId: string }): ReactNode {
  return (
    <tr
      data-testid={testId}
      aria-hidden="true"
      className={cx('border-b border-line-decorative', DENSITY_ROW_HEIGHT)}
    >
      {Array.from({ length: colCount }, (_, index) => (
        <td key={index} className={DENSITY_CELL_PADDING}>
          {/* The foundation's Skeleton, so the shimmer and the reduced-motion
              fallback are the same everywhere in the product. */}
          <Skeleton variant="text" lines={1} />
        </td>
      ))}
    </tr>
  );
}

function RowActionsMenu<Row>({
  actions,
  row,
  label,
  testId,
}: {
  actions: readonly DataTableRowAction<Row>[];
  row: Row;
  label: string;
  testId: string;
}): ReactNode {
  if (!actions.length) return null;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={label}
        data-testid={testId}
        className={cx(
          'inline-flex size-11 items-center justify-center rounded-md text-fg-secondary',
          'hover:bg-surface-subtle',
          'hg-focus-inset',
        )}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width={18}
          height={18}
          fill="currentColor"
        >
          <circle cx="12" cy="5" r="1.75" />
          <circle cx="12" cy="12" r="1.75" />
          <circle cx="12" cy="19" r="1.75" />
        </svg>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-[var(--hg-z-dropdown)] min-w-48 rounded-md border border-line-decorative bg-surface-raised p-1 shadow-e3"
        >
          {actions.map((action) => (
            <DropdownMenu.Item
              key={action.key}
              disabled={action.disabled}
              onSelect={() => action.onSelect(row)}
              data-testid={`${testId}-${action.key}`}
              className={cx(
                'flex min-h-11 cursor-pointer items-center rounded-sm px-3',
                'text-body-sm outline-none',
                'data-[highlighted]:bg-surface-subtle',
                action.destructive ? 'text-feedback-danger-text' : 'text-fg-primary',
                'data-[disabled]:pointer-events-none data-[disabled]:opacity-[var(--hg-state-disabled-opacity)]',
              )}
            >
              <span>{action.label}</span>
              {action.disabled && action.disabledReason ? (
                <span className="sr-only"> — {action.disabledReason}</span>
              ) : null}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function SortGlyph({ direction }: { direction: 'asc' | 'desc' | null }): ReactNode {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx(direction === null && 'opacity-40')}
    >
      {direction === 'desc' ? <path d="m6 9 6 6 6-6" /> : <path d="m6 15 6-6 6 6" />}
    </svg>
  );
}
