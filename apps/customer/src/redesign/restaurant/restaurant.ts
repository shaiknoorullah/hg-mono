/**
 * The restaurant page's rules, without UI (manifest D5, D6, D7; ported from #634's
 * `RestaurantScreen` and `discover/format.ts`, and #158's certificate view).
 *
 * Every number shown comes from the server's own fields (`availability`, `hours`, `halal`):
 * nothing here computes a fee, a distance or an ETA (C-14), and nothing prices anything.
 */
import { cents, isApiError, unwrap } from '@hg/api-client';
import type { Schema } from '@hg/api-client';

import { api } from '../api/client';
import { spokenPrice } from '../ds';
import { presentHalal, type HalalContext, type HalalPresentation } from '../lib/halal';
import {
  APP_TIME_ZONE,
  calendarDaysBetween,
  formatTime,
  formatWallClockRange,
  formatWeekday,
  weekdayIn,
} from '../lib/time';

export type RestaurantDetail = Schema['RestaurantDetail'];
export type Menu = Schema['Menu'];
export type MenuItem = Schema['MenuItem'];
export type MenuCategory = Schema['MenuCategoryWithItems'];
export type Cart = Schema['Cart'];
export type Address = Schema['Address'];
export type CertificationPanel = Schema['CertificationPanel'];
export type PresignedDownload = Schema['PresignedDownload'];
export type Availability = RestaurantDetail['availability'];

/* ------------------------------------------------------------------ loading */

export interface RestaurantPage {
  detail: RestaurantDetail;
  /** The customer's selected address (the cart's), or their default; null with none. */
  address: Address | null;
}

/** The cart, or null when there is none to show (signed out, empty, or the read failed). */
export async function loadCart(): Promise<Cart | null> {
  try {
    const body = await unwrap(api.GET('/v1/cart'));
    const cart = body.data as Cart;
    return Array.isArray(cart?.lines) ? cart : null;
  } catch {
    return null;
  }
}

async function loadAddresses(): Promise<Address[]> {
  try {
    const body = await unwrap(api.GET('/v1/addresses'));
    return Array.isArray(body.data) ? (body.data as Address[]) : [];
  } catch {
    return [];
  }
}

/**
 * The address the page is judged against: the cart's `delivery_address_id` (always the
 * customer's currently selected address), else the default, else none. Never `addresses[0]`
 * when a default exists.
 */
export function selectedAddress(cart: Cart | null, addresses: readonly Address[]): Address | null {
  const id = cart?.delivery_address_id ?? null;
  if (id) {
    const match = addresses.find((a) => a.id === id);
    if (match) return match;
  }
  return addresses.find((a) => a.is_default) ?? null;
}

/**
 * Reads the restaurant against the selected address. The server computes availability
 * (`NO_ADDRESS` when none is sent); the client never does.
 */
export async function loadRestaurant(restaurantId: string, cart: Cart | null): Promise<RestaurantPage> {
  const addresses = await loadAddresses();
  const address = selectedAddress(cart, addresses);
  const addressId = address?.id ?? cart?.delivery_address_id ?? null;
  const body = await unwrap(
    api.GET('/v1/restaurants/{restaurantId}', {
      params: { path: { restaurantId }, query: addressId ? { delivery_address_id: addressId } : undefined },
    }),
  );
  return { detail: body.data as RestaurantDetail, address };
}

export async function loadMenu(restaurantId: string): Promise<Menu> {
  const body = await unwrap(api.GET('/v1/restaurants/{restaurantId}/menu', { params: { path: { restaurantId } } }));
  return body.data as Menu;
}

export async function loadCertification(restaurantId: string): Promise<CertificationPanel> {
  const body = await unwrap(
    api.GET('/v1/restaurants/{restaurantId}/certification', { params: { path: { restaurantId } } }),
  );
  return body.data as CertificationPanel;
}

/**
 * Mints a presigned certificate link (300 s, single use, audited server-side). Called per view,
 * never prefetched and never stored: the link is the document's only key.
 */
export async function mintCertificateUrl(restaurantId: string): Promise<PresignedDownload> {
  const body = await unwrap(
    api.POST('/v1/restaurants/{restaurantId}/certificate-url', { params: { path: { restaurantId } } }),
  );
  return body.data as PresignedDownload;
}

