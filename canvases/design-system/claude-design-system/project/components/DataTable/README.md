# DataTable

Admin lists: restaurants, orders, the certification queue, payouts, audit events.

```jsx
<DataTable caption="Live orders" columns={cols} rows={page.items}
  sort={sort} onSortChange={setSort} selection={sel} onSelectionChange={setSel}
  rowActions={(r) => [{ key: 'refund', label: 'Issue refund' }]} rowLabel={(r) => `order ${r.id}`}
  onRowActivate={open} hasMore={page.meta.has_more} onLoadMore={next} />
```

- **Real table semantics.** It has a required `<caption>`, `<th scope="col">` headers and `aria-sort` on sortable headers. Sorting announces the new order.
- **Keyboard.** Rows are one roving tab stop. ArrowUp and ArrowDown move, Home and End jump, Enter activates the row, Space toggles selection, and Tab leaves the table. Cell-level grid navigation is specified (§24) and arrives with the shadcn/TanStack rebuild (#109).
- **Selection** is a checkbox per row plus `state.selectedTint`, never colour alone. The running count is announced.
- **Row actions** are a `Menu` button per row with a unique name ("Actions for order HG-10482").
- **Cursor pagination only** (`hasMore` plus `onLoadMore`): no page numbers and no total.
- **States, header always kept.** `loading` shows 5 skeleton rows in the real geometry. `loadingMore` adds a tail skeleton. Empty says why and what next. Empty-after-filter uses distinct copy plus "Clear filters". `error` shows Retry.
- Ids use the mono family through `var(--font-mono)` (IBM Plex Mono). Money is end-aligned, tabular, through `Price`.
