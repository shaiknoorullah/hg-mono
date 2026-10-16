/**
 * What the Get help sheet and the Report a problem form offer, and what they send.
 *
 * Pure functions, no React. Rules this file holds:
 * - **The customer never sends an amount.** A report names what went wrong, which part of the order
 *   it is about and, for some items, how many of each line. The server works out any money.
 * - **Nothing is chosen for the customer.** The reason and the part of the order open empty (unless
 *   the row they tapped chose the reason), because a money claim is an explicit choice.
 * - **A halal concern is a report like any other**, sent with the contract's own reason code. The
 *   words around it stay neutral: it does not rule on the food and does not promise a refund.
 * - **Several reports are allowed on one order.** The contract accepts a later report unless it
 *   claims something an earlier one holds, so nothing here says "each order can be reported once".
 */
import type { Schema } from '@hg/api-client';

type OrderState = Schema['OrderState'];
export type RefundReasonCode = Schema['RefundReasonCode'];
export type RefundKind = Schema['RefundKind'];
type RefundInput = Schema['RefundInput'];
type OrderLine = Schema['OrderLine'];

/** Which help the order is eligible for, from its state alone. */
export type HelpKind =
  /** Accepted by the restaurant, not delivered yet: late, report a problem, halal explainer. */
  | 'before'
  /** Delivered or completed: the after-delivery report list. */
  | 'after'
  /** Not yet accepted, or ended: there is nothing to report, only a way to reach us. */
  | 'contactOnly';

