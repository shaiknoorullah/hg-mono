import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { Button } from '../primitives/index.js';
import { cx } from '../feedback/internal.js';
import type { PageMeta } from './types.js';

/**
 * `Pagination` — **keyset only**, because that is the only scheme the contract has.
 *
 * `contracts/openapi.yaml` §"Pagination": *"one scheme everywhere: keyset. Request
 * `?limit=` (1–100, default 20) and `?cursor=`; response `meta = {next_cursor, has_more}`."*
 * `Cursor` is documented as "Opaque keyset cursor encoding the sort tuple. **Not an
 * offset**", and `meta.total` is "present only where an exact count is cheap. **Never
 * required for paging**".
 *
 * Which rules this component out of a lot of things people expect from a paginator, all
 * of them deliberately:
 *
 *  - **No page numbers.** There is no way to compute "page 7" from an opaque cursor.
 *  - **No jump-to-last.** Same reason.
 *  - **No "of N" unless the server sent `total`.** A count the server declined to compute
 *    is not one the client may invent.
 *  - **Previous is a client-side cursor stack**, not a server capability. Use
 *    `useCursorPagination` to keep it; without it, only forward paging is offered.
 */

export const PAGE_LIMIT_MIN = 1;
export const PAGE_LIMIT_MAX = 100;
export const PAGE_LIMIT_DEFAULT = 20;

/** The limits the contract's 1–100 range makes sensible on an operational surface. */
export const PAGE_LIMIT_OPTIONS = [20, 50, 100] as const;

export function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return PAGE_LIMIT_DEFAULT;
  return Math.min(PAGE_LIMIT_MAX, Math.max(PAGE_LIMIT_MIN, Math.trunc(limit)));
}

export type PaginationMode = 'load-more' | 'pages';

export interface PaginationProps {
  /** `meta` straight off the response. `null` while the first page is still loading. */
  meta: PageMeta | null;
  /** How many rows are currently rendered. */
  loadedCount: number;
  /** Fetch the next page with `cursor = meta.next_cursor`. */
  onNext: () => void;
  /**
   * Step back through the cursor stack. Only rendered in `pages` mode, and only when the
   * caller actually has a previous cursor (see `useCursorPagination`).
   */
  onPrevious?: () => void;
  canGoPrevious?: boolean;
  /**
   * `load-more` appends (the admin default — patterns §4.1 "Cursor pagination with
   * load-more"); `pages` replaces the current page.
   */
  mode?: PaginationMode;
  limit?: number;
  onLimitChange?: (limit: number) => void;
  loading?: boolean;
  /** "orders", "restaurants" — used in the accessible name and the count line. */
  unit?: string;
  className?: string;
  testId?: string;
}

export function Pagination({
  meta,
  loadedCount,
  onNext,
  onPrevious,
  canGoPrevious = false,
  mode = 'load-more',
  limit = PAGE_LIMIT_DEFAULT,
  onLimitChange,
  loading = false,
  unit = 'records',
  className,
  testId = 'pagination',
}: PaginationProps): ReactNode {
  const hasMore = !!meta?.has_more && !!meta.next_cursor;
  const total = meta?.total ?? null;

  const summary =
    total != null
      ? `Showing ${loadedCount} of ${total} ${unit}`
      : hasMore
        ? `Showing ${loadedCount} ${unit}, more available`
        : `Showing all ${loadedCount} ${unit}`;

  return (
    <div
      data-testid={testId}
      data-has-more={hasMore || undefined}
      className={cx(
        'flex flex-wrap items-center justify-between gap-3 border-t border-line-decorative px-3 py-2',
        className,
      )}
    >
      {/* The count is a live region: after a load-more it is the only confirmation that
          anything happened for a screen-reader user, and focus must not move. */}
      <p
        aria-live="polite"
        data-testid={`${testId}-summary`}
        className="text-body-sm tabular-nums text-fg-secondary"
      >
        {summary}
      </p>

      <div className="flex items-center gap-3">
        {onLimitChange ? (
          <label className="flex items-center gap-2 text-label-md text-fg-secondary">
            <span>Rows</span>
            <select
              data-testid={`${testId}-limit`}
              value={limit}
              onChange={(event) => onLimitChange(clampLimit(Number(event.target.value)))}
              className={cx(
                'h-11 rounded-md border border-line-interactive bg-surface-base px-2',
                'text-fg-primary hg-focus',
                '',
              )}
            >
              {PAGE_LIMIT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {mode === 'pages' && onPrevious ? (
          <Button
            variant="tertiary"
            size="md"
            disabled={!canGoPrevious || loading}
            onPress={onPrevious}
          >
            Previous
          </Button>
        ) : null}

        <Button
          variant="tertiary"
          size="md"
          loading={loading}
          disabled={!hasMore}
          onPress={onNext}
        >
          {mode === 'pages' ? 'Next' : `Load ${limit} more`}
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- *
 * Cursor state
 * -------------------------------------------------------------------------- */

export interface UseCursorPaginationOptions {
  limit?: number;
}

export interface UseCursorPaginationResult {
  /** Pass to the request as `?cursor=`. `null` on the first page — omit the param. */
  cursor: string | null;
  limit: number;
  setLimit: (limit: number) => void;
  canGoPrevious: boolean;
  /** Advance using the `meta` you just received. No-op when `has_more` is false. */
  next: (meta: PageMeta | null) => void;
  previous: () => void;
  /**
   * Back to the first page. **Call this on every sort or filter change** — a keyset cursor
   * encodes the sort tuple, so reusing one across a re-sort returns nonsense.
   */
  reset: () => void;
}

export function useCursorPagination(
  options: UseCursorPaginationOptions = {},
): UseCursorPaginationResult {
  const [limit, setLimitState] = useState(clampLimit(options.limit ?? PAGE_LIMIT_DEFAULT));
  /** The stack of cursors used to reach the current page. `[]` ⇒ first page. */
  const [stack, setStack] = useState<string[]>([]);

  const cursor = stack.length ? stack[stack.length - 1]! : null;

  const next = useCallback((meta: PageMeta | null) => {
    if (!meta?.has_more || !meta.next_cursor) return;
    const nextCursor = meta.next_cursor;
    setStack((current) => [...current, nextCursor]);
  }, []);

  const previous = useCallback(() => {
    setStack((current) => current.slice(0, -1));
  }, []);

  const reset = useCallback(() => setStack([]), []);

  const setLimit = useCallback((value: number) => {
    // A limit change invalidates the cursor: it encodes the page boundary.
    setLimitState(clampLimit(value));
    setStack([]);
  }, []);

  return useMemo(
    () => ({
      cursor,
      limit,
      setLimit,
      canGoPrevious: stack.length > 0,
      next,
      previous,
      reset,
    }),
    [cursor, limit, setLimit, stack.length, next, previous, reset],
  );
}
