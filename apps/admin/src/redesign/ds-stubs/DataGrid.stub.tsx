/**
 * TEMPORARY stub until @hg/ui-web/ds ships DataGrid (ds-request issue TBD; tracked under #141).
 * Props follow the canvases' drawing ("DataGrid (LyteNyte, 44px rows, virtualised in this
 * region; DataTable stand-in)", "the selected row is a filled tile, never a side bar").
 *
 * A semantic `role="grid"` table for admin lists, used instead of LyteNyte for now: LyteNyte
 * renders rows as positioned divs and needs measured layout, which jsdom screen tests cannot
 * drive, and the lists are keyset pages of ≤100 rows. Rows are 44px and use
 * `content-visibility: auto`, so off-screen rows cost no layout ("virtualised enough").
 *
 * Keyboard: the grid is ONE tab stop (the active row's link, in the first cell). Up/Down move
 * between rows, Home/End jump, PageUp/PageDown move by 10; Enter on the row link (or a click
 * anywhere on the row) calls `onOpenRow`. No sortable headers (server order only). The grid
 * scrolls in its own region; the footer status line says where the list ends: "Showing N ·
 * more below", "Loading more…", "End of list", or "More didn't load." with "Try again".
 * Loading, error and empty bodies are slots so each screen keeps its own copy.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { Button } from './adapters/Button.adapter';
import { cx } from './internal/cx';
import { FOCUS_INSET, focusElement } from './internal/focus';
import { Skeleton } from './Skeleton.stub';

export interface DataGridColumn<Row> {
  key: string;
  header: ReactNode;
  /** CSS width ("12rem", 160). */
  width?: string | number;
  align?: 'start' | 'end';
  /** Ids and codes in mono. */
  mono?: boolean;
  render: (row: Row) => ReactNode;
}

export interface DataGridProps<Row> {
  /** Names the grid ("Orders"). */
  label: string;
  /** Show the label as a visible caption. Default false. */
  showCaption?: boolean;
  columns: DataGridColumn<Row>[];
  rows: Row[];
  getRowId: (row: Row) => string;
  /** The row link's accessible name ("Order HG-6RN4KP, Zaytoun Grill, Preparing"). */
  rowLabel: (row: Row) => string;
  /** Opens a row: Enter on the row link or a click on the row. */
  onOpenRow?: (row: Row) => void;
  /** Gives the row link an href (a real link: middle-click opens a tab). */
  rowHref?: (row: Row) => string;
  /** The row drawn as the filled tile (aria-selected), e.g. the one open in the panel. */
  selectedId?: string | null;
  /** First load: shows `loadingSlot` or skeleton rows. */
  loading?: boolean;
  loadingSlot?: ReactNode;
  /** A load error body (ErrorState with Try again). Shown instead of rows. */
  errorSlot?: ReactNode;
  /** Shown when there are no rows and not loading (EmptyState; first-run vs filtered copy). */
  emptySlot?: ReactNode;
  /** Keyset paging. */
  hasMore?: boolean;
  loadingMore?: boolean;
  loadMoreFailed?: boolean;
  onLoadMore?: () => void;
  /** Override the footer line entirely. */
  footerSlot?: ReactNode;
  /** Fetch the next page when the end of the list scrolls into view. Default true. */
  autoLoadMore?: boolean;
  id?: string;
  className?: string;
  testId?: string;
}

export function dataGridFooterText(args: { count: number; hasMore?: boolean; loadingMore?: boolean; loadMoreFailed?: boolean }): string {
  if (args.loadMoreFailed) return "More didn't load.";
  if (args.loadingMore) return 'Loading more…';
  if (args.hasMore) return `Showing ${args.count} · more below`;
  return 'End of list';
}

