# AppBar

The top bar: cream for customers, forest chrome for restaurants and admin, the field tone for riders.

```jsx
<AppBar title="Zaytoun Grill" subtitle="Scarborough, ON" backLabel="Back to Home" onBack={back}
  actions={<IconButton icon="cart" accessibilityLabel="Cart" badge={2} badgeNoun="items" />} />
<AppBar tone="chrome" title="Order queue" loading={refreshing} elevated />
```

- **Variants** from the spec: `default`, `large`, `search`, `contextual` (selection mode) and `transparent` (over a hero, with a scrim). `tone` is only the theme surface, and every colour is a role token (no `rgba`).
- `role="banner"`. **On web the title is the page's `<h1>`** (`titleIsPageHeading`).
- **Back** is a 44px `IconButton` named **"Back to {previous}"** (`backLabel`), not a bare "Back".
- `loading` shows an indeterminate 2px progress bar. `elevated` adds elevation 1 and a hairline. The bar is never scroll-hidden on rider or restaurant surfaces.
- Renamed: `back` + `onBack` → `onBack` + `backLabel`, `right` → `actions`, `left` removed.
