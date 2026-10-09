# Price

Renders every amount on every surface. Takes integer cents only.

```jsx
<Price cents={order.total_cents} size="lg" />
<Price cents={item.price_cents} announceAs="now" /> <Price cents={item.was_cents} strikethrough />
<Price cents={0} free="Free delivery" />
<Price cents={entry.amount_cents} sign="always" showCode />
```

- **`cents` is required and must be an integer.** A missing value renders **nothing** and reports `MONEY_NOT_INTEGER_CENTS`. It is never `$0.00`. There is no `value`, no `formatted` and no float prop, so a caller cannot invent a price.
- `cents === 0` renders `free` when given, otherwise `$0.00`, never blank. A negative amount uses a true minus (U+2212). No rounding happens here.
- The accessible name is spoken money ("12 dollars and 34 cents"), not the glyph string. A strikethrough price is "was …", and `announceAs="now"` marks the current price beside it.
- `loading` shows a skeleton at the glyph width. Numerals are always tabular.
- Replaced: `was` → a second `<Price strikethrough>`, and `free` is now the label string, not a boolean.
