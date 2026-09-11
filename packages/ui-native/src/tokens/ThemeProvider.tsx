/**
 * The theme runtime.
 *
 * Two RN themes ship: `customer` (consumer register) and `rider` (field register). Each has
 * a light and a dark scheme and full parity between them — dark mode is an operational
 * requirement here, not a preference (divergence D7: riders work at night, restaurant
 * tablets sit in dim pass-throughs).
 *
 * Everything below reads from `generated/`. Nothing in this file contains a colour.
 */
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import {
  AccessibilityInfo,
  useColorScheme,
  useWindowDimensions,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useEffect, useState } from 'react';

import { themes } from './generated/themes';
import type { ColorScheme, Theme, ThemeName } from './generated/themes';
import { tokens } from './generated/tokens';

export type { ColorScheme, Theme, ThemeName };

const ThemeContext = createContext<Theme>(themes.customer.light);

export interface ThemeProviderProps {
  /** `customer` (default) or `rider`. Set once, at the app root. */
  theme?: ThemeName;
  /** Overrides the OS scheme. Omit to follow the device. */
  scheme?: ColorScheme;
  children: ReactNode;
}

export function ThemeProvider({ theme = 'customer', scheme, children }: ThemeProviderProps) {
  const osScheme = useColorScheme();
  const resolved: ColorScheme = scheme ?? (osScheme === 'dark' ? 'dark' : 'light');
  const value = useMemo(() => themes[theme][resolved] as Theme, [theme, resolved]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/* ------------------------------------------------------------- typography */

/**
 * RN has no font fallback chain — a missing family renders the system font silently — so
 * the weighted face name is derived from the token's weight and `expo-font` must have
 * registered it before the splash gate lifts (foundations §3.1).
 *
 * The UI typeface is Plus Jakarta Sans (matches web's `--hg-font-ui`, see
 * `packages/ui-web/src/styles/globals.css`). These are Google Fonts / `expo-font` face names —
 * `@expo-google-fonts/plus-jakarta-sans`'s own export names, one static weight per face, since
 * RN's `fontFamily` takes a single face name, not a variable-font weight range the way CSS does.
 * `useHgFonts()` (`./useHgFonts.ts`, subpath `@hg/ui-native/fonts`) is what actually registers
 * these four faces with `expo-font` at app boot — this map only has to agree with it on names.
 */
const UI_FAMILY_BY_WEIGHT: Readonly<Record<string, string>> = {
  '400': 'PlusJakartaSans_400Regular',
  '500': 'PlusJakartaSans_500Medium',
  '600': 'PlusJakartaSans_600SemiBold',
  '700': 'PlusJakartaSans_700Bold',
};
const MONO_FAMILY = 'JetBrainsMono_400Regular';

export type TypeName = keyof Theme['typography'];

/**
 * A typography token as an RN `TextStyle`.
 *
 * `allowFontScaling` is deliberately never set to `false` (04-a11y §5 bans it, with one
 * registered exception that lives in `Countdown`): the returned size is the 1.0× size and
 * RN applies the user's Dynamic Type multiplier on top of it.
 */
export function typeStyle(theme: Theme, name: TypeName): TextStyle {
  const t = theme.typography[name];
  const mono = name === 'mono.md' || name === 'mono.sm';
  return {
    fontFamily: mono ? MONO_FAMILY : (UI_FAMILY_BY_WEIGHT[t.fontWeight] ?? MONO_FAMILY),
    fontSize: t.fontSize,
    lineHeight: t.lineHeight,
    letterSpacing: t.letterSpacing,
    fontWeight: t.fontWeight as TextStyle['fontWeight'],
  };
}

export function useTypeStyle(name: TypeName): TextStyle {
  const theme = useTheme();
  return useMemo(() => typeStyle(theme, name), [theme, name]);
}

/** Mandatory on prices, countdowns, timelines and ratings — proportional figures jitter. */
export const tabularNumbers: TextStyle = { fontVariant: ['tabular-nums'] };

/* -------------------------------------------------------------- elevation */

export type ElevationLevel = keyof typeof tokens.elevation;

/**
 * Dual-form by design. Light schemes carry depth with a shadow; dark schemes **ignore the
 * shadow entirely** and step the surface instead, because a black shadow on a near-black
 * surface is invisible (foundations §6).
 */
export function elevationStyle(theme: Theme, level: ElevationLevel): ViewStyle {
  const e = tokens.elevation[level] as {
    rn: null | {
      shadowColor: string;
      shadowOffset: { width: number; height: number };
      shadowOpacity: number;
      shadowRadius: number;
    };
    android: number;
    surfaceStep?: string;
    darkHairline?: string;
  };
  if (theme.elevationMode === 'surface') {
    return e.surfaceStep
      ? {
          backgroundColor: e.surfaceStep,
          ...(e.darkHairline
            ? { borderWidth: 1, borderColor: e.darkHairline, borderStyle: 'solid' as const }
            : null),
        }
      : {};
  }
  if (!e.rn) return {};
  return {
    shadowColor: e.rn.shadowColor,
    shadowOffset: e.rn.shadowOffset,
    shadowOpacity: e.rn.shadowOpacity,
    shadowRadius: e.rn.shadowRadius,
    elevation: e.android,
  };
}

/* ------------------------------------------------------------- focus ring */

/**
 * The ring is two layers, because no single colour clears 3:1 against every container we
 * ship (04-a11y §4.1): 2px offset in the container's own colour, then a 3px ring in
 * `focus.ring` — flipping to `focus.onColor` on coloured containers where `info.500` falls
 * below 3:1 (brand 2.84, halal 2.33, danger 1.05, accent 2.24).
 *
 * Returned as an absolutely-positioned overlay so the ring is never clipped by the
 * control's own `overflow` and never changes the control's layout.
 */
export function focusRing(theme: Theme, opts: { onColor?: boolean; radius: number }): ViewStyle {
  const OFFSET = 2;
  const RING = 3;
  return {
    position: 'absolute',
    top: -(OFFSET + RING),
    bottom: -(OFFSET + RING),
    left: -(OFFSET + RING),
    right: -(OFFSET + RING),
    borderRadius: opts.radius + OFFSET + RING,
    borderWidth: RING,
    borderColor: opts.onColor ? theme.color.focus.onColor : theme.color.focus.ring,
  };
}

/* ------------------------------------------------------------ dynamic type */

/**
 * The Dynamic Type multiplier, for **layout** only.
 *
 * RN already scales text; what it does not do is grow the box around the text. Control
 * heights therefore multiply by this so a 44pt button at 1.0× is a 70pt button at 1.6×
 * instead of a clipped one. Structural chrome caps at 1.6 (04-a11y §5); body content is
 * uncapped, so callers that render prose pass `Infinity`.
 */
export function useFontScale(cap = 1.6): number {
  const { fontScale } = useWindowDimensions();
  return Math.min(Math.max(fontScale || 1, 1), cap);
}

/* ----------------------------------------------------------- reduced motion */

/**
 * `prefers-reduced-motion` collapses durations to 0 and replaces slide/scale with a
 * cross-fade (foundations §7.4). Countdown numerals keep updating regardless — they are
 * information, not decoration.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then((v) => {
      if (alive) setReduced(Boolean(v));
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) =>
      setReduced(Boolean(v)),
    );
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);
  return reduced;
}

/** Duration in ms, already collapsed to 0 when the user asked for less motion. */
export function useDuration(name: keyof typeof tokens.motion.duration): number {
  const reduced = useReducedMotion();
  const raw = Number.parseInt(tokens.motion.duration[name], 10);
  return reduced ? 0 : raw;
}
