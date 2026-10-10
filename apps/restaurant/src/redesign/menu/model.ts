/**
 * Menu (WP8, canvas MH): the pure rules the screen draws from `getOwnMenu` and the profile.
 * Nothing here computes money or a closing time: prices are the server's cents, and the next
 * closing time is a Needs API (spec §0, §2 fallback).
 */
import type { Schema } from '@hg/api-client';
import { formatTime } from '../format/time';

export type OwnedMenu = Schema['OwnedMenu'];
export type MenuCategoryRow = OwnedMenu['categories'][number];
export type MenuItem = Schema['MenuItemOwnerView'];
export type MenuVersion = Schema['MenuItemVersion'];
export type DietaryTag = Schema['DietaryTag'];
export type AllergenTag = Schema['AllergenTag'];
export type RejectionCode = Schema['MenuRejectionReasonCode'];
export type AccountState = Schema['RestaurantAccountState'];
export type HalalState = Schema['HalalDisplayState'];

/** The most categories a restaurant may have (spec §3; client-side, no server code drawn). */
export const MAX_CATEGORIES = 40;
export const PRICE_MIN_CENTS = 50;
export const PRICE_MAX_CENTS = 50000;

// ── Vocabularies (spec §9) ─────────────────────────────────────────────────────────────

export const REJECTION_LABEL: Record<RejectionCode, string> = {
  MISLEADING_DESCRIPTION: 'Description could mislead customers',
  UNSUBSTANTIATED_HALAL_CLAIM: 'Halal claim not supported',
  INCORRECT_DIETARY_TAG: 'Dietary tag is not correct',
  MISSING_ALLERGEN: 'Missing allergen',
  POOR_IMAGE_QUALITY: 'Photo quality too low',
  IMAGE_NOT_OF_DISH: 'Photo doesn’t show this dish',
  PROHIBITED_ITEM: 'Item not allowed on HalalGoes',
  OFFENSIVE_CONTENT: 'Offensive content',
  OTHER: 'Other reason',
};

/** The eight a restaurant may set. `HALAL_CERTIFIED` is platform-derived and never offered. */
export const DIETARY: { tag: Exclude<DietaryTag, 'HALAL_CERTIFIED'>; label: string; id: string }[] = [
  { tag: 'VEGETARIAN', label: 'Vegetarian', id: 'diet-vegetarian' },
  { tag: 'VEGAN', label: 'Vegan', id: 'diet-vegan' },
  { tag: 'GLUTEN_FREE', label: 'Gluten free', id: 'diet-gluten-free' },
  { tag: 'DAIRY_FREE', label: 'Dairy free', id: 'diet-dairy-free' },
  { tag: 'NUT_FREE', label: 'Nut free', id: 'diet-nut-free' },
  { tag: 'SPICY', label: 'Spicy', id: 'diet-spicy' },
  { tag: 'KETO', label: 'Keto', id: 'diet-keto' },
  { tag: 'LOW_CARB', label: 'Low carb', id: 'diet-low-carb' },
];

export const ALLERGENS: { tag: AllergenTag; label: string; id: string }[] = [
  { tag: 'PEANUTS', label: 'Peanuts', id: 'allergen-peanuts' },
  { tag: 'TREE_NUTS', label: 'Tree nuts', id: 'allergen-tree-nuts' },
  { tag: 'SESAME', label: 'Sesame', id: 'allergen-sesame' },
  { tag: 'MILK', label: 'Milk', id: 'allergen-milk' },
  { tag: 'EGGS', label: 'Eggs', id: 'allergen-eggs' },
  { tag: 'FISH', label: 'Fish', id: 'allergen-fish' },
  { tag: 'CRUSTACEANS_MOLLUSCS', label: 'Crustaceans and molluscs', id: 'allergen-crustaceans' },
  { tag: 'SOY', label: 'Soy', id: 'allergen-soy' },
  { tag: 'WHEAT_TRITICALE', label: 'Wheat and triticale', id: 'allergen-wheat' },
  { tag: 'SULPHITES', label: 'Sulphites', id: 'allergen-sulphites' },
  { tag: 'MUSTARD', label: 'Mustard', id: 'allergen-mustard' },
];

