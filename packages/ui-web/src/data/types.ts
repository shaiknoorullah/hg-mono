import type { ReactNode } from 'react';
import type { Schema } from '@hg/api-client';

import type { Density } from '../feedback/internal.js';

/**
 * `DataTable` types, including the PII policy.
 *
 * ## Why masking cannot be opted into
 *
 * A-42 R1: "Masking is applied **server-side**. A masked field is never present in the
 * response payload in unmasked form." The client's job is therefore not to mask — it is
 * to **never accidentally present an unmasked field, and to make revealing one an
 * explicit, justified, audited act**.
 *
 * That is expressed here as an API with no escape hatch:
 *
 *  1. There is **no `masked` prop**. A column is declared `pii: { field }` or it is not a
 *     PII column. There is no `masked: false`, no `unmask`, no `revealByDefault`.
 *  2. A `pii` column's renderer is handed `{ revealed: false, revealedValue: undefined }`
 *     on every render *until* a reveal completes. The default value of the context is
 *     masked; a renderer that ignores the context renders the server's masked string,
 *     which is the only string it has.
 *  3. The reveal control is not rendered at all unless the host passes `onRevealPii`.
 *     Without a handler there is no code path in this component that produces an unmasked
 *     value, because the unmasked value only ever comes back from the server.
 *  4. A completed reveal is **time-boxed** (`revealTtlMs`, default 60 s) and re-masks
 *     itself. Bounded exposure, so an unattended support screen is not a data leak.
 *  5. `PII_FIELD_HEURISTICS` catches the other direction: a column whose key looks like
 *     PII but carries no `pii` declaration reports itself in development, so the mistake
 *     is loud rather than silent.
 */

/** `meta` on every paginated collection. Aliased from the contract, never restated. */
export type PageMeta = Schema['PageMeta'];

/** The justification vocabulary from A-42. Closed set. */
export const PII_JUSTIFICATION_CODES = [
  'CONTACTING_CUSTOMER',
  'VERIFYING_IDENTITY',
  'DELIVERY_ISSUE',
  'FRAUD_INVESTIGATION',
  'LEGAL_REQUEST',
  'PAYOUT_INVESTIGATION',
] as const;

export type PiiJustificationCode = (typeof PII_JUSTIFICATION_CODES)[number];

export const PII_JUSTIFICATION_LABELS: Record<PiiJustificationCode, string> = {
  CONTACTING_CUSTOMER: 'Contacting the customer',
  VERIFYING_IDENTITY: 'Verifying identity',
  DELIVERY_ISSUE: 'Delivery issue',
  FRAUD_INVESTIGATION: 'Fraud investigation',
  LEGAL_REQUEST: 'Legal request',
  PAYOUT_INVESTIGATION: 'Payout investigation',
};

export interface PiiColumnSpec {
  /**
   * The field name as the API knows it (`customer_phone`, `delivery_address`). Sent with
   * the reveal request and written to the `pii_access_event` row, so it must match the
   * server's vocabulary rather than the column key.
   */
  field: string;
  /** Which justifications are offered. Defaults to the full A-42 set. */
  justificationCodes?: readonly PiiJustificationCode[];
  /**
   * A linked case is required before the reveal is allowed. Default `true` — a support
   * agent revealing without a case link is `422 CASE_REQUIRED` (A-42 R3), and asking for
   * it up front is better than teaching agents that the server refuses at random.
   */
  requiresCase?: boolean;
  /**
   * What is being revealed, for the confirmation copy: "the customer's phone number".
   * Defaults to the column header, lower-cased.
   */
  noun?: string;
}

export type ColumnAlign = 'start' | 'end' | 'center';

/**
 * Drives column width and alignment from the *kind* of thing in the column (§24):
 * ids are fixed-width mono, money is end-aligned tabular, dates are absolute.
 */
export type ColumnContentClass = 'text' | 'id' | 'money' | 'date' | 'enum' | 'numeric' | 'actions';

export interface CellContext {
  /** True only after a completed, justified reveal. Never true on first render. */
  revealed: boolean;
  /** The unmasked value the *server* returned for this reveal. Absent while masked. */
  revealedValue?: string;
}

export interface DataTableColumn<Row> {
  key: string;
  /** `<th scope="col">` content. Also the accessible name of the sort control. */
  header: string;
  /**
   * The cell. For a `pii` column the second argument is the masking context; render
   * `context.revealedValue ?? row.<masked_field>` — there is nothing else to render,
   * because the unmasked value does not exist on the client until the server sends it.
   */
  cell: (row: Row, context: CellContext) => ReactNode;
  /**
   * The **server's** sort key. Presence makes the column sortable; sorting is server-side
   * and re-issues the query from a null cursor (§24: "Server-side sort and filter").
   */
  sortKey?: string;
  align?: ColumnAlign;
  contentClass?: ColumnContentClass;
  /** CSS width, e.g. `'12rem'`. Sticky columns need an explicit one. */
  width?: string;
  /** Declaring this makes the column masked. There is no way to declare it unmasked. */
  pii?: PiiColumnSpec;
  /** A plain-text value for type-ahead and for the row's accessible summary. */
  textValue?: (row: Row) => string;
}

export interface PiiRevealRequest {
  rowId: string;
  /** `PiiColumnSpec.field`. */
  field: string;
  caseId?: string;
  justificationCode: PiiJustificationCode;
}

/**
 * Resolve with the unmasked value the server returned. Reject to keep the value masked
 * and show the reason (`422 CASE_REQUIRED`, `429 REVEAL_RATE_LIMITED`).
 *
 * The host is expected to call the contract's reveal path — e.g.
 * `GET /v1/admin/orders/{orderId}?reveal_pii=true&justification=…`, which sets
 * `pii_revealed` on the response and writes the audit row.
 */
export type PiiRevealHandler = (request: PiiRevealRequest) => Promise<string>;

export interface DataTableRowAction<Row> {
  key: string;
  label: string;
  onSelect: (row: Row) => void;
  destructive?: boolean;
  disabled?: boolean;
  /** Why it is disabled. Never leave it to be guessed. */
  disabledReason?: string;
}

export type SortDirection = 'asc' | 'desc';

export interface DataTableSort {
  /** A `DataTableColumn.sortKey`. */
  key: string;
  direction: SortDirection;
}

export interface DataTableSelection {
  selectedIds: readonly string[];
  onChange: (selectedIds: string[]) => void;
  /** Rows that cannot be selected, with the reason. */
  isSelectable?: (rowId: string) => boolean;
}

export interface DataTableError {
  /** The stable `error.code`. Drives `ErrorState`'s copy. */
  code?: string;
  requestId?: string | null;
  message?: string | null;
  onRetry?: () => void;
}

/**
 * The queue-drained signal (patterns §4.1). Present ⇒ the empty state is the *positive*
 * one, with the last-processed timestamp, so an admin can tell "done" from "broken".
 */
export interface DataTableDrained {
  queueName: string;
  lastProcessedAt?: string | null;
}

export type { Density };