export function DataGrid<Row>({
  label,
  showCaption = false,
  columns,
  rows,
  getRowId,
  rowLabel,
  onOpenRow,
  rowHref,
  selectedId,
  loading = false,
  loadingSlot,
  errorSlot,
  emptySlot,
  hasMore = false,
  loadingMore = false,
  loadMoreFailed = false,
  onLoadMore,
  footerSlot,
  autoLoadMore = true,
  id,
  className,
  testId = 'DataGrid',
}: DataGridProps<Row>): React.JSX.Element {
  const auto = useId();
  const gridId = id ?? `grid-${auto}`;
  const [active, setActive] = useState(0);
  const linkRefs = useRef<Array<HTMLElement | null>>([]);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const selectedIndex = selectedId ? rows.findIndex((r) => getRowId(r) === selectedId) : -1;
  const activeIndex = Math.min(Math.max(0, active), Math.max(0, rows.length - 1));

  useEffect(() => {
    if (selectedIndex >= 0) setActive(selectedIndex);
  }, [selectedIndex]);

  useEffect(() => {
    if (!autoLoadMore || !hasMore || loadingMore || loadMoreFailed || !onLoadMore) return;
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onLoadMore();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [autoLoadMore, hasMore, loadingMore, loadMoreFailed, onLoadMore]);

  const moveTo = (i: number) => {
    const next = Math.min(Math.max(0, i), rows.length - 1);
    setActive(next);
    focusElement(linkRefs.current[next]);
  };
  const onKey = (event: KeyboardEvent<HTMLTableSectionElement>) => {
    const map: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10 };
    if (event.key in map) {
      event.preventDefault();
      moveTo(activeIndex + map[event.key]!);
    } else if (event.key === 'Home') {
      event.preventDefault();
      moveTo(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      moveTo(rows.length - 1);
    }
  };

  const body = (() => {
    if (errorSlot) return errorSlot;
    if (loading && rows.length === 0) return loadingSlot ?? <Skeleton variant="rows" count={8} label={`Loading ${label.toLowerCase()}`} />;
    if (rows.length === 0) return emptySlot ?? null;
    return null;
  })();

  const footer =
    footerSlot ??
    (rows.length > 0 && !errorSlot ? (
      <div role="status" className="flex min-h-11 items-center gap-3 border-t border-line-decorative px-3 text-body-sm text-fg-secondary">
        <span>{dataGridFooterText({ count: rows.length, hasMore, loadingMore, loadMoreFailed })}</span>
        {loadMoreFailed && onLoadMore ? (
          <Button variant="tertiary" size="sm" iconStart="refresh" onPress={() => onLoadMore()}>
            Try again
          </Button>
        ) : hasMore && !loadingMore && onLoadMore && !autoLoadMore ? (
          <Button variant="tertiary" size="sm" onPress={() => onLoadMore()}>
            Load more
          </Button>
        ) : null}
      </div>
    ) : null);

  return (
    <div data-testid={testId} className={cx('flex h-full min-h-0 flex-col', className)}>
      <div role="region" aria-label={label} className="min-h-0 flex-1 overflow-auto">
        {body ?? (
          <table id={gridId} role="grid" aria-labelledby={`${gridId}-caption`} aria-rowcount={rows.length + 1} className="w-full border-collapse text-body-md">
            <caption id={`${gridId}-caption`} className={cx('text-start text-label-lg text-fg-primary', !showCaption && 'sr-only')}>
              {label}
            </caption>
            <thead className="sticky top-0 z-10 bg-surface-raised">
              <tr role="row" aria-rowindex={1}>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    role="columnheader"
                    scope="col"
                    style={col.width !== undefined ? { width: col.width } : undefined}
                    className={cx('h-11 border-b border-line-decorative px-3 text-label-md font-semibold text-fg-secondary', col.align === 'end' ? 'text-end' : 'text-start')}
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody onKeyDown={onKey}>
              {rows.map((row, i) => {
                const rowId = getRowId(row);
                const selected = rowId === selectedId;
                const name = rowLabel(row);
                const href = rowHref?.(row);
                const linkProps = {
                  ref: (el: HTMLElement | null) => {
                    linkRefs.current[i] = el;
                  },
                  tabIndex: i === activeIndex ? 0 : -1,
                  'aria-label': name,
                  onFocus: () => setActive(i),
                  className: cx('absolute inset-0 rounded-none', FOCUS_INSET),
                };
                return (
                  <tr
                    key={rowId}
                    role="row"
                    aria-rowindex={i + 2}
                    aria-selected={selectedId !== undefined ? selected : undefined}
                    data-row-id={rowId}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('a[href]') && href) return;
                      onOpenRow?.(row);
                    }}
                    className={cx(
                      'h-11 cursor-pointer border-b border-line-decorative [content-visibility:auto] [contain-intrinsic-size:auto_44px]',
                      selected ? 'bg-surface-sunken font-semibold' : 'hover:bg-surface-subtle',
                    )}
                  >
                    {columns.map((col, c) => (
                      <td
                        key={col.key}
                        role="gridcell"
                        className={cx('px-3 py-1', c === 0 && 'relative', col.align === 'end' ? 'text-end tabular-nums' : 'text-start', col.mono && 'font-mono')}
                      >
                        {c === 0 ? (
                          href ? (
                            <a href={href} {...linkProps} onClick={(e) => {
                              if (onOpenRow && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
                                e.preventDefault();
                                onOpenRow(row);
                              }
                            }} />
                          ) : (
                            <button
                              type="button"
                              {...linkProps}
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenRow?.(row);
                              }}
                            />
                          )
                        ) : null}
                        <span className={cx(c === 0 && 'pointer-events-none relative')}>{col.render(row)}</span>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div ref={sentinelRef} aria-hidden="true" className="h-px" />
      </div>
      {footer}
    </div>
  );
}