/** Labels for display; `HALAL_CERTIFIED` is never shown as a dietary tag (halal comes from the certificate). */
export function dietaryLabels(tags: readonly DietaryTag[] | undefined): string[] {
  const out: string[] = [];
  for (const d of DIETARY) if (tags?.includes(d.tag) && !out.includes(d.label)) out.push(d.label);
  return out;
}

export function allergenLabels(tags: readonly AllergenTag[] | undefined): string[] {
  const out: string[] = [];
  for (const a of ALLERGENS) if (tags?.includes(a.tag) && !out.includes(a.label)) out.push(a.label);
  return out;
}

// ── Items ──────────────────────────────────────────────────────────────────────────────

/** Display name: the server hydrates `name` from the live version, else the pending one. */
export function itemName(item: MenuItem): string {
  return item.name || item.live_version?.name || item.pending_version?.name || '';
}

export type ReviewKind = 'approved' | 'under-review' | 'first-review' | 'rejected' | 'rejected-new' | 'withdrawn';

export interface ReviewView {
  kind: ReviewKind;
  label: 'Approved' | 'Under review' | 'Waiting for first review' | 'Not approved' | 'Withdrawn';
  variant: 'neutral' | 'info' | 'warning';
  outline?: boolean;
  icon?: 'check' | 'clock';
  sub: string | null;
  reason: RejectionCode | null;
}

/**
 * The Review column (spec §0). Never "Draft". A `DRAFT`, `APPROVED` or `SUPERSEDED` pending
 * version reads as the item's approved state (the owner view should never carry one).
 */
export function reviewOf(item: MenuItem): ReviewView {
  const live = item.live_version ?? null;
  const pending = item.pending_version ?? null;
  const status = pending?.review_status;
  if (status === 'PENDING_REVIEW') {
    return live
      ? { kind: 'under-review', label: 'Under review', variant: 'info', icon: 'clock', sub: 'Customers see the approved version', reason: null }
      : { kind: 'first-review', label: 'Waiting for first review', variant: 'info', icon: 'clock', sub: 'Not on your menu yet', reason: null };
  }
  if (status === 'REJECTED') {
    const reason = (pending?.rejection_reason_code ?? null) as RejectionCode | null;
    const label = reason ? REJECTION_LABEL[reason] : null;
    return live
      ? { kind: 'rejected', label: 'Not approved', variant: 'warning', sub: label, reason }
      : { kind: 'rejected-new', label: 'Not approved', variant: 'warning', sub: label ? `${label} · Not on your menu` : 'Not on your menu', reason };
  }
  if (status === 'WITHDRAWN') {
    return { kind: 'withdrawn', label: 'Withdrawn', variant: 'info', outline: true, sub: 'Customers see the approved version', reason: null };
  }
  if (live) return { kind: 'approved', label: 'Approved', variant: 'neutral', icon: 'check', sub: null, reason: null };
  if (pending) {
    // DRAFT / SUPERSEDED with nothing live: it is waiting to be (re)reviewed, never "Draft".
    return { kind: 'first-review', label: 'Waiting for first review', variant: 'info', icon: 'clock', sub: 'Not on your menu yet', reason: null };
  }
  // BACKEND GAP (spec §0): a rejected new item comes back with no version at all.
  return { kind: 'rejected-new', label: 'Not approved', variant: 'warning', sub: 'Not on your menu', reason: null };
}

/** The pending name, when it differs from the live one ("Under review: {name}"). */
export function pendingRename(item: MenuItem): string | null {
  const live = item.live_version;
  const pending = item.pending_version;
  if (!live || !pending || pending.review_status !== 'PENDING_REVIEW') return null;
  return pending.name && pending.name !== live.name ? pending.name : null;
}

