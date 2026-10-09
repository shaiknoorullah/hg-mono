---
covers:
  - packages/ui-web/src/styles/globals.css
  - packages/ui-web/src/primitives/Input.tsx
  - packages/ui-web/src/primitives/Select.tsx
  - packages/ui-web/src/primitives/Textarea.tsx
  - packages/ui-native/src/primitives/Input.tsx
  - packages/ui-native/src/primitives/Select.tsx
reviewed: 2026-10-05
---

# Decision: one focus indicator, in the theme's colour

_Sep 2026, owner-confirmed after reviewing a live prototype in the restaurant app. Amends `docs/design/04-accessibility.md` §4.1 and `02-components.md` rule 3 and §3 `Input`._

## What was wrong

A focused text field drew **two** indicators at once:

1. its border thickening to 2px `border.brand` (`focus-within:border-2 focus-within:border-line-brand`), and
2. the two-layer ring — a 2px cream gap, then a 3px `info.500` blue ring — around the whole field.

This was specified, not accidental: `02-components.md` §3 gave `Input` focus as *"2px `border.brand` + focus ring"*, while rule 3 said *"the focus ring is two layers"*. Native `Input` did the same. The result read as a doubled, detached outline, and its blue belonged to no theme.

## Decision

1. **Focus colour follows the theme.** `theme.*.focus.ring` = `border.brand` — `color.brand.600` (`#D8410F`) light, `color.brand.400` (`#F3703F`) dark. It clears 3:1 against every field surface: 4.30:1 on `control.bg`, 3.91:1 on `surface.sunken`; 5.9–6.2:1 in dark mode.
2. **Bordered fields** (`Input`, `Textarea`, `Select`): focus **is the field's own border**, 2px in the focus colour. No ring. No glow.
3. **Borderless controls** (buttons, links, cards, chips): keep the two-layer ring, now in the focus colour, flipping to `focus.onColor` where it measures < 3:1. The generator recomputes the flip set from the new colour (light: brand, accent, danger, warning, info, halal; dark: brand, danger, warning, info, halal).
4. **Invalid + focused field**: the 2px danger border stays — it means "error" and cannot also mean "focused" — and the two-layer ring marks focus. The one case with two indicators, each carrying a different meaning.

## Rejected

- **A soft coloured glow** around the focused field (prototyped). The system has no coloured shadows: shadows are neutral and express elevation only (`01-foundations.md` §6), and dark mode drops shadows entirely. A glow would be an invented effect that disappears in dark mode.
- **Keeping `info.500` blue.** Accessible, but not theme-driven, and it read as a browser default rather than part of the product.

## Implementation notes

- Web: `.hg-focus-field` (`packages/ui-web/src/styles/globals.css`) goes on the element that owns the border. It is **unlayered** because it recolours the border and Tailwind's border-colour utilities in the utilities layer would otherwise win. The second pixel is an inset shadow, so focus never shifts layout. A transparent outline remains for forced-colors mode, which strips shadows.
- Native: `Input` and `Select` draw the 2px `border.brand` border on focus and render `focusRing()` only when the field is invalid.
