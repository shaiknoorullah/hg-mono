import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Full keyboard grid navigation for `DataTable` (a11y §4.3 and §8: "Full `DataTable` grid
 * keyboard navigation" is a named admin requirement).
 *
 * The model is a roving tabindex over cells:
 *
 * | Key                | Behaviour                                        |
 * |--------------------|--------------------------------------------------|
 * | `Arrow`            | move one cell, clamped at the edges               |
 * | `Home` / `End`     | first / last cell in the row                      |
 * | `Ctrl+Home/End`    | first / last cell in the grid                     |
 * | `PageUp/PageDown`  | one viewport of rows                              |
 * | printable char     | type-ahead within the first text column           |
 * | `Tab`              | leaves the grid entirely — one tab stop, not N×M  |
 *
 * Row 0 is the header row, so `aria-rowindex` and the internal row index agree with the
 * DOM. Arrow-up from the first body row lands on the sort control for that column, which
 * is where a keyboard user expects to be able to re-sort from.
 */

export interface GridPosition {
  /** 0 = header row. Body rows are 1-based. */
  row: number;
  col: number;
}

export interface UseGridKeyboardOptions {
  rowCount: number;
  colCount: number;
  /** Rows to jump for PageUp/PageDown. Default 10. */
  pageSize?: number;
  /**
   * Text for type-ahead, by body-row index (0-based). Usually the first column's
   * `textValue`. Omit to disable type-ahead.
   */
  rowText?: readonly string[];
  /** Enter / Space on a cell. */
  onActivate?: (bodyRowIndex: number) => void;
  /** Space on a cell when a selection model is present. */
  onToggleSelect?: (bodyRowIndex: number) => void;
  enabled?: boolean;
}

export interface UseGridKeyboardResult {
  position: GridPosition;
  /** Spread onto the `<table>`. */
  gridProps: {
    onKeyDown: (event: React.KeyboardEvent<HTMLTableElement>) => void;
  };
  /** Spread onto every `<th>` / `<td>`. */
  cellProps: (row: number, col: number) => {
    tabIndex: number;
    'data-grid-row': number;
    'data-grid-col': number;
    onFocus: () => void;
  };
  /** Ref for the `<table>`, so focus can be moved onto the active cell. */
  tableRef: React.RefObject<HTMLTableElement | null>;
  setPosition: (position: GridPosition) => void;
}

const TYPEAHEAD_RESET_MS = 800;

export function useGridKeyboard({
  rowCount,
  colCount,
  pageSize = 10,
  rowText,
  onActivate,
  onToggleSelect,
  enabled = true,
}: UseGridKeyboardOptions): UseGridKeyboardResult {
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [position, setPositionState] = useState<GridPosition>({ row: 0, col: 0 });
  const shouldFocusRef = useRef(false);
  const typeaheadRef = useRef<{ buffer: string; at: number }>({ buffer: '', at: 0 });

  const clamp = useCallback(
    (next: GridPosition): GridPosition => ({
      row: Math.min(Math.max(0, next.row), Math.max(0, rowCount)),
      col: Math.min(Math.max(0, next.col), Math.max(0, colCount - 1)),
    }),
    [rowCount, colCount],
  );

  const setPosition = useCallback(
    (next: GridPosition) => {
      setPositionState(clamp(next));
    },
    [clamp],
  );

  const move = useCallback(
    (next: GridPosition) => {
      shouldFocusRef.current = true;
      setPosition(next);
    },
    [setPosition],
  );

  // Focus follows the roving index, but only when the movement came from a key — never on
  // a data refresh, which must not steal focus (a11y §4.2).
  useEffect(() => {
    if (!shouldFocusRef.current) return;
    shouldFocusRef.current = false;
    const cell = tableRef.current?.querySelector<HTMLElement>(
      `[data-grid-row="${position.row}"][data-grid-col="${position.col}"]`,
    );
    cell?.focus();
  }, [position]);

  // A shrinking result set must not leave the cursor pointing off the end.
  useEffect(() => {
    setPositionState((current) => clamp(current));
  }, [clamp]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTableElement>) => {
      if (!enabled) return;
      const { row, col } = position;

      switch (event.key) {
        case 'ArrowRight':
          event.preventDefault();
          move({ row, col: col + 1 });
          return;
        case 'ArrowLeft':
          event.preventDefault();
          move({ row, col: col - 1 });
          return;
        case 'ArrowDown':
          event.preventDefault();
          move({ row: row + 1, col });
          return;
        case 'ArrowUp':
          event.preventDefault();
          move({ row: row - 1, col });
          return;
        case 'Home':
          event.preventDefault();
          move(event.ctrlKey ? { row: 0, col: 0 } : { row, col: 0 });
          return;
        case 'End':
          event.preventDefault();
          move(event.ctrlKey ? { row: rowCount, col: colCount - 1 } : { row, col: colCount - 1 });
          return;
        case 'PageDown':
          event.preventDefault();
          move({ row: row + pageSize, col });
          return;
        case 'PageUp':
          event.preventDefault();
          move({ row: row - pageSize, col });
          return;
        case 'Enter':
          if (row > 0 && onActivate) {
            event.preventDefault();
            onActivate(row - 1);
          }
          return;
        case ' ':
        case 'Spacebar':
          if (row > 0 && onToggleSelect) {
            event.preventDefault();
            onToggleSelect(row - 1);
          }
          return;
        default:
          break;
      }

      // Type-ahead. Single printable characters only, so shortcuts still work.
      if (
        rowText &&
        event.key.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        const now = Date.now();
        const state = typeaheadRef.current;
        state.buffer = now - state.at > TYPEAHEAD_RESET_MS ? event.key : state.buffer + event.key;
        state.at = now;
        const needle = state.buffer.toLowerCase();
        const startAt = Math.max(0, row); // search from the row after the current one
        const order = [
          ...rowText.slice(startAt),
          ...rowText.slice(0, startAt),
        ];
        const offset = order.findIndex((text) => text.toLowerCase().startsWith(needle));
        if (offset >= 0) {
          const found = (startAt + offset) % rowText.length;
          event.preventDefault();
          move({ row: found + 1, col });
        }
      }
    },
    [enabled, position, move, rowCount, colCount, pageSize, rowText, onActivate, onToggleSelect],
  );

  const cellProps = useCallback(
    (row: number, col: number) => ({
      // One tab stop for the whole grid: only the active cell is tabbable.
      tabIndex: position.row === row && position.col === col ? 0 : -1,
      'data-grid-row': row,
      'data-grid-col': col,
      onFocus: () => setPositionState({ row, col }),
    }),
    [position],
  );

  return {
    position,
    gridProps: { onKeyDown },
    cellProps,
    tableRef,
    setPosition,
  };
}