export function optionGroupCount(item: MenuItem): number {
  return (item.variant_groups?.length ?? 0) + (item.addon_groups?.length ?? 0);
}

// ── Categories ─────────────────────────────────────────────────────────────────────────

export function categoryNote(cat: MenuCategoryRow): 'Inactive' | 'Empty' | 'Not on your menu yet' | null {
  if (!cat.is_active) return 'Inactive';
  if (cat.items.length === 0) return 'Empty';
  if (!cat.items.some((i) => i.live_version)) return 'Not on your menu yet';
  return null;
}

export function allOutOfStock(items: readonly MenuItem[]): boolean {
  return items.length > 0 && items.every((i) => i.availability_state === 'OUT_OF_STOCK');
}

export function itemCountLabel(n: number): string {
  return n === 1 ? '1 item' : `${n} items`;
}

export function categoryCountLabel(n: number): string {
  return n === 1 ? '1 category' : `${n} categories`;
}

/** "Customers can order {k}": live, available, in an active category. */
export function orderableCount(menu: OwnedMenu): number {
  let n = 0;
  for (const c of menu.categories) {
    if (!c.is_active) continue;
    for (const i of c.items) if (i.live_version && i.availability_state === 'AVAILABLE') n += 1;
  }
  return n;
}

export function totalItems(menu: OwnedMenu): number {
  return menu.categories.reduce((n, c) => n + c.items.length, 0);
}

// ── Search and filter (spec §3) ────────────────────────────────────────────────────────

export type ShowFilter = 'all' | 'oos' | 'pending' | 'rejected' | 'blocked';

export const SHOW_OPTIONS: { value: ShowFilter; label: string }[] = [
  { value: 'all', label: 'All items' },
  { value: 'oos', label: 'Out of stock' },
  { value: 'pending', label: 'Under review' },
  { value: 'rejected', label: 'Not approved' },
  { value: 'blocked', label: 'Blocked or hidden' },
];

/** Grid title for a filter with no search, and the noun its empty state uses. */
export const FILTER_TITLE: Record<Exclude<ShowFilter, 'all'>, { title: string; noun: string }> = {
  oos: { title: 'Out of stock items', noun: 'out-of-stock items' },
  pending: { title: 'Items under review', noun: 'items under review' },
  rejected: { title: 'Items not approved', noun: 'items not approved' },
  blocked: { title: 'Blocked or hidden items', noun: 'blocked or hidden items' },
};

export function matchesFilter(item: MenuItem, filter: ShowFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'oos':
      return item.availability_state === 'OUT_OF_STOCK';
    case 'pending': {
      const k = reviewOf(item).kind;
      return k === 'under-review' || k === 'first-review';
    }
    case 'rejected': {
      const k = reviewOf(item).kind;
      return k === 'rejected' || k === 'rejected-new';
    }
    case 'blocked':
      return item.availability_state === 'BLOCKED' || item.availability_state === 'HIDDEN';
  }
}

export function matchesQuery(item: MenuItem, q: string): boolean {
  const needle = q.trim().toLocaleLowerCase();
  if (!needle) return true;
  const hay = [itemName(item), item.pending_version?.name ?? '', item.description ?? ''].join(' ').toLocaleLowerCase();
  return hay.includes(needle);
}

export interface ResultGroup {
  category: MenuCategoryRow;
  items: MenuItem[];
}

export function searchMenu(menu: OwnedMenu, q: string, filter: ShowFilter): ResultGroup[] {
  const out: ResultGroup[] = [];
  for (const category of menu.categories) {
    const items = category.items.filter((i) => matchesFilter(i, filter) && matchesQuery(i, q));
    if (items.length) out.push({ category, items });
  }
  return out;
}

// ── Account lock and certificate (spec §6) ─────────────────────────────────────────────

