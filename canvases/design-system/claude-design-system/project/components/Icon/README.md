# Icon

The only icon component: Solar glyphs in two weights, linear for inactive and bold for active, painted in `currentColor`.

```jsx
<Icon name="search" />
<Icon name="orders" weight={active ? 'bold' : 'linear'} size="lg" />
```

- **Strictly Solar** (owner decision B-13). No Lucide, no other set, no fallback. The glyph data is
  generated from `@iconify-json/solar@1.2.10` with the same resolver the repo uses
  (`packages/ui-web/scripts/generate-icons.mjs`); the 14 repo names are byte-identical to
  `packages/ui-web/src/primitives/generated/solar-icons.json`.
- **Weight carries state.** A selected tab, chip or nav item swaps to `bold`; the shape changes, not only the colour.
- **Names.** The 14 repo names: home, search, cart, orders, profile, map, bell, back, close, plus,
  check, star, clock, menu. Extension names used by these components (chevron-down, chevron-right,
  minus, lock, info, warning, error, more, refresh) are marked `extension: true` in `ICON_MAP` and
  must be added to the repo's `solar-icon-map.json` before application code uses them.
- An unknown name renders nothing and reports `ICON_NAME_UNKNOWN`. It never falls back to another glyph.
- **The halal shield is not an icon.** It is the bespoke `HalalShield`, drawn only by the halal
  components. No Solar shield or check-badge glyph is mapped, so nothing can borrow the verification mark.
- Decorative by default (`aria-hidden`); give `accessibilityLabel` only to a freestanding icon.
- Files: `assets/icons/<name>-<weight>.svg`, map `assets/icons/solar-icon-map.json`, licence `assets/icons/LICENSE` (CC BY 4.0, attribution required).
