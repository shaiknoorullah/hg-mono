import type { CSSProperties } from 'react';
import { Icon as IconifyIcon, addCollection } from '@iconify/react/offline';

import solarIconMap from './solar-icon-map.json';
import solarIconSubset from './generated/solar-icons.json';

/**
 * `Icon` — the Solar icon primitive (design brief: Solar icon set, linear/bold weights).
 *
 * Convention (shared with `@hg/ui-native`'s `Icon`, same semantic names): **linear = inactive,
 * bold = active**. A tab, a chip or a nav item swaps weight on selection rather than changing
 * colour alone — the shape itself carries the state, colour is secondary (consistent with the
 * rest of this library's "never colour alone" rule).
 *
 * Every glyph resolves through `solar:<id>-linear` / `solar:<id>-bold` from `@iconify-json/solar`
 * — no other icon source. The curated `IconName` union below is deliberately small: it is the
 * cross-platform contract between the web and native primitive, not the full Solar catalogue.
 * Reach for `lucide-react` directly (as the rest of this package already does) for one-off
 * glyphs that do not need a native counterpart.
 *
 * **Two build-time facts worth knowing before touching this file:**
 *
 *  1. **`@iconify/react/offline`, not the default `@iconify/react` export.** The default
 *     export's `Icon` falls back to a live fetch against the public Iconify API for any icon id
 *     it has not already cached — a hidden runtime network dependency this system's whole
 *     "flush Redis and it still works, just slower" posture (`CLAUDE.md` §2) has no room for.
 *     `offline` has no fetch path at all: `addCollection()` below registers this component's
 *     icons once, at module load, and every `<Icon>` render after that is a pure local lookup.
 *  2. **`./generated/solar-icons.json`, not `@iconify-json/solar/icons.json` directly.** The
 *     full Solar set is ~7,700 icons; a naive static import of the whole package JSON inlines
 *     all of it into the client bundle regardless of the ~28 this component actually uses
 *     (measured: it took the gallery's production bundle from ~715 KB to ~11 MB). The generated
 *     file is the curated subset only, produced by `scripts/generate-icons.mjs` from
 *     `solar-icon-map.json` (the semantic-name -> Solar-id source of truth) — see that script's
 *     header for the full explanation. `pnpm --filter @hg/ui-web generate:icons:check` fails
 *     the gate if it drifts from `solar-icon-map.json`.
 *
 * Colour: every Solar glyph body is `currentColor`, so this component paints in the CSS `color`
 * of its container — set it with a text-colour utility/token, never a literal hex (lint L-1).
 *
 * Decorative by default (`aria-hidden`), matching every other icon in this library: the visible
 * label or the control's own `accessibilityLabel` carries the name. Pass `accessibilityLabel`
 * only for the rare freestanding icon that has no such label.
 */

export type IconWeight = 'linear' | 'bold';

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

/**
 * The semantic name -> Solar icon id map, read from `solar-icon-map.json` — the single
 * hand-authored source of truth `scripts/generate-icons.mjs` also reads. Kept in lockstep with
 * `@hg/ui-native`'s copy (`packages/ui-native/src/primitives/Icon.tsx`) by construction — same
 * keys, same Solar ids, minus the `solar:` collection prefix the native side doesn't need.
 */
export const SOLAR_ICON_IDS = solarIconMap as Record<IconName, Record<IconWeight, string>>;

export const ICON_NAMES = Object.keys(SOLAR_ICON_IDS) as IconName[];

addCollection(solarIconSubset);

export interface IconProps {
  name: IconName;
  /** Pixel box. Prefer a token (`icon.sm`/`md`/`lg`/`xl`/`2xl` from `../tokens`) at the call site. */
  size?: number;
  /** `linear` (inactive) or `bold` (active). Default `linear`. */
  weight?: IconWeight;
  className?: string;
  style?: CSSProperties;
  /**
   * Gives the icon its own accessible name. Omit for the common case — a decorative icon next
   * to a visible label, or inside a control that already has `aria-label`.
   */
  accessibilityLabel?: string;
}

export function Icon({
  name,
  size = 24,
  weight = 'linear',
  className,
  style,
  accessibilityLabel,
}: IconProps) {
  const iconId = `solar:${SOLAR_ICON_IDS[name][weight]}`;
  return (
    <IconifyIcon
      icon={iconId}
      width={size}
      height={size}
      className={className}
      style={style}
      // `@iconify/react`'s offline `Icon` ships its own `aria-hidden="true"` default and only
      // clears it when this prop is an explicit `false` (its internal switch checks
      // `value !== true && value !== 'true'` against whatever was PASSED — an `undefined` prop
      // never reaches that branch, so the library default survives). A boolean, always, never
      // `undefined`, is what actually toggles it.
      aria-hidden={!accessibilityLabel}
      aria-label={accessibilityLabel}
      role={accessibilityLabel ? 'img' : undefined}
      data-hg-icon={name}
      data-hg-icon-weight={weight}
    />
  );
}