/** SUSPENDED/BANNED: locked (incl. availability). DEACTIVATED: view only. DELISTED: editable. */
export type MenuAccess = 'edit' | 'locked' | 'view-only';

export function accessOf(state: AccountState | null | undefined, refusedLock: boolean): MenuAccess {
  if (refusedLock || state === 'SUSPENDED' || state === 'BANNED') return 'locked';
  // An unknown state (the profile has not loaded, or failed to) fails closed: never 'edit'.
  if (state === 'DEACTIVATED' || !state) return 'view-only';
  return 'edit';
}

/** Customers can’t see the menu right now (summary's second sentence, spec §3). */
export function customersCantSee(state: AccountState | null | undefined, halal: HalalState | null | undefined): boolean {
  return halal === 'EXPIRED' || halal === 'UNVERIFIED' || state === 'DELISTED';
}

// ── Availability text (spec §2) ────────────────────────────────────────────────────────

function calendarDay(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
}

/** "8:30 pm", or "2:00 am tomorrow" when the end is on the restaurant's next calendar day. */
export function untilTime(iso: string, now: number, timeZone: string): string {
  const at = Date.parse(iso);
  const time = formatTime(at, timeZone);
  return calendarDay(at, timeZone) !== calendarDay(now, timeZone) && at > now ? `${time} tomorrow` : time;
}

/** One hour from now on the server's clock (the "For 1 hour" choice). Not money, not closing. */
export const ONE_HOUR_MS = 60 * 60 * 1000;

/** How the restaurant last chose a length this session, so the row can say "for 1 hour". */
export type LengthChoice = { kind: 'hour'; until: string } | { kind: 'indefinite' };

export function untilText(item: MenuItem, choice: LengthChoice | undefined, now: number, timeZone: string): string {
  const until = item.out_of_stock_until ?? null;
  if (!until) return 'until you turn it back on';
  const time = untilTime(until, now, timeZone);
  if (choice?.kind === 'hour' && choice.until === until) return `for 1 hour (until ${time})`;
  return `until ${time}`;
}

// ── Editor helpers ─────────────────────────────────────────────────────────────────────

/** "$12.50" / "12.5" / "12" typed by the owner → integer cents, or null. No floats. */
export function parsePriceToCents(text: string): number | null {
  const t = text.replace(/[$,\s]/g, '');
  const m = /^(\d{1,6})(?:\.(\d{0,2}))?$/.exec(t);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = (m[2] ?? '').padEnd(2, '0');
  return whole * 100 + Number(frac || '0');
}

/** Integer cents → "12.50" for the price field (string assembly, not float maths). */
export function centsToField(c: number | null | undefined): string {
  if (c === null || c === undefined) return '';
  const whole = Math.trunc(c / 100);
  const frac = String(Math.abs(c % 100)).padStart(2, '0');
  return `${whole}.${frac}`;
}

export function priceInRange(c: number | null): boolean {
  return c !== null && c >= PRICE_MIN_CENTS && c <= PRICE_MAX_CENTS;
}

/** Reason → the field the reviewer flagged (spec §7). */
export function flaggedFieldOf(reason: RejectionCode | null): ('description' | 'diet' | 'allergens' | 'photo' | 'name')[] {
  switch (reason) {
    case 'MISLEADING_DESCRIPTION':
    case 'UNSUBSTANTIATED_HALAL_CLAIM':
      return ['description'];
    case 'OFFENSIVE_CONTENT':
      return ['name', 'description'];
    case 'INCORRECT_DIETARY_TAG':
      return ['diet'];
    case 'MISSING_ALLERGEN':
      return ['allergens'];
    case 'POOR_IMAGE_QUALITY':
    case 'IMAGE_NOT_OF_DISH':
      return ['photo'];
    default:
      return [];
  }
}

/** "price and the description" — a list of changed fields in prose. */
export function listInProse(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
