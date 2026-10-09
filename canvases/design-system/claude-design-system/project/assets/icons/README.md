# Icons — Solar

The product icon set is **Solar** (480 Design, CC BY 4.0 — see `LICENSE`), in two weights:
**linear = inactive, bold = active**. A tab, chip or nav item that becomes selected swaps to the
bold weight; the shape carries the state, colour is secondary.

Each file is `<name>-<weight>.svg`, where `<name>` is the semantic name the `Icon` component
takes. `solar-icon-map.json` maps each name to its Solar id. The 14 names without
`"extension": true` are exactly `packages/ui-web/src/primitives/solar-icon-map.json` in the repo;
the extension names are used by these components and must be added to the repo map before
application code uses them.

Ink: the files are drawn in `#232323` (text.primary, light) because an SVG shown through
`<img>` cannot inherit colour. In code, `Icon` paints in `currentColor`.

The halal shield is **not** an icon and is not in this folder: it is the bespoke `HalalShield`
glyph, drawn only by `HalalBadge` and `HalalCertificationPanel`. Never use a Solar shield or
check-badge glyph to suggest verification.
