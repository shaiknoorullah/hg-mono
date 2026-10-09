# Checkbox

For multi-select and consent: add-ons, marketing consent, admin bulk selection.

```jsx
<Checkbox label="Extra garlic sauce" priceDeltaCents={150} checked={on} onCheckedChange={setOn} />
<Checkbox label="Select all 24 restaurants" indeterminate />
<Checkbox label="Add falafel" disabled disabledReason="Out of stock" />
```

- A real `<input type="checkbox">` carries the semantics. The drawn box is its next sibling, so the **two-layer focus ring lands on the control**, never on an invisible element. Hover and pressed overlay the control. The whole row (at least 44px) is the target.
- `indeterminate` sets the DOM property, so assistive tech announces "mixed".
- Checked is the brand fill with an `onBrand` tick, never green. The control is 20 or 24px.
- `disabledReason`, `error` (linked and announced) and `priceDeltaCents` (through `Price`) are supported.
