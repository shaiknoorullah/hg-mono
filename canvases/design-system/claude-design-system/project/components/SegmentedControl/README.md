# SegmentedControl

Two or three exclusive options that filter or switch a view mode in place, such as "Order food | List your restaurant" or "Delivery | Pickup".

```jsx
<SegmentedControl label="Fulfilment" value={mode} onChange={setMode}
  options={[{ value: 'delivery', label: 'Delivery' }, { value: 'pickup', label: 'Pickup' }]} />
```

- It is a **radiogroup**, not tabs: `role="radiogroup"` named by `label`, with `role="radio"` segments. It is **one tab stop** (roving tabindex). Arrow keys move and select (RTL-aware), and Home and End jump.
- **If the choice reveals different panels, use Tabs (`variant="pill"`) instead**, because tabs need tabpanels and the full tabs pattern.
- Spec mapping: this is 02-components.md §5 `Select variant="inline"`. The spec needs its own entry under this name.
- Every segment is at least 44px; `sm` keeps a 36px visual with an expanded hit area. Both tones use role tokens only, with no raw `rgba`.
