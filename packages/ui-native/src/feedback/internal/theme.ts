/**
 * Token adapter for the navigation and feedback tiers.
 *
 * `src/tokens` is generated from `docs/design/tokens.json` and owned by another agent. Every read
 * of it from these two tiers goes through this file, so a shape change there is a one-file fix
 * here rather than a sweep through eleven components.
 *
 * Roles only, never numbered ramp steps (lint L-2) and never a literal hex (lint L-1). The
 * semantic tones below resolve through `theme.color.feedback.*`, which is already the
 * contrast-verified role set — this file adds a name for the shape the two tiers keep asking for
 * ({fg, glyph, tint, border, solid}) and nothing else.
 *
 * `color.map.*` is read by `MapView` only, which is the registered map-pin exception to lint L-3.
 */
import {
  elevationStyle,
  focusRing,
  icon,
  motion,
  palette,
  radius,
  space,
  target,
  typeStyle,
  useDuration,
  useTheme,
  zIndex,
} from '../../tokens';
import type { ColorScheme, ElevationLevel, Theme, ThemeName, TypeName } from '../../tokens';

export {
  elevationStyle,
  focusRing,
  icon,
  motion,
  palette,
  radius,
  space,
  target,
  useDuration,
  useTheme,
  zIndex,
};
export type { ColorScheme, ElevationLevel, Theme, ThemeName, TypeName };

/**
 * A resolved RN text style. Always read through the **theme**, never the raw scale: the field
 * register bumps `body.md`→`body.lg` and `label.md`→`label.lg` at the theme root, never per
 * component (04-accessibility.md §5). This is the reason nothing in these two tiers forks on
 * customer-versus-rider — the register arrives as tokens.
 */
export const type = typeStyle;

/* ------------------------------------------------------------------------------------ tone */

/** The severities these tiers render. There is deliberately no `success` (RULE H-1). */
export type Tone = 'neutral' | 'info' | 'warning' | 'danger';

/** Tones a status timeline may additionally resolve. */
export type StatusTone = Tone | 'success' | 'brand';

export interface ToneColors {
  /** Text on `tint`. The AAA-verified pairing, not the standalone text colour. */
  fg: string;
  /** Glyph colour on `tint`. Separate from `fg` because icons carry a lower contrast floor. */
  glyph: string;
  /** The tinted plate. */
  tint: string;
  /** The plate's border, which is what carries the tone where tint and surface sit close. */
  border: string;
  /**
   * The solid this tone may fill with. `success` deliberately has none — no filled green outside
   * `color.halal.*` (RULE H-1 / lint L-4) — so it falls back to the border, which is a rule, not
   * a fill. Nothing in these tiers fills a bar with `success`.
   */
  solid: string;
}

export function toneOf(theme: Theme, tone: StatusTone): ToneColors {
  if (tone === 'neutral') {
    return {
      fg: theme.color.text.primary,
      glyph: theme.color.text.secondary,
      tint: theme.color.surface.subtle,
      border: theme.color.border.decorative,
      solid: theme.color.border.strong,
    };
  }
  if (tone === 'brand') {
    return {
      fg: theme.color.text.primary,
      glyph: theme.color.text.onBrand,
      tint: theme.color.state.selectedTint,
      border: theme.color.border.brand,
      solid: theme.color.action.primary,
    };
  }
  const f = feedbackRole(theme, tone);
  return {
    fg: f.tintText ?? f.text,
    glyph: f.icon,
    tint: f.tint,
    border: f.border,
    solid: f.solid ?? f.border,
  };
}

interface FeedbackRole {
  tint: string;
  tintText: string | null;
  text: string;
  icon: string;
  border: string;
  solid: string | null;
  onSolid: string | null;
}

/**
 * Reads one semantic role group. Written as a switch rather than `feedback[tone]` because the four
 * groups are not structurally identical — `success.solid` is `null` by design (RULE H-1: no filled
 * green outside `color.halal.*`), and indexing the readonly union with a variable key collapses to
 * `never`.
 */
function feedbackRole(theme: Theme, tone: 'info' | 'warning' | 'danger' | 'success'): FeedbackRole {
  switch (tone) {
    case 'info':
      return theme.color.feedback.info;
    case 'warning':
      return theme.color.feedback.warning;
    case 'danger':
      return theme.color.feedback.danger;
    default:
      return theme.color.feedback.success;
  }
}

/** The readable colour to draw on top of a tone's `solid`. */
export function onSolid(theme: Theme, tone: StatusTone): string {
  if (tone === 'brand') return theme.color.text.onBrand;
  if (tone === 'neutral') return theme.color.text.onInverse;
  return feedbackRole(theme, tone).onSolid ?? theme.color.text.onInverse;
}
