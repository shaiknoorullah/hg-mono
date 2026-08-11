/**
 * Data display — the admin surface's working set.
 *
 * Two invariants hold across this whole tier and are worth restating at the barrel:
 *
 *  - **PII is masked by default.** `DataTable` has no prop that turns masking off. See
 *    `types.ts` for the full argument.
 *  - **Pagination is keyset, always.** `?limit&cursor` in, `meta.next_cursor` /
 *    `meta.has_more` out, exactly as `contracts/openapi.yaml` defines it. There are no
 *    page numbers in this package because there are none in the contract.
 */

export { DataTable } from './DataTable.js';
export type { DataTableProps } from './DataTable.js';

export { DocumentViewer } from './DocumentViewer.js';
export type { DocumentViewerProps, DocumentViewerState } from './DocumentViewer.js';

export { FilterBar } from './FilterBar.js';
export type {
  FilterBarProps,
  FilterDefinition,
  FilterOption,
  FilterValue,
  SavedView,
} from './FilterBar.js';

export {
  PAGE_LIMIT_DEFAULT,
  PAGE_LIMIT_MAX,
  PAGE_LIMIT_MIN,
  PAGE_LIMIT_OPTIONS,
  Pagination,
  clampLimit,
  useCursorPagination,
} from './Pagination.js';
export type {
  PaginationMode,
  PaginationProps,
  UseCursorPaginationOptions,
  UseCursorPaginationResult,
} from './Pagination.js';

export { PiiCell } from './PiiCell.js';
export type { PiiCellProps } from './PiiCell.js';

export { useGridKeyboard } from './useGridKeyboard.js';
export type {
  GridPosition,
  UseGridKeyboardOptions,
  UseGridKeyboardResult,
} from './useGridKeyboard.js';

export { PII_JUSTIFICATION_CODES, PII_JUSTIFICATION_LABELS } from './types.js';
export type {
  CellContext,
  ColumnAlign,
  ColumnContentClass,
  DataTableColumn,
  DataTableDrained,
  DataTableError,
  DataTableRowAction,
  DataTableSelection,
  DataTableSort,
  PageMeta,
  PiiColumnSpec,
  PiiJustificationCode,
  PiiRevealHandler,
  PiiRevealRequest,
  SortDirection,
} from './types.js';
