/**
 * Internal helpers shared by the navigation / feedback / data tiers.
 *
 * Nothing here is a token. Every class string below is a *composition* of tokens owned by
 * `src/tokens`: role names only (`surface-base`, `fg-primary`, `line-decorative`), never a
 * ramp step and never raw colour (lint L-1 / L-2), and never a physical direction
 * (lint L-7 — `start`/`end` only).
 *
 * The focus ring and the density metrics are not re-implemented here either. The ring is
 * the foundation's `hg-focus` / `hg-focus-inset` component classes, and density comes from
 * `--hg-density-*`, which the tokens layer switches off `data-hg-density` on any subtree.
 */

export type ClassValue = string | number | false | null | undefined;

/** Join truthy class values. Deliberately not `clsx` — one dependency less. */
export function cx(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ');
}

/**
 * The two-layer focus ring (foundations §2.4, a11y §4.1) lives in the foundation's
 * stylesheet as `.hg-focus`, because a box-shadow pair with two independently themed
 * colours is not expressible as Tailwind utilities. These two constants exist only so a
 * component never has to remember which variant a clipping container needs.
 */
export const FOCUS_RING = 'hg-focus';

/** For containers that clip (`overflow: hidden`) — a sticky header, a scrolling tab strip. */
export const FOCUS_RING_INSET = 'hg-focus-inset';

/**
 * `density.*` from `tokens.json`. The values are not restated: setting `data-hg-density`
 * on a subtree is what switches `--hg-density-*`, and these classes read whatever it
 * resolves to. A component that hard-coded `h-11` would silently ignore the theme.
 */
export type Density = 'comfortable' | 'compact' | 'roomy';

/** Row height for a table row / list row. Pair with `data-hg-density` on an ancestor. */
export const DENSITY_ROW_HEIGHT = 'h-[var(--hg-density-row-height)]';

/** Cell padding. Block padding is derived so a 44px minimum row survives `compact`. */
export const DENSITY_CELL_PADDING =
  'px-[var(--hg-density-card-padding)] py-[calc(var(--hg-density-card-padding)/1.5)]';

/** Heading levels, so an `EmptyState` inside a table body is not an `h1`. */
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Absolute time, always, in accessible names (a11y: "Times are absolute in the
 * accessible name ('2:41 PM') even when displayed relative").
 */
export function formatAbsoluteTime(
  iso: string | null | undefined,
  locale?: string,
  timeZone?: string,
): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(at);
}

export function formatAbsoluteDateTime(
  iso: string | null | undefined,
  locale?: string,
  timeZone?: string,
): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(at);
}

/**
 * Clock skew, measured the way `Countdown` measures it (D-14 R3): the server's clock at
 * response time minus the device's. Anything a component derives from a deadline runs
 * through this so a device that is ten minutes fast does not show a negative.
 */
export function measureSkewMs(serverNow: string | undefined, deviceNow = Date.now()): number {
  if (!serverNow) return 0;
  const server = new Date(serverNow).getTime();
  if (Number.isNaN(server)) return 0;
  return server - deviceNow;
}

/** Milliseconds remaining until `expiresAt`, skew-corrected, floored at 0. */
export function remainingMs(
  expiresAt: string | null | undefined,
  skewMs = 0,
  deviceNow = Date.now(),
): number {
  if (!expiresAt) return 0;
  const at = new Date(expiresAt).getTime();
  if (Number.isNaN(at)) return 0;
  return Math.max(0, at - (deviceNow + skewMs));
}

/** `mm:ss`, tabular, for the `DocumentViewer` TTL indicator. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Report an unknown server enum value. Rule 10 of `02-components.md` §0: unknown enum
 * values never crash, they take a documented fallback branch *and are reported*, so the
 * gap between the contract and the client is discoverable rather than silent.
 */
export function reportUnsupportedValue(component: string, field: string, value: unknown): void {
  // eslint-disable-next-line no-console -- this is the reporting channel rule 10 requires.
  console.error(
    `[hg-ui] ${component}: unsupported value for ${field}: ${String(value)}. ` +
      'Rendering the fallback branch — the client is behind the contract.',
  );
}

let idCounter = 0;
/** Stable-enough id for `aria-labelledby` wiring where React's `useId` is overkill. */
export function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}