export function isNotFound(e: unknown): boolean {
  return isApiError(e) && (e.status === 404 || String(e.code) === 'NOT_FOUND');
}

/** A transport failure (no response at all), as opposed to an error the API returned. */
export function isOffline(e: unknown): boolean {
  return !isApiError(e);
}

/* ------------------------------------------------------- restaurant names */

/**
 * Names of restaurants opened this session, in memory only, so the certificate viewer can say
 * "Back to Zaytoun Grill" without another read. A deep link with no name says "Back".
 */
const names = new Map<string, string>();

export function rememberRestaurantName(id: string, name: string): void {
  names.set(id, name);
}

export function restaurantNameFor(id: string): string | null {
  return names.get(id) ?? null;
}

/* -------------------------------------------------------------------- halal */

/**
 * A restaurant whose halal state is EXPIRED or UNVERIFIED is not listed: the API 404s it, and a
 * 200 that still carries one is treated the same way. No halal reason is ever given.
 */
export function isUnlisted(detail: RestaurantDetail): boolean {
  const states = [detail.halal?.display_state, detail.certification?.display_state];
  return states.some((s) => s === 'EXPIRED' || s === 'UNVERIFIED');
}

/**
 * The page's halal row. It reads the certification record (body, number, dates) when the
 * detail embeds one, else the card's badge fields; a missing or partial record is the neutral
 * line, never a badge.
 */
export function pageHalal(
  record: Pick<CertificationPanel, 'display_state' | 'certifying_body_name' | 'expires_on'> | null | undefined,
  ctx: HalalContext,
): HalalPresentation {
  return presentHalal(record ?? null, ctx);
}

/** The certificate viewer's "Scope" value (board `DO/Cert-open`). The enum name is never shown. */
export const SCOPE_TEXT: Readonly<Record<string, string>> = {
  WHOLE_ESTABLISHMENT: 'The whole restaurant',
  KITCHEN_ONLY: 'The kitchen only',
  SPECIFIC_MENU_ITEMS: 'Specific menu items only',
  SUPPLIER_CHAIN_ONLY: 'The supplier chain only',
};

/* ------------------------------------------------------------- availability */

/** "opens at 6:00 pm", "opens tomorrow at 11:00 am", "opens Friday at 1:00 pm". */
export function opensPhrase(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const time = formatTime(at);
  const days = calendarDaysBetween(now, at);
  if (days <= 0) return `opens at ${time}`;
  if (days === 1) return `opens tomorrow at ${time}`;
  return `opens ${formatWeekday(at)} at ${time}`;
}

/** "1.8 km", from the server's geodesic metres. Display only. */
export function distanceText(m: number | null | undefined): string | null {
  return m == null ? null : `${(m / 1000).toFixed(1)} km`;
}

/** "25–35 min". */
export function etaText(a: Availability): string | null {
  if (a.eta_min_minutes == null) return null;
  return a.eta_max_minutes != null && a.eta_max_minutes !== a.eta_min_minutes
    ? `${a.eta_min_minutes}–${a.eta_max_minutes} min`
    : `${a.eta_min_minutes} min`;
}

/** The line under the cuisines: what the availability verdict lets the page say. */
export function availabilityLine(a: Availability): string | null {
  const until = a.closes_at ? formatTime(a.closes_at) : null;
  const distance = distanceText(a.distance_m);
  switch (a.state) {
    case 'OPEN':
      return [etaText(a), until ? `open until ${until}` : null].filter(Boolean).join(' · ') || null;
    case 'NO_ADDRESS':
      return until ? `Open until ${until} · add an address for time and fee` : 'Add an address for time and fee';
    case 'CLOSED_HOURS':
      return [distance, 'closed now'].filter(Boolean).join(' · ');
    default:
      return distance;
  }
}

export type BannerAction = 'findOpen' | 'changeAddress' | 'addAddress';

export interface AvailabilityBanner {
  title: string;
  description: string;
  action: { label: string; kind: BannerAction };
}

/** "Home", or the first line when the address has no label. */
export function addressName(a: Address | null): string | null {
  if (!a) return null;
  return a.label?.trim() || a.line1;
}

