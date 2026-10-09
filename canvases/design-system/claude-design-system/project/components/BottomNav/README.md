# BottomNav

Primary navigation on phones. Customers get Home, Search, Orders, Favourites and Account. Riders get Home, Earnings and Account.

```jsx
<BottomNav label="Main" active={tab} onChange={setTab} hidden={inCheckout} items={[
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'orders', label: 'Orders', icon: 'orders', badge: 2, badgeNoun: 'active' },
  { key: 'account', label: 'Account', icon: 'profile' }]} />
```

- `role="tablist"` with `role="tab"` items and `aria-selected`. It uses a roving tabindex: arrow keys (RTL-aware), Home and End move, and Enter or Space activates.
- **Active** is `brand.600`, the icon swaps to the **bold** weight, and a **2px indicator** sits above it, so the state is never colour alone. Inactive is `text.tertiary`.
- **Labels are always visible** at `label.md`, a token (no raw 10px). Each tab is at least 44px and full height.
- **Badges are in the name** ("Orders, 2 active"), not separate nodes.
- **`hidden`** removes it during the rider offer sheet and checkout, where it would be an escape hatch.
- Renamed: `value` → `active`, `item.value` → `item.key`.
