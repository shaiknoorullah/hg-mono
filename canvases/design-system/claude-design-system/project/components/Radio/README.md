# Radio

A one-of-many choice: tip amount, payment method, item variant, refund reason. Always use it inside a `RadioGroup`.

```jsx
<RadioGroup label="Size" required value={size} onValueChange={setSize} error={size ? null : 'Choose a size'}
  options={[{ value: 'r', label: 'Regular' }, { value: 'l', label: 'Large', priceDeltaCents: 250 },
            { value: 'f', label: 'Family', disabled: true, disabledReason: 'Out of stock' }]} />
```

- `RadioGroup` is a `<fieldset role="radiogroup">` named by a visible legend. The native radios share a name, so the group is **one tab stop** and the arrow keys move and select.
- The focus ring lands on the drawn control. The whole row (at least 44px) is the target. The control is 20 or 24px, and the selected state is brand, never green.
- `disabledReason`, `priceDeltaCents` (through `Price`) and a **group-level** `error` are supported. Required-group validation is announced on the group.