/**
 * The banner for a restaurant that cannot take an order right now, each with its way forward
 * (boards `DO/Restaurant-closed`, `-paused`, `-out-of-range`, `-no-address`). OPEN has none.
 * An unknown verdict is never treated as open.
 */
export function availabilityBanner(
  detail: RestaurantDetail,
  address: Address | null,
  now: number,
): AvailabilityBanner | null {
  const a = detail.availability;
  switch (a.state) {
    case 'OPEN':
      return null;
    case 'CLOSED_HOURS': {
      const opens = opensPhrase(a.opens_at, now);
      return {
        title: opens ? `Closed now · ${opens}` : 'Closed now',
        description: 'You can read the menu. Adding to your cart opens when the kitchen does.',
        action: { label: 'Find an open restaurant', kind: 'findOpen' },
      };
    }
    case 'PAUSED':
      return {
        title: 'Not taking orders right now',
        description: 'The kitchen has paused new orders. You can read the menu and check back later.',
        action: { label: 'Find an open restaurant', kind: 'findOpen' },
      };
    case 'OUT_OF_RANGE':
      return {
        title: `Too far to deliver to ${addressName(address) ?? 'your address'}`,
        description: `${address?.line1 ?? 'Your address'} is outside this restaurant's delivery area. Choose another address to order.`,
        action: { label: 'Change address', kind: 'changeAddress' },
      };
    case 'NO_ADDRESS':
      return {
        title: 'Add a delivery address to order',
        description: `We need it to check that ${detail.name} delivers to you and to show the delivery time and fee.`,
        action: { label: 'Add an address', kind: 'addAddress' },
      };
    default:
      // An unknown verdict reads as paused: the menu stays readable, adding stays closed.
      return {
        title: 'Not taking orders right now',
        description: 'The kitchen has paused new orders. You can read the menu and check back later.',
        action: { label: 'Find an open restaurant', kind: 'findOpen' },
      };
  }
}

/** Whether adding to the cart is open: only an OPEN verdict, online. Browsing never closes. */
export function canAdd(a: Availability, online: boolean): boolean {
  return online && a.state === 'OPEN';
}

/* -------------------------------------------------------------------- hours */

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Monday first, as the canvas lists the week. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export function dayRange(hours: RestaurantDetail['hours'], day: number): string {
  const xs = (hours ?? []).filter((h) => h.day_of_week === day);
  return xs.length ? xs.map((h) => formatWallClockRange(h.opens_at, h.closes_at)).join(', ') : 'Closed';
}

export interface HoursRow {
  day: number;
  label: string;
  range: string;
  today: boolean;
}

/** The week's rows, Monday first, with "(today)" in the restaurant's zone. */
export function hoursRows(detail: RestaurantDetail, now: number): HoursRow[] {
  const today = weekdayIn(now, detail.timezone || APP_TIME_ZONE);
  return WEEK_ORDER.map((d) => ({
    day: d,
    label: d === today ? `${DAY_NAMES[d]} (today)` : DAY_NAMES[d]!,
    range: dayRange(detail.hours, d),
    today: d === today,
  }));
}

/** "Opening hours · today 11:00 am–10:00 pm". */
export function hoursSummary(detail: RestaurantDetail, now: number): string {
  const today = weekdayIn(now, detail.timezone || APP_TIME_ZONE);
  return `Opening hours · today ${dayRange(detail.hours, today)}`;
}

/* --------------------------------------------------------------------- menu */

/**
 * The listed menu: active categories, each with its AVAILABLE and OUT_OF_STOCK items. HIDDEN and
 * BLOCKED items are not listed (BLOCKED is an admin compliance block: never shown with a reason
 * or any marker). A category left with nothing is dropped.
 */
export function visibleCategories(menu: Menu): MenuCategory[] {
  return (menu.categories ?? [])
    .filter((c) => c.is_active !== false)
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((c) => ({
      ...c,
      items: (c.items ?? []).filter((i) => i.availability_state === 'AVAILABLE' || i.availability_state === 'OUT_OF_STOCK'),
    }))
    .filter((c) => c.items.length > 0);
}

