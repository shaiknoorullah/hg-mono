# IconButton

An icon-only control for app bars, cards and toolbars; `accessibilityLabel` is required.

```jsx
<IconButton icon="search" accessibilityLabel="Search the menu" />
<IconButton icon="cart" accessibilityLabel="Cart" badge={3} badgeNoun="items" variant="tonal" />
<IconButton icon="plus" accessibilityLabel="Add item" variant="filled" loading={adding} />
```

- The glyph is always `aria-hidden`; the name is `accessibilityLabel`, and a badge count is part of that name ("Cart, 3 items"). The count is never a separate node.
- Variants `plain`, `filled` (brand) and `tonal` (subtle surface). Sizes `sm` 36, `md` 44 and `lg` 56. A `sm` visual keeps a 44px hit area.
- `loading` keeps the name, sets `aria-busy`, shows a spinner and ignores presses. `disabled` is `aria-disabled` and stays focusable.
- Pressed state works for keyboard and touch. Focus uses the two-layer ring, which flips on `filled`.
- Renamed: `name` → `icon`, `label` → `accessibilityLabel`, variants `ghost/raised/chrome/brand` → `plain/tonal/filled`.
