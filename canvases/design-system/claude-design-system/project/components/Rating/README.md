# Rating

Shows restaurant and rider ratings, or collects one with `variant="input"`.

```jsx
<Rating value={r.rating} count={r.rating_count} />
<Rating variant="stars" value={4.5} />
<Rating variant="input" value={stars} onChange={setStars} label="Rate your rider" />
```

- **One accessible name** for the whole group: "4.6 out of 5 stars, 312 reviews". Stars are never separate nodes.
- `stars` draws **partial fills** (4.5 shows four and a half), so it never rounds 4.5 up to 5.
- Null-safe: no value shows "New" ("No ratings yet").
- `input` is a real radiogroup with 44px stars. Arrow keys move and select, Home and End jump, and it announces on change.
- Stars are ink, not amber: no new colour, and no competition with the orange CTA.