const DIETARY_LABEL: Readonly<Record<string, string>> = {
  VEGETARIAN: 'Vegetarian',
  VEGAN: 'Vegan',
  GLUTEN_FREE: 'Gluten free',
  DAIRY_FREE: 'Dairy free',
  NUT_FREE: 'Nut free',
  SPICY: 'Spicy',
  KETO: 'Keto',
  LOW_CARB: 'Low carb',
};

/**
 * Dietary badges. `HALAL_CERTIFIED` is never one: halal is shown only by the restaurant's seal,
 * and a dish-level halal mark would be a claim the platform cannot make. Unknown tags are
 * dropped rather than shown as raw enum names.
 */
export function dietaryBadges(tags: readonly string[] | null | undefined): string[] {
  return (tags ?? []).filter((t) => t !== 'HALAL_CERTIFIED').flatMap((t) => (DIETARY_LABEL[t] ? [DIETARY_LABEL[t]!] : []));
}

const ALLERGEN_WORD: Readonly<Record<string, string>> = {
  PEANUTS: 'peanuts',
  TREE_NUTS: 'tree nuts',
  SESAME: 'sesame',
  MILK: 'milk',
  EGGS: 'eggs',
  FISH: 'fish',
  CRUSTACEANS_MOLLUSCS: 'crustaceans and molluscs',
  SOY: 'soy',
  WHEAT_TRITICALE: 'wheat',
  SULPHITES: 'sulphites',
  MUSTARD: 'mustard',
};

/** "Contains wheat, sesame, eggs", or null when the list is empty (never "No allergens"). */
export function containsLine(tags: readonly string[] | null | undefined): string | null {
  const words = (tags ?? []).map((a) => ALLERGEN_WORD[a] ?? a.toLowerCase().replace(/_/g, ' '));
  return words.length ? `Contains ${words.join(', ')}` : null;
}

/** "Out of stock · back at 7:30 pm", or "Out of stock" with no restock time. */
export function outOfStockLine(item: MenuItem): string | null {
  if (item.availability_state !== 'OUT_OF_STOCK') return null;
  return item.out_of_stock_until ? `Out of stock · back at ${formatTime(item.out_of_stock_until)}` : 'Out of stock';
}

/** "Mixed charcoal grill, 24 dollars and 99 cents. Contains wheat, sesame, eggs." */
export function menuItemAccessibleName(item: MenuItem): string {
  const stock = outOfStockLine(item);
  const diet = dietaryBadges(item.dietary_tags);
  const contains = containsLine(item.allergen_tags);
  return [
    `${item.name}, ${spokenPrice(cents(item.price_cents))}.`,
    stock ? `${stock.replace(' · ', ', ')}.` : null,
    diet.length ? `${diet.join(', ')}.` : null,
    contains ? `${contains}.` : null,
  ]
    .filter(Boolean)
    .join(' ');
}

/* --------------------------------------------------------------------- misc */

/** "Levantine · Grill · $$". A cuisine named "Halal" is dropped: halal is shown only by the seal. */
export function cuisineLine(detail: Pick<RestaurantDetail, 'cuisines' | 'price_band'>): string | null {
  const parts = [...(detail.cuisines ?? []).filter((c) => c.trim().toLowerCase() !== 'halal'), detail.price_band ?? null].filter(
    Boolean,
  );
  return parts.length ? parts.join(' · ') : null;
}

/** "+14165550148" → "(416) 555-0148". Anything else is shown as given. */
export function formatPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

/** "1450 Lawrence Ave E, Toronto · 1.8 km from Home". */
export function aboutAddressLine(detail: RestaurantDetail, address: Address | null): string {
  const base = `${detail.address.line1}, ${detail.address.city}`;
  const d = distanceText(detail.availability.distance_m);
  const name = addressName(address);
  return d && name && detail.availability.state !== 'NO_ADDRESS' ? `${base} · ${d} from ${name}` : base;
}

/** "3 items", "1 item". */
export function itemCountText(n: number): string {
  return `${n} ${n === 1 ? 'item' : 'items'}`;
}

/** Whether a presigned link is a PDF (the viewer only shows images in the app today). */
export function isPdfUrl(url: string): boolean {
  return /\.pdf$/i.test(url.split(/[?#]/)[0] ?? '');
}
