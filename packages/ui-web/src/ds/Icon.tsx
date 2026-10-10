/**
 * `Icon` — the only icon component (live `components/index.d.ts`, `Icon/README.md`).
 *
 * Strictly Solar (owner decision B-13): every glyph resolves through `solar-icon-map.json`, the
 * same hand-authored map the legacy primitive and `generate-icons.mjs` read, and is drawn from
 * the generated offline subset. No Lucide, no fallback glyph: an unknown name renders nothing
 * and reports `ICON_NAME_UNKNOWN`.
 *
 * Weight carries state: `linear` inactive, `bold` active. Glyphs paint in `currentColor`.
 * Decorative (`aria-hidden`) unless `accessibilityLabel` is given for a freestanding icon.
 *
 * The halal shield is not an icon. No Solar shield or check-badge glyph is mapped, so nothing can
 * borrow the verification mark.
 */

import { addCollection, Icon as IconifyIcon } from '@iconify/react/offline';
import type { CSSProperties } from 'react';

import solarIconMap from '../primitives/solar-icon-map.json';
import solarIconSubset from '../primitives/generated/solar-icons.json';
import { reportDsClientError } from './client-error.js';

/** The 14 names shared with the repo map since launch. */
export type IconName =
  | 'home'
  | 'search'
  | 'cart'
  | 'orders'
  | 'profile'
  | 'map'
  | 'bell'
  | 'back'
  | 'close'
  | 'plus'
  | 'check'
  | 'star'
  | 'clock'
  | 'menu';

/** The live design system's extension names, now in the repo map too. */
export type IconExtensionName =
  | 'chevron-down'
  | 'chevron-right'
  | 'minus'
  | 'lock'
  | 'info'
  | 'warning'
  | 'error'
  | 'more'
  | 'refresh';

/**
 * Glyphs the approved canvases draw that the live design system has not published yet (#198).
 * Mapped to Solar so screens stop drawing stand-ins; each still needs adding in Claude Design.
 */
export type IconCanvasName =
  | 'wallet'
  | 'settings'
  | 'undo'
  | 'document'
  | 'document-list'
  | 'user-block'
  | 'external-link'
  | 'hourglass'
  | 'hand-money'
  | 'card'
  | 'phone'
  | 'receipt'
  | 'download'
  | 'stars'
  | 'gift'
  | 'copy'
  | 'case'
  | 'letter'
  | 'camera'
  | 'shop'
  | 'bicycling'
  | 'buildings'
  | 'wallet-money'
  | 'server'
  | 'logout';

/** linear (inactive, default) or bold (active: selected tab, chip, nav item). */
export type IconWeight = 'linear' | 'bold';

/** Every name the design-system Icon accepts. */
export type DsIconName = IconName | IconExtensionName | IconCanvasName;

/** One entry of `ICON_MAP`: Solar ids per weight; `extension` marks names outside the core 14. */
export interface IconMapEntry {
  linear: string;
  bold: string;
  extension?: true;
}

const CORE: ReadonlySet<string> = new Set<IconName>([
  'home', 'search', 'cart', 'orders', 'profile', 'map', 'bell',
  'back', 'close', 'plus', 'check', 'star', 'clock', 'menu',
]);

const RAW = solarIconMap as Record<string, { linear: string; bold: string }>;

/** Not a component: name → Solar ids; `extension: true` marks names outside the core 14. */
export const ICON_MAP: Readonly<Record<DsIconName, IconMapEntry>> = Object.fromEntries(
  Object.entries(RAW).map(([name, ids]) => [
    name,
    CORE.has(name) ? { ...ids } : { ...ids, extension: true as const },
  ]),
) as Record<DsIconName, IconMapEntry>;

/** Not a component: every name Icon accepts. */
export const ICON_NAMES: readonly DsIconName[] = Object.keys(ICON_MAP) as DsIconName[];

// Registers the generated subset once. Every render after that is a local lookup: the offline
// build has no network path.
addCollection(solarIconSubset);

const ICON_SIZE = { sm: 16, md: 20, lg: 24, xl: 32, '2xl': 48 } as const;

/** Props of the live `Icon` (index.d.ts). */
export interface IconProps {
  name: DsIconName;
  /** linear (inactive, default) or bold (active). */
  weight?: IconWeight;
  /** sm 16 · md 20 · lg 24 · xl 32 · 2xl 48, a px number, or any CSS length. */
  size?: keyof typeof ICON_SIZE | number | string;
  /** Only for a freestanding meaningful icon; omitted = aria-hidden. */
  accessibilityLabel?: string;
  /** Any CSS colour — use a role token. Glyphs paint in currentColor. */
  color?: string;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
  /** Extra classes (layout only; colour comes from the container or `color`). */
  className?: string;
}

/** The pixel or CSS length an `Icon` `size` resolves to. */
export function iconSize(size: IconProps['size']): number | string {
  if (size === undefined) return ICON_SIZE.lg;
  if (typeof size === 'number') return size;
  return size in ICON_SIZE ? ICON_SIZE[size as keyof typeof ICON_SIZE] : size;
}

function known(name: unknown): name is DsIconName {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(ICON_MAP, name);
}

/** A Solar glyph. Unknown names render nothing and report ICON_NAME_UNKNOWN. */
export function Icon({
  name,
  weight = 'linear',
  size = 'lg',
  accessibilityLabel,
  color,
  testId = 'Icon',
  style,
  className,
}: IconProps) {
  if (!known(name)) {
    reportDsClientError('ICON_NAME_UNKNOWN', { received: name });
    return null;
  }
  const box = iconSize(size);
  const solarWeight: IconWeight = weight === 'bold' ? 'bold' : 'linear';
  return (
    <IconifyIcon
      icon={`solar:${ICON_MAP[name][solarWeight]}`}
      width={box}
      height={box}
      data-testid={testId}
      data-hg-icon={name}
      data-hg-icon-weight={solarWeight}
      className={className}
      style={{ display: 'inline-block', flexShrink: 0, color, ...style }}
      // The offline Icon keeps its own aria-hidden default unless this is an explicit boolean.
      aria-hidden={!accessibilityLabel}
      aria-label={accessibilityLabel}
      role={accessibilityLabel ? 'img' : undefined}
    />
  );
}
