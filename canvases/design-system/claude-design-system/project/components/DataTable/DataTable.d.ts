/** Admin lists (02-components.md §24). Cursor pagination only. */
export interface DataTableColumn<Row> {
  key: string;
  label: string;
  /** Logical alignment; money and counts are `end`. */
  align?: 'start' | 'end';
  /** Ids: mono family (IBM Plex Mono via --font-mono), tabular. */
  mono?: boolean;
  numeric?: boolean;
  muted?: boolean;
  sortable?: boolean;
  width?: string | number;
  render?: (row: Row) => React.ReactNode;
}
export interface DataTableProps<Row = Record<string, unknown>> {
  /** REQUIRED: names the table (<caption>). */
  caption: string;
  hideCaption?: boolean;
  columns: DataTableColumn<Row>[];
  rows: Row[];
  getRowId?: (row: Row) => string;
  /** Server-side sort. Headers get aria-sort; changes are announced. */
  sort?: { key: string; direction: 'ascending' | 'descending' };
  onSortChange?: (sort: { key: string; direction: 'ascending' | 'descending' }) => void;
  /** Selected row ids; with onSelectionChange renders a checkbox column. Count is announced. */
  selection?: string[];
  onSelectionChange?: (ids: string[]) => void;
  /** Enter (keyboard) or click activates a row. */
  onRowActivate?: (row: Row) => void;
  /** Items for a per-row Menu button named "Actions for {rowLabel}". */
  rowActions?: (row: Row) => import('../Menu/Menu').MenuItem[];
  /** Unique human name of a row, e.g. r => `order ${r.id}`. */
  rowLabel?: (row: Row) => string;
  /** compact = density.rowHeight (44 in compact density). */
  density?: 'compact' | 'comfortable';
  stickyHeader?: boolean;
  status?: 'ready' | 'loading' | 'error';
  errorMessage?: string;
  onRetry?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  /** Distinguishes "no results for these filters" from "no records". */
  filtersActive?: boolean;
  onClearFilters?: () => void;
  /** Empty copy must say why it is empty and what to do next. */
  emptyState?: { title: string; description: string; action?: React.ReactNode };
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function DataTable<Row>(props: DataTableProps<Row>): JSX.Element;
