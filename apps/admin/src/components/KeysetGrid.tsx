/**
 * The reusable LyteNyte-backed keyset grid.
 *
 * `contracts/openapi.yaml` §Pagination: "one scheme everywhere: keyset" — `?limit=` /
 * `?cursor=`, response `meta = {next_cursor, has_more}`. This component pairs `@hg/ui-web`'s
 * `useCursorPagination` / `Pagination` (the cursor-stack machine and its "pages" control) with
 * `@1771technologies/lytenyte-core`'s `Grid` for the row surface: each fetched page is handed
 * to the grid as a plain client data source — LyteNyte owns virtualised rendering of *this*
 * page, the cursor stack owns which page that is. Nothing here re-implements offset paging.
 *
 * Loading / empty / error are real, driven by the caller's `AsyncState` (repo rule: every
 * screen implements all three).
 *
 * Styling is LyteNyte's structural `grid.css` plus our generated `@hg/ui-web/grid-theme.css`,
 * and both only apply under the `ln-grid` class on the wrapper below. Never also import one
 * of LyteNyte's own themes (`light-dark.css` and friends): they write their palette onto
 * `:root` and key dark mode on a `.dark` class this app never sets. The test in
 * `smoke/grid-styles.test.tsx` pins all three
 * (https://github.com/shaiknoorullah/hg-mono/issues/145).
 */
import { useMemo, type ReactNode } from 'react';
import { Grid, useClientDataSource } from '@1771technologies/lytenyte-core';
import '@1771technologies/lytenyte-core/grid.css';
import '@hg/ui-web/grid-theme.css';
import { EmptyState, ErrorState, Pagination, Skeleton, type PageMeta } from '@hg/ui-web';
import type { UseCursorPaginationResult } from '@hg/ui-web';

export interface GridColumn<T> {
  id: string;
  name: string;
  width?: number;
  render: (row: T) => ReactNode;
}

export interface KeysetGridProps<T> {
  columns: readonly GridColumn<T>[];
  rows: readonly T[];
  meta: PageMeta | null;
  pagination: UseCursorPaginationResult;
  loading: boolean;
  error: { code: string; message: string } | null;
  onRetry: () => void;
  getRowId: (row: T) => string;
  onRowActivate?: (row: T) => void;
  unit: string;
  emptyTitle: string;
  emptyDescription: string;
  height?: number;
}

export function KeysetGrid<T>({
  columns,
  rows,
  meta,
  pagination,
  loading,
  error,
  onRetry,
  getRowId,
  onRowActivate,
  unit,
  emptyTitle,
  emptyDescription,
  height = 480,
}: KeysetGridProps<T>) {
  interface Spec {
    data: T;
  }
  type GridColumnSpec = Grid.Column<Spec>;

  const gridColumns = useMemo<GridColumnSpec[]>(
    () =>
      columns.map(
        (col): GridColumnSpec => ({
          id: col.id,
          name: col.name,
          width: col.width,
          cellRenderer: (params) => {
            const row = params.row;
            const data = row.kind === 'leaf' ? row.data : null;
            return data != null ? col.render(data) : null;
          },
        }),
      ),
    [columns],
  );

  const source = useClientDataSource<Spec['data']>({
    data: rows as T[],
    leafIdFn: (row: T) => getRowId(row),
  });

  if (loading && rows.length === 0) {
    return (
      <div className="adm-stack" aria-busy="true" aria-label={`Loading ${unit}`}>
        <Skeleton height={40} />
        <Skeleton height={height} />
      </div>
    );
  }

  if (error) {
    return <ErrorState variant="page" errorCode={error.code} description={error.message} onRetry={onRetry} />;
  }

  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="adm-stack">
      {/* `ln-grid` is what LyteNyte's stylesheet and our theme are scoped to; the theme
          also draws the frame (border, radius, clip) on it. */}
      <div className="ln-grid" style={{ height }}>
        <Grid<Spec>
          columns={gridColumns}
          rowSource={source}
          rowHeight={44}
          // Each column's `width` is its floor; spare width is shared out, so the rows and
          // their rules run the full width of the frame as DataTable's do. When the floors
          // don't fit (a phone), the grid scrolls sideways inside its frame instead.
          columnBase={{ widthFlex: 1 }}
          events={
            onRowActivate
              ? {
                  // Wired on `cell`, deliberately not `row`. LyteNyte's row wrapper is a
                  // zero-height, `pointer-events: none` positioning shim for unpinned rows
                  // (`useRowStyle`: `height: isTranslated ? 0 : height`) — its own `onClick`
                  // only ever fires by bubbling up from a cell, and it has no real hit-testable
                  // geometry of its own (this is what made the row nav flaky: clicking near a
                  // row edge, or any programmatic click on the row element itself, could land
                  // outside any actionable target). Each `role="gridcell"` child is the real
                  // interactive unit — full row height, `pointer-events: all` — so activation
                  // is wired there for both pointer and keyboard Enter. Keyboard path: the grid
                  // is ONE Tab stop (its viewport; LyteNyte hands Tab straight back out of the
                  // grid), the arrow keys move focus between cells and rows from there, and
                  // Enter on a focused cell activates its row. Tab does not walk the cells.
                  cell: {
                    click: ({ row }) => {
                      const data = row.kind === 'leaf' ? row.data : null;
                      if (data != null) onRowActivate(data);
                    },
                    keyDown: ({ event, row }) => {
                      if (event.key !== 'Enter') return;
                      const data = row.kind === 'leaf' ? row.data : null;
                      if (data != null) onRowActivate(data);
                    },
                  },
                }
              : undefined
          }
        />
      </div>
      <Pagination
        meta={meta}
        loadedCount={rows.length}
        onNext={() => pagination.next(meta)}
        onPrevious={pagination.previous}
        canGoPrevious={pagination.canGoPrevious}
        mode="pages"
        limit={pagination.limit}
        onLimitChange={pagination.setLimit}
        loading={loading}
        unit={unit}
      />
    </div>
  );
}
