/**
 * Menu reviews and edit-on-behalf (`MenuReview*`, `MenuItem-OnBehalf*` boards).
 *
 * Halal rule held here: a menu item never carries the halal claim. The status customers see
 * comes from the restaurant's approved certificate. A `HALAL_CERTIFIED` dietary tag that reaches
 * this screen is shown as a plain, unverified tag and never as a halal badge.
 */
import { HgApiError, type Schema } from '@hg/api-client';

export type Version = Schema['MenuItemVersion'];
export type RejectionReason = Schema['MenuRejectionReasonCode'];
export type UpdateInput = Schema['MenuItemUpdateInput'];

export const REJECTION_REASONS: ReadonlyArray<{ value: RejectionReason; label: string }> = [
  { value: 'MISLEADING_DESCRIPTION', label: 'Misleading description' },
  { value: 'UNSUBSTANTIATED_HALAL_CLAIM', label: 'Halal claim we can’t substantiate' },
  { value: 'INCORRECT_DIETARY_TAG', label: 'Incorrect dietary tag' },
  { value: 'MISSING_ALLERGEN', label: 'Missing allergen' },
  { value: 'POOR_IMAGE_QUALITY', label: 'Poor image quality' },
  { value: 'IMAGE_NOT_OF_DISH', label: 'Image isn’t of the dish' },
  { value: 'PROHIBITED_ITEM', label: 'Prohibited item' },
  { value: 'OFFENSIVE_CONTENT', label: 'Offensive content' },
  { value: 'OTHER', label: 'Other' },
];

export const NOTE_MIN_OTHER = 20;
export const NOTE_MAX = 1000;

