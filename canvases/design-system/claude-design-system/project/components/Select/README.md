# Select

A choice from a closed list. `native` wraps a real `<select>` so mobile gets the platform picker. `listbox` handles long, searchable lists.

```jsx
<Select label="Province" value={prov} onValueChange={setProv} options={provinces} required />
<Select label="Certifying body" variant="listbox" searchable value={body} onValueChange={setBody}
  options={registry.map((b) => ({ value: b.id, label: b.name, description: b.region }))} />
```

- **`native`** (default) is the accessible path. **`listbox`** follows the combobox pattern: `role="combobox"` with `aria-expanded` and `aria-controls`, `role="listbox"` and `role="option"` with `aria-selected`. ArrowUp and ArrowDown move, Home and End jump, typing does type-ahead, Enter selects, and Escape closes and returns focus. `searchable` adds a filter field. Native apps render this as a Sheet (the spec's `sheet` variant).
- Options take `description` and `disabled`. `loading` shows skeleton rows, never an empty list. `emptyText` covers the no-options case.
- Field chrome and focus are the same as `Input`: the field's own 2px brand border, a linked `errorText` with `role="alert"`, and `required` passed through.
- Never use a Select for a binary (use `Switch` or `Radio`). Use `SegmentedControl` for three or fewer short options.