const BEFORE: ReadonlySet<string> = new Set(['PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'ARRIVED']);
const AFTER: ReadonlySet<string> = new Set(['DELIVERED', 'COMPLETED']);

export function helpKindOf(state: OrderState | string): HelpKind {
  if (BEFORE.has(state)) return 'before';
  if (AFTER.has(state)) return 'after';
  return 'contactOnly';
}

export interface ReasonOption {
  value: RefundReasonCode;
  label: string;
  description?: string;
}

/** Reasons that fit before delivery ("wanting to cancel" is a reason here only because it asks a person). */
export const BEFORE_REASONS: readonly ReasonOption[] = [
  { value: 'LATE_DELIVERY', label: 'My order is very late' },
  { value: 'WRONG_ADDRESS', label: 'The delivery address is wrong' },
  { value: 'CUSTOMER_CHANGED_MIND', label: 'I want to cancel', description: 'A person decides whether it can still be stopped' },
];

/** The after-delivery list, in the order the refund-request rules give. */
export const AFTER_REASONS: readonly ReasonOption[] = [
  { value: 'NEVER_DELIVERED', label: 'It never arrived' },
  { value: 'MISSING_ITEMS', label: 'Something is missing' },
  { value: 'WRONG_ITEMS', label: 'I got the wrong items' },
  { value: 'FOOD_QUALITY', label: "The food wasn't right" },
  { value: 'LATE_DELIVERY', label: 'It arrived very late' },
  { value: 'DAMAGED_SPILLED', label: 'It arrived damaged or spilled' },
  { value: 'HALAL_CONCERN', label: 'A halal concern', description: 'A person reviews every report' },
  { value: 'CHARGED_INCORRECTLY', label: 'I was charged the wrong amount' },
];

export function reasonsFor(kind: HelpKind): readonly ReasonOption[] {
  return kind === 'before' ? BEFORE_REASONS : kind === 'after' ? AFTER_REASONS : [];
}

/** The reason a deep link or a help row asks for, if it is one this order's form offers. */
export function reasonFromParam(param: string | undefined, kind: HelpKind): RefundReasonCode | null {
  if (!param) return null;
  return reasonsFor(kind).find((r) => r.value === param)?.value ?? null;
}

/** The short name of a reason on the report card ("A halal concern", "Something is missing"). */
export function reasonCardLabel(code: RefundReasonCode): string {
  const found = [...BEFORE_REASONS, ...AFTER_REASONS].find((r) => r.value === code);
  if (found) return found.label;
  return 'Something else';
}

export const KIND_OPTIONS: ReadonlyArray<{ value: Extract<RefundKind, 'FULL' | 'PARTIAL_ITEMS'>; label: string; description?: string }> = [
  { value: 'FULL', label: 'The whole order' },
  { value: 'PARTIAL_ITEMS', label: 'Some items', description: 'Choose which ones below' },
];

export function kindCardLabel(kind: RefundKind): string {
  return kind === 'PARTIAL_ITEMS' ? 'Some items' : kind === 'FULL' ? 'The whole order' : 'Fees';
}

/* ----------------------------------------------------------------------------------- form */

export const NOTE_MAX = 1000;
export const NOTE_MIN_REQUIRED = 5;

export interface ReportForm {
  reason: RefundReasonCode | null;
  /** After delivery only; before delivery the report is always about the whole order. */
  kind: 'FULL' | 'PARTIAL_ITEMS' | null;
  /** Quantity per `line_no`, only for "Some items". */
  items: Readonly<Record<number, number>>;
  note: string;
}

export const EMPTY_FORM: ReportForm = { reason: null, kind: null, items: {}, note: '' };

/** The note is the only place the right address can go, so it is required for a wrong address. */
export function noteRequired(reason: RefundReasonCode | null): boolean {
  return reason === 'WRONG_ADDRESS';
}

export function noteLabel(reason: RefundReasonCode | null): string {
  return noteRequired(reason) ? 'Tell us the right address (required)' : 'Tell us more (optional)';
}

/** Only a wrong address makes the note required, so this is the one note error there is. */
export const NOTE_ERROR = 'Tell us the right address, in at least 5 characters.';

export interface FormErrors {
  reason?: string;
  kind?: string;
  items?: string;
  note?: string;
}

export const FORM_ERRORS = {
  reason: 'Choose what went wrong',
  kind: 'Choose whether this is about the whole order or some items',
  items: 'Choose at least one item.',
} as const;

/** Checked on press, not by disabling Send. */
export function validateForm(form: ReportForm, kind: HelpKind): FormErrors {
  const errors: FormErrors = {};
  if (!form.reason) errors.reason = FORM_ERRORS.reason;
  if (kind === 'after') {
    if (!form.kind) errors.kind = FORM_ERRORS.kind;
    else if (form.kind === 'PARTIAL_ITEMS' && !Object.values(form.items).some((q) => q > 0)) errors.items = FORM_ERRORS.items;
  }
  if (noteRequired(form.reason) && form.note.trim().length < NOTE_MIN_REQUIRED) errors.note = NOTE_ERROR;
  return errors;
}

/**
 * The body of `createRefund`: the order, the reason, the part of the order, the quantities and the
 * note. No amount field exists on this type.
 */
export function refundInputOf(orderId: string, form: ReportForm, kind: HelpKind): RefundInput {
  const note = form.note.trim();
  const partial = kind === 'after' && form.kind === 'PARTIAL_ITEMS';
  const lines = partial
    ? Object.entries(form.items)
        .filter(([, quantity]) => quantity > 0)
        .map(([line, quantity]) => ({ order_line_no: Number(line), quantity }))
    : [];
  return {
    order_id: orderId,
    kind: partial ? 'PARTIAL_ITEMS' : 'FULL',
    reason_code: form.reason as RefundReasonCode,
    ...(lines.length ? { lines } : {}),
    ...(note ? { note } : {}),
  };
}

/** The signature of a request: the same form sent again reuses its Idempotency-Key. */
export function formSignature(input: RefundInput): string {
  return JSON.stringify(input);
}

/** "Chicken shawarma wrap" under which "Extra garlic sauce" or "You ordered 2". */
export function lineDetail(line: OrderLine): string {
  const parts = [
    ...(line.variants ?? []).map((v) => v.variant_name),
    ...(line.addons ?? []).map((a) => (a.addon_quantity > 1 ? `${a.addon_name} × ${a.addon_quantity}` : a.addon_name)),
  ];
  if (parts.length) return parts.join(' · ');
  return line.quantity > 1 ? `You ordered ${line.quantity}` : 'For one';
}

/* ---------------------------------------------------------------------------- the answers */

/** What the server's refusal means for the form. */
export type ReportRefusal =
  | { kind: 'alreadyRequested' }
  | { kind: 'notRefundable' }
  | { kind: 'windowClosed' }
  | { kind: 'invalid' }
  | { kind: 'failed' };

export function refusalOf(status: number | null, code: string | null): ReportRefusal {
  if (status === 409) {
    if (code === 'REFUND_ALREADY_REQUESTED') return { kind: 'alreadyRequested' };
    if (code === 'REFUND_WINDOW_CLOSED') return { kind: 'windowClosed' };
    if (code === 'PAYMENT_NOT_REFUNDABLE' || code === 'REFUND_EXCEEDS_CAPTURED') return { kind: 'notRefundable' };
  }
  if (status === 422) return { kind: 'invalid' };
  return { kind: 'failed' };
}

/** "+18005550199" as "+1 800 555 0199"; any other number is shown as the server sent it. */
export function phoneLabel(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+1 ${m[1]} ${m[2]} ${m[3]}` : e164;
}
