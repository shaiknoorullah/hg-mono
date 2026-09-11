import { SvgXml } from 'react-native-svg';
import type { ColorValue } from 'react-native';

import solarIconMap from './solar-icon-map.json';
import solarIconXml from './generated/solar-icons.json';

/**
 * `Icon` — the Solar icon primitive (design brief: Solar icon set, linear/bold weights),
 * rendered as REAL SVG via `react-native-svg`.
 *
 * This deliberately reverses the deviation noted in `CLAUDE.md` §8 ("the halal shield glyph is
 * drawn from `View` geometry rather than inline SVG ... `react-native-svg` is not a dependency").
 * That deviation stands for the bespoke halal shield (still `View`-drawn, still intentional —
 * see `certification/HalalShield.tsx`) and for the handful of structural glyphs in
 * `feedback/internal/glyphs.tsx` (close cross, chevron, tick, bang — kept as `View` geometry so
 * chrome that must never be blank has zero third-party surface). Product iconography is a
 * different problem: fourteen semantic names, resolved from Solar's actual path data, is not
 * something four `View` borders can draw. `react-native-svg` is now a real dependency for that
 * reason alone.
 *
 * Same `<Icon name weight size />` API and the same semantic `IconName` union as
 * `@hg/ui-web`'s `Icon` (`packages/ui-web/src/primitives/Icon.tsx`) — same convention too:
 * **linear = inactive, bold = active**.
 *
 * How it resolves an icon: NOT at runtime. `./generated/solar-icons.json` is a BUILD-TIME
 * artefact (`scripts/generate-icons.mjs`) — a `Record<solarIconId, svgMarkupString>` for
 * exactly the ~28 ids `solar-icon-map.json` names, already resolved through
 * `@iconify/utils`'s `getIconData` + `iconToSVG`. Doing that resolution at import time (from
 * the full ~7,700-icon `@iconify-json/solar` set, which is what an earlier version of this
 * file did) would put the whole Solar catalogue and the resolver code into the Metro bundle;
 * generating it ahead of time means this component and its runtime dependency graph are just
 * `react-native-svg` plus two small JSON files. `pnpm --filter @hg/ui-native generate:icons:check`
 * fails the gate if the generated file drifts from `solar-icon-map.json`.
 *
 * Every Solar glyph body paints with `fill="currentColor"` / `stroke="currentColor"`, and
 * `react-native-svg` resolves `currentColor` from the `color` prop on the SVG root — so this
 * component's `color` prop is the ONLY way to tint it, exactly like the web version's CSS
 * `color`. Never hardcode a fill inside the resolved markup.
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
 * `@hg/ui-web`'s copy (`packages/ui-web/src/primitives/Icon.tsx`) by construction — same keys,
 * same Solar ids.
 */
export const SOLAR_ICON_IDS = solarIconMap as Record<IconName, Record<IconWeight, string>>;

export const ICON_NAMES = Object.keys(SOLAR_ICON_IDS) as IconName[];

const ICON_XML: Record<string, string> = solarIconXml;

export interface IconProps {
  name: IconName;
  /** Pixel box. Prefer a token (`icon.sm`/`md`/`lg`/`xl`/`2xl` from `../tokens`) at the call site. */
  size?: number;
  /** `linear` (inactive) or `bold` (active). Default `linear`. */
  weight?: IconWeight;
  /**
   * Resolves the glyph's `currentColor`. Default `currentColor` itself, i.e. "inherit whatever
   * this SVG's ambient colour context is" — pass a theme colour explicitly at the call site
   * (never a literal hex, lint L-4/L-1 territory) for a predictable result.
   */
  color?: ColorValue;
  testID?: string;
}

export function Icon({ name, size = 24, weight = 'linear', color = 'currentColor', testID }: IconProps) {
  const iconId = SOLAR_ICON_IDS[name][weight];
  const xml = ICON_XML[iconId];
  if (!xml) {
    throw new Error(
      `@hg/ui-native Icon: "${iconId}" is missing from generated/solar-icons.json — run ` +
        `"pnpm --filter @hg/ui-native generate:icons".`,
    );
  }
  return (
    <SvgXml
      xml={xml}
      width={size}
      height={size}
      color={color}
      testID={testID ?? `hg-icon-${name}`}
    />
  );
}
