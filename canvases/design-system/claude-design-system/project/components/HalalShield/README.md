# HalalShield

The verification mark. Only `HalalBadge` and `HalalCertificationPanel` draw it; do not place it yourself.

```jsx
// inside the halal components only
<span style={{ color: 'var(--color-halal-certified-on-seal)' }}><HalalShield variant="solid" knockout="var(--color-halal-certified-seal)" /></span>
```

- Four variants make up the **shape channel** of the halal state, which must survive the loss of any two of colour, shape and text: `solid` (certified), `outline` (expired), `dashed` (unverified) and `solid-clock` (the renewal note).
- The ink is `currentColor` and the knockout is a halal token. There is **no raw colour default** (the old `#FFFFFF` default is gone).
- The geometry is identical to `packages/ui-web/src/certification/HalalShield.tsx`. It is an inline SVG, never a font glyph and never an icon-set shield. It is never RTL-mirrored and never animated. It is decorative (`aria-hidden`); the owning badge carries the name.
