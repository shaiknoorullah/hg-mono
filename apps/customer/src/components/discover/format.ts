/**
 * Display helpers for the Discover and Order screens. Every number shown comes from the
 * server's own fields (`availability`, `halal`, `hours`); nothing here computes a fee, a
 * distance or an ETA (C-14: the client renders, it never recomputes).
 */
import { summariseCuisines } from '@hg/ui-native';
import type { Restaurant } from '@hg/ui-native';

/**
 * "Pakistani · Biryani · $$". A cuisine literally named "Halal" is dropped: halal is shown
 * only by the restaurant's badge, never as a cuisine word that would read as a second claim.
 */
export function cuisineLine(r: Pick<Restaurant, 'cuisines' | 'price_band'>): string | null {
  const cuisines = summariseCuisines((r.cuisines ?? []).filter((c) => c.toLowerCase() !== 'halal'));
  const parts = [cuisines, r.price_band ?? null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** "11:00 am" — the canvas's clock style, in the device's time zone. */
export function clockTime(iso: string | Date): string | null {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return null;
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** "opens at 6:00 pm", "opens tomorrow at 11:00 am", "opens Friday at 1:00 pm". */
export function opensPhrase(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const time = clockTime(d);
  if (!time) return null;
  const day = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86_400_000);
  if (diff <= 0) return `opens at ${time}`;
  if (diff === 1) return `opens tomorrow at ${time}`;
  const weekday = new Intl.DateTimeFormat('en-CA', { weekday: 'long' }).format(d);
  return `opens ${weekday} at ${time}`;
}

/** "20 Oct" from a contract `date` (YYYY-MM-DD), read as a calendar date, not an instant. */
export function shortDate(date: string | null | undefined): string | null {
  if (!date) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return null;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]}`;
}

/** "25–35 min · 1.8 km", or whichever half the server supplied. */
export function etaDistance(a: Restaurant['availability']): string | null {
  const parts: string[] = [];
  if (a.eta_min_minutes != null) {
    parts.push(
      a.eta_max_minutes != null && a.eta_max_minutes !== a.eta_min_minutes
        ? `${a.eta_min_minutes}–${a.eta_max_minutes} min`
        : `${a.eta_min_minutes} min`,
    );
  }
  if (a.distance_m != null) parts.push(`${(a.distance_m / 1000).toFixed(1)} km`);
  return parts.length ? parts.join(' · ') : null;
}

/**
 * The one-line verdict for a restaurant that cannot take an order right now, or null when it
 * can (OPEN) or when the reason is the customer's missing address (shown separately).
 */
export function unavailableLabel(a: Restaurant['availability']): string | null {
  switch (a.state) {
    case 'OPEN':
    case 'NO_ADDRESS':
      return null;
    case 'CLOSED_HOURS': {
      const opens = opensPhrase(a.opens_at);
      return opens ? `Closed · ${opens}` : 'Closed now';
    }
    case 'PAUSED':
      return 'Not taking orders right now';
    case 'OUT_OF_RANGE':
      return 'Too far to deliver';
    default:
      // An unknown verdict is never rendered as open.
      return 'Not available right now';
  }
}
