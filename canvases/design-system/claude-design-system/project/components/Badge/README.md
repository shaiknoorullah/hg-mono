# Badge

A small, non-interactive status marker for promos, order states and admin flags. It is not the halal badge.

```jsx
<Badge variant="brand" appearance="solid">0% commission</Badge>
<Badge variant="warning" icon="clock">Closing soon</Badge>
<Badge variant="danger" appearance="dot">Payment failed</Badge>
<Badge variant="outline" size="sm">Pickup</Badge>
```

- Variants `neutral`, `info`, `warning`, `danger`, `brand` and `outline`. There is **no success tone and no green** (RULE H-1). Use the halal components for a halal claim, and use text for a success.
- Appearances `tint` (default), `solid` and `dot`. Sizes 18, 22 and 26. `max` caps counts ("99+").
- Read in reading order as text. A danger badge carries a word and is never colour alone. A count on an `IconButton` belongs in that button's name, not in a Badge.
