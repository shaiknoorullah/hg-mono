/**
 * Display helpers for restaurant cards on Home (and later Search and Browse). Ported from #634
 * `components/discover/format.ts`, with its clock code replaced by the redesign's one formatter
 * (`lib/time.ts`, Toronto time) and its card halal rule replaced by `presentHalal`.
 *
 * Every number shown comes from the server's own fields (`availability`, `halal`); nothing here
 * computes a fee, a distance or an ETA (C-14: the client renders, it never recomputes).
 */
import { cents, type Schema } from '@hg/api-client';

import { spokenPrice } from '../ds';
import { CERTIFICATE_UNAVAILABLE, type HalalPresentation } from '../lib/halal';
import { APP_TIME_ZONE, formatDate, formatShortDate, formatTime } from '../lib/time';

export type RestaurantCard = Schema['RestaurantCard'];
export type Availability = Schema['RestaurantAvailabilityInfo'];
export type Address = Schema['Address'];

/** Cuisines without a cuisine literally named "Halal": halal is shown only by the badge. */
function cuisines(r: Pick<RestaurantCard, 'cuisines'>): string[] {
  return (r.cuisines ?? []).filter((c) => c.trim().toLowerCase() !== 'halal').slice(0, 3);
}

/** "Levantine · Grill · $$". */
export function cuisineLine(r: Pick<RestaurantCard, 'cuisines' | 'price_band'>): string | null {
  const parts = [...cuisines(r), r.price_band ?? null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

const PRICE_BAND_SPOKEN: Record<string, string> = {
  $: 'Inexpensive',
  $$: 'Moderately priced',
  $$$: 'Expensive',
  $$$$: 'Very expensive',
};

/** "25–35 min". */
export function etaLine(a: Availability): string | null {
  if (a.eta_min_minutes == null) return null;
  if (a.eta_max_minutes == null || a.eta_max_minutes === a.eta_min_minutes) return `${a.eta_min_minutes} min`;
  return `${a.eta_min_minutes}–${a.eta_max_minutes} min`;
}

/** "1.8 km", one decimal from server metres. */
export function distanceLine(a: Availability): string | null {
  return a.distance_m == null ? null : `${(a.distance_m / 1000).toFixed(1)} km`;
}

/** "25–35 min · 1.8 km", or whichever half the server supplied. */
export function etaDistance(a: Availability): string | null {
  const parts = [etaLine(a), distanceLine(a)].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** The calendar day of an instant in Toronto, as a comparable number (YYYYMMDD). */
function torontoDay(value: number | string | Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  return Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day')));
}

/** "opens at 6:00 pm", "opens tomorrow at 11:00 am", "opens Friday at 1:00 pm". */
export function opensPhrase(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const time = formatTime(at);
  const diff = Math.round((torontoDay(at) - torontoDay(now)) / 86_400_000);
  if (diff <= 0) return `opens at ${time}`;
  if (diff === 1) return `opens tomorrow at ${time}`;
  const weekday = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE, weekday: 'long' }).format(at);
  return `opens ${weekday} at ${time}`;
}

/**
 * The one-line verdict for a restaurant that cannot take an order right now, or null when it can
 * (OPEN) or when the reason is the customer's missing address (shown separately).
 */
export function unavailableLabel(a: Availability, now: number, address?: Address | null): string | null {
  switch (a.state) {
    case 'OPEN':
    case 'NO_ADDRESS':
      return null;
    case 'CLOSED_HOURS': {
      const opens = opensPhrase(a.opens_at, now);
      return opens ? `Closed · ${opens}` : 'Closed now';
    }
    case 'PAUSED':
      return 'Not taking orders right now';
    case 'OUT_OF_RANGE':
      return address ? `Too far to deliver to ${address.label?.trim() || address.line1}` : 'Too far to deliver';
    default:
      // An unknown verdict is never rendered as open.
      return 'Not taking orders right now';
  }
}

export const NO_ADDRESS_LINE = 'Add an address for delivery time and fee';

/** The halal sentence inside a card's accessible name; never "Halal certified" without the record. */
export function spokenHalal(p: HalalPresentation): string | null {
  switch (p.kind) {
    case 'badge':
      return p.state === 'EXPIRING_SOON'
        ? `Halal certified by ${p.certifyingBody}, certificate expires ${formatDate(p.expiresOn).replace(/ \d{4}$/, '')}.`
        : `Halal certified by ${p.certifyingBody}.`;
    case 'unavailable':
      return `${CERTIFICATE_UNAVAILABLE}.`;
    case 'stale':
      return 'Certification cannot be checked while offline.';
    case 'expired':
      return 'Halal certification expired.';
    case 'none':
      return null;
  }
}

/** "expires 20 Oct", the dated label beside an expiring badge. */
export function expiresLabel(p: HalalPresentation): string | null {
  return p.kind === 'badge' && p.state === 'EXPIRING_SOON' ? `expires ${formatShortDate(p.expiresOn)}` : null;
}

/**
 * One accessible name per card (DO/Main): name, halal, cuisines, price band, then either why it
 * cannot take an order or its time, distance, fee and minimum.
 *
 * "Zaytoun Grill. Halal certified by Halal Monitoring Authority (HMA Canada). Levantine, Grill.
 * Moderately priced. 25 to 35 minutes, 1.8 kilometres. Delivery about 2 dollars and 99 cents,
 * estimate. Minimum order 15 dollars."
 */
export function restaurantCardLabel(
  r: RestaurantCard,
  halal: HalalPresentation,
  now: number,
  address?: Address | null,
): string {
  const a = r.availability;
  const parts: (string | null)[] = [`${r.name}.`, spokenHalal(halal)];
  const c = cuisines(r);
  if (c.length) parts.push(`${c.join(', ')}.`);
  if (r.price_band) parts.push(`${PRICE_BAND_SPOKEN[r.price_band] ?? r.price_band}.`);
  if (a.state === 'NO_ADDRESS') {
    parts.push('Add an address to see delivery time and fee.');
  } else {
    const blocked = unavailableLabel(a, now, address);
    if (blocked) {
      parts.push(`${blocked.replace(' · ', ', ')}.`);
    } else {
      const eta = etaLine(a)?.replace('–', ' to ').replace(' min', ' minutes');
      const dist = distanceLine(a)?.replace(' km', ' kilometres');
      const where = [eta, dist].filter(Boolean).join(', ');
      if (where) parts.push(`${where}.`);
      if (a.indicative_delivery_fee_cents != null) {
        parts.push(`Delivery about ${spokenPrice(cents(a.indicative_delivery_fee_cents))}, estimate.`);
      }
      if (a.minimum_order_cents != null) parts.push(`Minimum order ${spokenPrice(cents(a.minimum_order_cents))}.`);
    }
  }
  return parts.filter(Boolean).join(' ');
}

/** "Home · 14 Ellesmere Rd", or the street alone when the address has no label. */
export function addressTitle(a: Address): string {
  const label = a.label?.trim();
  return label ? `${label} · ${a.line1}` : a.line1;
}

/** The name a person calls an address: its label, or its street. */
export function addressName(a: Address): string {
  return a.label?.trim() || a.line1;
}

/** The switcher's radio label: "Home (default) · 14 Ellesmere Rd". */
export function addressOptionLabel(a: Address): string {
  const label = a.label?.trim();
  const def = a.is_default ? ' (default)' : '';
  return label ? `${label}${def} · ${a.line1}` : `${a.line1}${def}`;
}

/**
 * The switcher's description: "Unit 402, Toronto, ON M1R 4E7". A stored unit that already starts
 * with Unit, Apt, Suite or # is shown as is; otherwise "Unit " is added (AC/AddressSwitcher).
 */
export function addressOptionDescription(a: Address): string {
  const unit = a.unit?.trim();
  const unitText = unit ? (/^(unit|apt|suite|#)/i.test(unit) ? unit : `Unit ${unit}`) : null;
  return [unitText, a.line2?.trim() || null, `${a.city}, ${a.province} ${a.postal_code}`].filter(Boolean).join(', ');
}
