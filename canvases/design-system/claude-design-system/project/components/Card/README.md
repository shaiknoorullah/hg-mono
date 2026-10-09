# Card

The default surface: a white plate raised above the cream canvas.

```jsx
<Card variant="outlined">…</Card>
<Card onPress={open} accessibilityLabel="Zaytoun Grill, halal certified, 25 to 35 minutes">…</Card>
```

- Variants `elevated` (elevation 1), `outlined` (1px `border.decorative`), `filled` (`surface.subtle`) and `interactive`.
- **Interactive cards are reachable by keyboard**: they are one tab stop with one accessible name (a link with `href`, otherwise `role="button"` activated by Enter or Space). They show the two-layer focus ring, hover (elevation +1, pointer devices only) and pressed (scale 0.99).
- Nested links or buttons inside a pressable card are forbidden. If a card needs two actions it is not pressable, and the actions are explicit buttons.