/** "WHEAT_TRITICALE" becomes "Wheat triticale". */
export function humanize(code: string): string {
  const s = code.toLowerCase().replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A dietary tag as words. The halal tag is not a verification and says so. */
export function dietaryTagLabel(tag: string): string {
  return tag === 'HALAL_CERTIFIED' ? 'Halal certified (a tag, not checked here)' : humanize(tag);
}

export interface RejectDraft {
  reason: RejectionReason | '';
  note: string;
}

export interface RejectErrors {
  reason?: string;
  note?: string;
}

export function checkReject(d: RejectDraft): RejectErrors {
  const errors: RejectErrors = {};
  if (d.reason === '') errors.reason = 'Choose the reason the restaurant will see.';
  const n = d.note.trim().length;
  if (d.reason === 'OTHER' && n < NOTE_MIN_OTHER) {
    errors.note = n === 0 ? 'Say exactly what to change.' : `At least ${NOTE_MIN_OTHER} characters for Other: ${NOTE_MIN_OTHER - n} more.`;
  } else if (d.note.length > NOTE_MAX) {
    errors.note = `At most ${NOTE_MAX} characters.`;
  }
  return errors;
}

export function rejectInput(d: RejectDraft): Schema['MenuVersionDecisionInput'] {
  const note = d.note.trim();
  return { decision: 'REJECT', reason_code: d.reason as RejectionReason, ...(note ? { review_note: note } : {}) };
}

function accountState(err: HgApiError): string | null {
  const d = err.details as unknown as { account_state?: unknown } | undefined;
  return d && typeof d.account_state === 'string' ? d.account_state : null;
}

export type DecisionRefusal =
  | { kind: 'locked'; accountState: string | null }
  | { kind: 'already-decided' }
  | { kind: 'item-deleted' }
  | { kind: 'forbidden' }
  | { kind: 'other'; message: string };

export function classifyDecisionRefusal(err: HgApiError): DecisionRefusal {
  if (err.status === 403 && err.code === 'MENU_LOCKED') return { kind: 'locked', accountState: accountState(err) };
  if (err.status === 409 && err.code === 'ALREADY_DECIDED') return { kind: 'already-decided' };
  if (err.status === 409 && err.code === 'ITEM_DELETED') return { kind: 'item-deleted' };
  if (err.status === 403) return { kind: 'forbidden' };
  return { kind: 'other', message: err.message };
}

/* ── Edit on behalf ─────────────────────────────────────────────────────────────────────── */

/** The contract's limits on `MenuItemUpdateInput`. */
export const LIMITS = { nameMin: 2, nameMax: 80, description: 600, ingredients: 1000, priceMin: 50, priceMax: 50000, prepMin: 1, prepMax: 120 } as const;

/** Every field optional: blank means "leave as it is". The price is integer cents from MoneyInput. */
export interface EditDraft {
  name: string;
  description: string;
  ingredients: string;
  priceCents: number | null;
  prep: string;
}

export const EMPTY_EDIT: EditDraft = { name: '', description: '', ingredients: '', priceCents: null, prep: '' };

export type EditField = 'name' | 'description' | 'ingredients' | 'price' | 'prep';
export type EditErrors = Partial<Record<EditField | 'nothing', string>>;

export function checkEdit(d: EditDraft, priceUnreadable = false): EditErrors {
  const e: EditErrors = {};
  const name = d.name.trim();
  if (name !== '' && (name.length < LIMITS.nameMin || name.length > LIMITS.nameMax)) e.name = `The name is ${LIMITS.nameMin} to ${LIMITS.nameMax} characters.`;
  if (d.description.length > LIMITS.description) e.description = `At most ${LIMITS.description} characters.`;
  if (d.ingredients.length > LIMITS.ingredients) e.ingredients = `At most ${LIMITS.ingredients} characters.`;
  if (priceUnreadable) e.price = 'Enter an amount in dollars and cents, like 12.50.';
  else if (d.priceCents !== null && (d.priceCents < LIMITS.priceMin || d.priceCents > LIMITS.priceMax)) e.price = 'The price must be between $0.50 and $500.00.';
  const prep = d.prep.trim();
  if (prep !== '') {
    const n = Number(prep);
    if (!Number.isInteger(n) || n < LIMITS.prepMin || n > LIMITS.prepMax) e.prep = `Whole minutes, ${LIMITS.prepMin} to ${LIMITS.prepMax}.`;
  }
  if (Object.keys(e).length === 0 && buildUpdate(d) === null) e.nothing = 'Change at least one field to save.';
  return e;
}

/** Only the fields that were filled in; `null` when there is nothing to send. */
export function buildUpdate(d: EditDraft): UpdateInput | null {
  const out: UpdateInput = {};
  if (d.name.trim() !== '') out.name = d.name.trim();
  if (d.description.trim() !== '') out.description = d.description.trim();
  if (d.ingredients.trim() !== '') out.ingredients_text = d.ingredients.trim();
  if (d.priceCents !== null) out.price_cents = d.priceCents;
  if (d.prep.trim() !== '') out.prep_minutes = Number(d.prep.trim());
  return Object.keys(out).length === 0 ? null : out;
}

export type EditRefusal =
  | { kind: 'locked'; accountState: string | null }
  | { kind: 'pending-version' }
  | { kind: 'not-writable' }
  | { kind: 'gone' }
  | { kind: 'fields'; fields: EditField[]; message: string }
  | { kind: 'forbidden' }
  | { kind: 'other'; message: string };

export function classifyEditRefusal(err: HgApiError): EditRefusal {
  if (err.status === 403 && err.code === 'MENU_LOCKED') return { kind: 'locked', accountState: accountState(err) };
  if (err.status === 403 && err.code === 'FIELD_NOT_WRITABLE') return { kind: 'not-writable' };
  if (err.status === 403) return { kind: 'forbidden' };
  if (err.status === 404) return { kind: 'gone' };
  if (err.status === 409 && err.code === 'MENU_VERSION_PENDING') return { kind: 'pending-version' };
  if (err.status === 422) {
    if (err.code === 'PRICE_OUT_OF_RANGE') return { kind: 'fields', fields: ['price'], message: err.message };
    if (err.code === 'PROHIBITED_INGREDIENT') return { kind: 'fields', fields: ['name', 'description', 'ingredients'], message: err.message };
    return { kind: 'fields', fields: [], message: err.message };
  }
  return { kind: 'other', message: err.message };
}

export function lockedWords(accountState: string | null): string {
  const s = accountState ? accountState.toLowerCase() : 'suspended or banned';
  return `This restaurant is ${s}, so its menu is locked for everyone, admins included. Nothing was changed. Try again once the restaurant is reinstated.`;
}
