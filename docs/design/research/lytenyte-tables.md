---
covers:
  - packages/ui-web/src/**
  - apps/admin/src/**
reviewed: 2026-10-05
---

# DataTable on LyteNyte Grid, and the cell component set — spec draft

_Draft for issue #141 (design-first, #108). Status: **draft for owner review in Claude Design**; #110 builds it in `@hg/ui-web`. Research date 28 Sep 2026, against `@1771technologies/lytenyte-core@2.2.1` (the version in `pnpm-lock.yaml`)._

---

## 0. Summary

- **Use Core. Do not buy Pro.** Everything the HalalGoes tables need is in the Apache-2.0 Core edition. That covers cell renderers, pinning, client sort and filter, row grouping, master–detail, row and column virtualisation, row selection, keyboard navigation and the ARIA grid roles, row height and theming. Pro's main extra is its server data source. That source assumes offset or infinite loading, and our contract is keyset-only, so we would not use it.
- **Pro would cost** US$399 per seat per year (list price US$799, shown discounted), for teams of 1–50 developers. The README calls Pro licences "perpetual, with 12 months of updates". Without a licence Pro shows a watermark.
- **Keep the current `DataTable` contract and swap the renderer.** `@hg/ui-web` already ships a `DataTable` (`packages/ui-web/src/data/DataTable.tsx`, 691 lines). It covers PII masking, keyset pagination, all six states, `aria-sort`, a caption and single-tab-stop keyboard navigation. Admin also has a second grid, `KeysetGrid`, built on LyteNyte. The new `DataTable` keeps the existing public API (`types.ts`), uses LyteNyte for the row surface, and retires `KeysetGrid`.
- **Nine cells:** `TextCell`, `IdCell`, `MoneyCell`, `TimeCell`, `CountdownCell`, `StatusCell`, `HalalStateCell`, `MeterCell` (progress and inline bar in one), `DeltaCell`. `SparklineCell` is also specified but is **gated on contract data that does not exist yet** (see [`SparklineCell`](#510-sparklinecell-specified-gated-on-data)).

---

## 1. Evidence: what exists today

| Thing | Where | Note |
|---|---|---|
| LyteNyte dependency | `apps/admin/package.json:17` → `"@1771technologies/lytenyte-core": "^2.2.1"` | Only the admin app uses it. It resolves to 2.2.1, with `lytenyte-shared` and `lytenyte-design` at 2.2.1. |
| LyteNyte usage | `apps/admin/src/components/KeysetGrid.tsx` | Used by `OrdersAdminScreen`, `OnboardingQueueScreen` and `RiderQueueScreen`. It builds a `Grid` from `useClientDataSource` with one keyset page per data source, `rowHeight={44}`, and wires activation to `events.cell.click/keyDown`. It imports `grid.css` and our generated `@hg/ui-web/grid-theme.css` (it imported LyteNyte's `light-dark.css` until [#145](https://github.com/shaiknoorullah/hg-mono/issues/145)). |
| Hand-rolled table | `packages/ui-web/src/data/DataTable.tsx`, `types.ts`, `useGridKeyboard.ts`, `PiiCell.tsx` | Used by `RefundCasesScreen`, `StaffListScreen`, `ApplicationDetailScreen`, `RiderApplicationDetailScreen` and the gallery. |
| Spec of record | [`docs/design/02-components.md`, the `DataTable` section](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/design/02-components.md#24-datatable-admin) | Cursor pagination only. Server-side sort and filter. Content-class widths. Sticky header and first column. Row height from `density.rowHeight`. Six states. "Real `<table>` semantics… `<caption>`… `aria-sort`". |
| Licence of the installed package | `node_modules/.../lytenyte-core/package.json` → `"license": "Apache-2.0"`. `npm view @1771technologies/lytenyte-pro license` → `COMMERCIAL` | |

**Defect found while researching: `KeysetGrid` ran without its styles. Fixed in [#145](https://github.com/shaiknoorullah/hg-mono/issues/145)**: the wrapper now carries `ln-grid`, `light-dark.css` is gone, and the theme in [the theming section](#8-theming-our-tokens-on-lytenyte) replaced it. As found: Every rule in LyteNyte's `grid.css` sits under `@layer ln-grid { .ln-grid { … } }`. `KeysetGrid` wraps the grid in `<div className="adm-grid-box">` and never adds `.ln-grid` anywhere (`grep -rn "ln-grid" apps/admin/src` finds nothing). So none of these apply:
- LyteNyte's cell padding
- hover and selection
- the tabular-number rule
- the focus indicator

Meanwhile `light-dark.css` writes about 90 `--ln-*` variables onto `:root` for nothing. Its dark mode is keyed on a `.dark` class, which we never set. We use `[data-theme]` and `prefers-color-scheme`.

---

## 2. Core vs Pro

The source is the feature matrix in the Core README shipped in the package (`node_modules/@1771technologies/lytenyte-core/README.md`), which matches https://github.com/1771-Technologies/lytenyte#features.

| Need | Core? | Evidence / note |
|---|---|---|
| Custom cell renderers | Yes | "Cell Rendering" — https://www.1771technologies.com/docs/cell-renderers |
| Column pinning, resizing, reordering, visibility, automatic sizing | Yes | "Basic Column Operations" |
| Row pinning (e.g. a totals row) | Yes | |
| Sorting: single, multi, custom | Yes, client-side | `useClientDataSource({ sort })`. **Our sort is server-side** (see the [`DataTable` spec](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/design/02-components.md#24-datatable-admin)), so the grid only shows it and we re-query from a null cursor. |
| Filtering: text, number, date, quick search, set | Yes, client-side | We filter on the server, through `FilterBar` and query params. "Label" and "Having" filters are Pro, and we don't need them. |
| Row grouping and aggregations | Yes | Client-side only. The **server** grouping source is Pro. |
| Master–detail and nested grids | Yes | Useful for an order row expanding into its lines. (The older `docs/design/research/component-libraries.md` says master–detail is Pro. That is out of date at 2.2.1.) |
| Row and column virtualisation | Yes | |
| Row selection: single, multi, checkbox | Yes | Pro's prebuilt "Select All" component is not needed; we render our own `Checkbox` header. |
| Cell and range selection, clipboard | Yes | See item 6 of [conflicts and hidden costs](#9-conflicts-with-our-rules-and-hidden-costs) for the PII concern. |
| Keyboard navigation, ARIA, RTL | Yes | https://www.1771technologies.com/docs/keyboard, `/docs/accessibility`, `/docs/rtl-support` |
| Density / row height | Yes | `rowHeight: number \| "fill" \| fn` (a prop, **a number, not a CSS variable**) |
| Theming with CSS variables | Yes | `--ln-*` variables. Unstyled/headless parts are also available. |
| Excel / CSV / Parquet / Arrow export | Yes | See item 6 of [conflicts and hidden costs](#9-conflicts-with-our-rules-and-hidden-costs). Must be off for PII tables. |
| Server data source (paginated, infinite, optimistic) | No, Pro only | We don't need it. The contract is keyset (`?limit&cursor` → `meta.next_cursor/has_more`). Pro's paginated source is page-indexed. The pattern in `KeysetGrid` (one page into a client source, with `useCursorPagination` owning the cursor stack) is correct and costs nothing. "Load more" can append pages to the same client source. |
| Pivoting, tree data, expressions, menus, column manager, pill manager | No, Pro only | Not needed. Menus and popovers come from shadcn/Radix (we already use `@radix-ui/react-dropdown-menu`). |

**Licence:** Core is Apache-2.0: free, open source, and fine for commercial use. We keep the `LICENSE` and `NOTICE` obligations, and no attribution UI is needed.

**Cost if we ever needed Pro:** US$399 per seat per year (US$799 list), 1–50 developers, "Seat / Per Year" (https://www.1771technologies.com/pricing, fetched 28 Sep 2026). The README says licences are perpetual with 12 months of updates. An unlicensed Pro build shows a watermark.

**Verdict: Core, US$0.** Revisit only if a console needs pivoting or tree data. Nothing in the 198 features does.

---

## 3. How LyteNyte renders cells (API shape)

```ts
import { Grid, useClientDataSource } from '@1771technologies/lytenyte-core';

type Spec = { data: OrderSummary; column: HgColumnExt };   // GridSpec<Data, ColExt, …>
const columns: Grid.Column<Spec>[] = [{
  id: 'total',
  name: 'Total',
  type: 'number',                    // 'string'|'number'|'date'|'datetime'
  width: 120, widthMin: 96, pin: 'start' /* or 'end' */,
  field: 'total_cents',              // string | number | path | ({row}) => unknown
  cellRenderer: (p: Grid.T.CellRendererParams<Spec>) => ReactNode,
  headerRenderer: (p) => ReactNode,
}];
```

`CellRendererParams` has these fields (from `dist/index.d.ts`, around line 428):
- `row`: a `RowNode`, where `row.kind` is `'leaf'` or a group/aggregated kind
- `column`, `api`, `rowIndex`, `colIndex`
- `selected`, `indeterminate`, `detailExpanded`, `editData`, `layout`

Read the value with `api.columnField(column, row)`, or narrow with `api.rowIsLeaf(row)`. Renderers are plain React components inside our tree, so our context (theme, `Tooltip`, i18n) works. The docs give two performance rules:
- **No local state**, because virtualisation removes off-screen cells.
- **Keep renderers cheap**, because the grid can re-render thousands of cells.

Other points:
- **Column extensions.** `GridSpec`'s `ColExt` lets `DataTable` add typed column props (`contentClass`, `pii`, `sortKey`, `textValue`) without wrappers. That is exactly our `DataTableColumn` shape.
- **Headless parts.** `Grid.Viewport`, `Grid.Header`, `Grid.HeaderCell`, `Grid.RowsContainer`, `Grid.Row`, `Grid.Cell`. Each takes normal `div` props (`Omit<JSX.IntrinsicElements['div'], 'children'> & {…}`). **`DataTable` must use headless composition, not the default `<Grid>` render.** It is the only way to put `aria-sort` on the `columnheader` element and `aria-label`/`aria-describedby` on the `role="grid"` element (see [accessibility gaps](#7-accessibility-gaps-in-lytenyte-to-design-around)).
- **The element that receives events is the cell.** `KeysetGrid`'s comment already explains why: the row wrapper is a zero-height, `pointer-events: none` shim. Row activation goes on `events.cell.click` / `events.cell.keyDown`.

---

## 4. `DataTable` component spec (on LyteNyte)

### 4.1 Public API: unchanged from `packages/ui-web/src/data/types.ts`

`caption`, `captionVisible`, `columns: DataTableColumn<Row>[]`, `rows`, `getRowId`, `getRowLabel`, `sort` / `onSortChange` (server `sortKey`), `selection`, `rowActions`, `onRowActivate`, `pagination` (keyset), `loading`, `loadingMore`, `error`, `drained`, `filtered` / `onClearFilters`, `onRevealPii`, `density`.

Additions for #141:

| Prop | Type | Why |
|---|---|---|
| `columns[].cell` | `(row, ctx) => ReactNode`. Unchanged, but **by convention returns one of the cells in [the cell set](#5-the-cell-component-set)** | Keeps one accessible-text path per cell. |
| `columns[].pin` | `'start' \| 'end'` | Sticky ID column (the [`DataTable` spec](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/design/02-components.md#24-datatable-admin) asks for a "sticky first column") and a sticky actions column. |
| `columns[].contentClass` | adds `'status' \| 'halal' \| 'meter' \| 'countdown'` | Drives default width, alignment and the header's `type` for LyteNyte. |
| `expandable` | `(row) => ReactNode` | Core master–detail (order → lines). Optional. |
| `height` | `number \| 'fill'` | LyteNyte needs a sized viewport. |

**Not added, deliberately:**
- no `export`
- no `cellSelection` / `range`
- no `editable`

See item 6 of [conflicts and hidden costs](#9-conflicts-with-our-rules-and-hidden-costs) for export and cell selection.

### 4.2 Composition

```
<section aria-labelledby={captionId}>
  <h2|visually-hidden id={captionId}>{caption}</h2>          ← replaces <caption>
  <FilterBar/> (host)
  <div className="ln-grid hg-grid" data-hg-density={density}>   ← .ln-grid is REQUIRED (§1 defect)
    <Grid.Root …props>                                          (headless)
      <Grid.Viewport aria-labelledby={captionId} aria-describedby={statusId}>
        <Grid.Header> …<Grid.HeaderCell aria-sort={…}> <SortButton/> </Grid.HeaderCell>
        <Grid.RowsContainer> … <Grid.Cell/> …
      </Grid.Viewport>
    </Grid.Root>
    {state overlay rows: skeleton / empty / error, header retained}
  </div>
  <p id={statusId} aria-live="polite" className="sr-only">{sort / selection / load announcements}</p>
  <Pagination mode="load-more"|"pages" …/>
</section>
```

- **Every state is real, with the header kept** (per the [`DataTable` spec](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/design/02-components.md#24-datatable-admin)):
  - `loading` shows 5 skeleton rows in the real column geometry. Use `rowFullWidthPredicate` or overlay rows, never a centred spinner.
  - `loading-more` shows a tail skeleton row.
  - `empty`, `empty-after-filter` and `drained` render as a full-width row holding `EmptyState` (`Grid Overlays` are Core).
  - `error` shows `ErrorState` with Retry.
  - `KeysetGrid` currently **drops the header** in these states, so it does not meet the [`DataTable` spec](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/design/02-components.md#24-datatable-admin).
- **Sorting** is server-side. The header button calls `onSortChange`, the host resets the cursor, and the new page is loaded into the data source as-is. Never pass `sort` to `useClientDataSource` on a keyset table: it would sort only the visible page and suggest a global order that isn't there.
- **Selection** uses LyteNyte's `rowSelectionMode="multiple"` with `rowSelectionActivator="none"`, plus our `Checkbox` in a pinned marker column. The selected tint is `state.selectedTint` **and** a checkbox, never colour alone ([not by colour alone](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/design/04-accessibility.md#14-not-by-colour-alone)). Announce the running count through `statusId`.
- **Row actions** go in a pinned end column: `IconButton` + Radix `DropdownMenu`, labelled "Actions for {getRowLabel(row)}".
- **PII:** a `pii` column's renderer is always `PiiCell`. The masking context is unchanged, and `onRevealPii` absent means no reveal control. LyteNyte must not reach the raw field: set the column `field` to the masked server field only.

### 4.3 Density

`rowHeight` is a **number prop**, so `DataTable` maps the design token to a number:

| `density` | `rowHeight` | Source |
|---|---|---|
| `compact` | 44 | `tokens.json` `density.compact.rowHeight` = 44, also `--hg-target-min` |
| `comfortable` | 64 | `density.comfortable.rowHeight` |
| `roomy` | 72 | `density.roomy.rowHeight` |

Import these from `packages/ui-web/src/tokens/tokens.ts` (`density` export). **Never hard-code them** (`KeysetGrid` hard-codes 44). `headerHeight` equals `rowHeight` in compact, and 48 otherwise.

> **Open question for the owner.** The token file maps **`[data-hg-theme="admin"]` → comfortable (4rem/64px)** and `restaurant` → compact (44px) (`tokens.css` lines 612–622; `App.tsx:31` says "comfortable density"). The brief for this issue asks for **compact 44px in admin**, and today's `KeysetGrid` uses 44. Decide which is right. Recommendation: `DataTable` in admin defaults to `compact` (it is a dense console surface) while the rest of the admin shell stays comfortable. Record it in `docs/decisions/`.

A 44px row still meets `target.min` for the row as a hit target. Interactive controls inside a cell (checkbox, action button) need a 44×44 hit area through `HIT_AREA_STYLE` even when drawn smaller.

---

## 5. The cell component set

These rules apply to every cell:
1. **Text is the value; graphics are decoration.** Every graphic (bar, sparkline, ring) is `aria-hidden="true"`. The cell's accessible content is the visible text value. Nothing is encoded only in colour, length or shape.
2. **Tabular numerals** (`font-variant-numeric: var(--hg-numeric-tabular)`) on any number. This is **mandatory** for `DataTable` (`tokens.json` `font.numeric.tabular`).
3. **Role tokens only** ([no ramp steps in components, lint rule L-2](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/design/01-foundations.md#9-token-pipeline-and-lint-rules)). No numbered ramps, no `--ln-*` in cells.
4. **No solid green fill** ([no-green-solids lint rule (L-4)](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/design/01-foundations.md#9-token-pipeline-and-lint-rules)), except the halal seal. Positive and "good" states are tint, text, icon or border only.
5. **No red on any halal state** ([no red on a halal state, rule H-3](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/design/01-foundations.md#25-halal-certification-colours--the-reserved-namespace-)). `danger` tokens are allowed for **money and operations** (a failed payout, an overdue SLA), never for certification.
6. **No local state** (virtualisation). Time-driven cells subscribe to one shared 1 Hz ticker from context, not one `setInterval` per cell.
7. **Missing value → em dash `—`, spoken "Not available"**, except `HalalStateCell`, which renders nothing ([a missing halal state renders no badge, rule 4 of C-12](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/02-customer.md#c-12--halal-certification-display-and-verification--critical)).
8. **Each cell exports a `textValue(row)`** for type-ahead and for the row's accessible summary (`DataTableColumn.textValue`).

### 5.1 `TextCell`
- **Props:** `value: string | null`, `secondary?: string`, `lines?: 1 | 2`, `truncate?: 'end' | 'middle'`
- **When to use:** names, cities, reasons, `first_item_names`.
- **Accessibility:** a truncated value gets `title` plus a `Tooltip` with the full text. The full text is always in the DOM.
- **Tokens:**
  - `text.primary`, `text.secondary` for the secondary line
  - `text.body-sm` in compact, `body-md` otherwise

### 5.2 `IdCell`
- **Props:** `value: string` (e.g. `HG-10482`), `copy?: boolean`, `href?: string`
- **When to use:** order `code`, certificate number, payout id. It is the pinned first column in most tables.
- **Accessibility:** the copy button is labelled "Copy order HG-10482" and announces "Copied". **LyteNyte sets `user-select: none` on the viewport** (`grid.css`), so `user-select: text` must be restored on the cells, or admins cannot select an order code. The shared theme restores it on every body cell (`.ln-grid [data-ln-cell='true']`, [#145](https://github.com/shaiknoorullah/hg-mono/issues/145)).
- **Tokens:** `text.mono-md` / `font.mono`, `text.primary`, fixed width from content class `id`.

### 5.3 `MoneyCell`
- **Props:**
  - `cents: Cents` (branded, never a float)
  - `currency: 'CAD'`
  - `sign?: 'auto' | 'always'`
  - `tone?: 'default' | 'muted' | 'negative-ops'`
  - `showCode?: boolean`
- **When to use:** `total_cents`, `amount_cents`, `price_cents`, payouts, refunds.
- **Implementation:** wraps the existing `Price` at `size="sm"`. It reuses `Price`'s formatter, the U+2212 minus and the zero label, so there is no second money formatter.
- **Accessibility:** the spoken form is `Price`'s ("−$12.40" is read "minus 12 dollars 40"). Refund and ledger amounts carry `showCode` ([CAD is shown on receipts and refund records](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/02-customer.md#01-market-locale-money)).
- **Tokens:**
  - end-aligned
  - `numeric.tabular`
  - `text.primary`
  - `negative-ops` → `feedback.danger.text` (**money only**, e.g. a failed payout)

### 5.4 `TimeCell` (absolute time; relative only as a secondary)
- **Props:** `at: string` (RFC-3339), `mode?: 'absolute' | 'absolute+relative'`, `serverNow?: string`
- **When to use:** `placed_at`, `submitted_at`, `last_login_at`, `paid_at`.
- **Rule:** the [`DataTable` spec](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/design/02-components.md#24-datatable-admin) says "dates absolute + a relative tooltip". The visible text is absolute ("28 Sep, 14:05"). The relative form ("12 min ago") appears only in a tooltip or as a secondary line. **Certificate `expires_on` is always absolute and never relative** (the [`HalalBadge` spec](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/design/02-components.md#12-halalbadge-): "Never 'expires in 7 months'").
- **Accessibility:** `<time dateTime>`. The accessible name is the full absolute date and time.
- **Tokens:** `text.primary`, `text.tertiary` for the secondary line, `numeric.tabular`.

### 5.5 `CountdownCell`
- **Props:** `deadlineAt: string`, `serverNow: string`, `urgentThreshold?`, `criticalThreshold?`, `onExpire?`
- **Implementation:** wraps `Countdown` (`variant="text"`, see [`Countdown`](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/design/02-components.md#38-countdown)). There is no `seconds` prop, and skew correction is inherited.
- **When to use:** `OrderSummary.deadline_at` (admin orders), `sla_due_at` (application queues), `review_lock_expires_at`, restaurant accept deadline.
- **Accessibility:**
  - Ticking is `aria-live="off"`, with **no per-cell announcements** in a table (a queue of 50 rows would flood the reader).
  - Urgency gets a text suffix ("Overdue", "Due soon") as well as colour.
  - The shared ticker runs at 1 Hz. The critical pulse is suppressed under reduced motion.
- **Tokens:** `feedback.info.text`, then `feedback.warning.text` below 25%, then `feedback.danger.text` below 10%. Past the deadline it shows "Overdue {duration}" in `feedback.danger.text`. **Operational deadlines only, never a certificate.**

### 5.6 `StatusCell` (the status chip)
- **Props:** `kind: 'order' | 'onboarding' | 'refund' | 'payout' | 'staff' | 'menuReview'`, `value: <contract enum>`
- **When to use:** `OrderSummary.state` (14 states), `onboarding_state`, `Refund.state`, `Payout.state`, `StaffUser.status`, `MenuItemVersion.review_status`.
- **Implementation:** an outline `Chip` (`variant="static"`). **There is no filled chip** ([the green-solid monopoly, rule H-1](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/design/01-foundations.md#25-halal-certification-colours--the-reserved-namespace-)).
  - Labels come from fixed vocabularies such as `ORDER_STATE_LABELS` / `describeOrderState(state,'admin')`. Callers cannot pass a label.
  - Each state has an icon glyph, so the state never depends on colour alone.
  - An unknown enum value renders "Unknown ({raw})" in neutral and reports a client error.
- **Accessibility:** the text label is the value. The icon is `aria-hidden`.
- **Tokens:**
  - `neutral` → `border.interactive`
  - in progress → `feedback.info.*`
  - attention → `feedback.warning.*`
  - failed (`FAILED`/`REJECTED`/`CANCELLED`, payout failed) → `feedback.danger.*` **tint/border only**
  - done → `feedback.success.tint` + `tint-text` (never solid)

### 5.7 `HalalStateCell`
- **Props:** `state: HalalDisplayState | null | undefined`, `restaurantId: string`, plus `expiresOn?` for the certification queue.
- **Implementation:** renders `HalalBadge surface="operational" size="sm"`. There is no `color`, `label` or `variant` prop. **A cell may not restyle the seal.**
- **When to use:** restaurant lists, the certification queue, admin orders (restaurant column), onboarding queue.
- **Rules (inherited from `HalalBadge`):**
  - `CERTIFIED` is the **only solid green** in the table (`color.halal.certified.seal`).
  - `EXPIRING_SOON` renders identically to certified on the badge. The renewal signal is a **separate** `TimeCell` column showing the absolute `expires_on`, plus a `halal.expiring.*` text note in the certification queue only.
  - `EXPIRED` is cool slate (`halal.expired.*`), **never red**, not even in the admin queue.
  - `UNVERIFIED` is dashed (operational).
  - `null`/unknown renders **nothing** and reports an error. It is never optimistic.
- **Accessibility:** uses the badge's fixed accessible names ([fixed accessible labels](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/design/04-accessibility.md#31-fixed-accessible-labels)). The cell's `textValue` is the same fixed string, so sorting, type-ahead and the row summary agree with the badge.
- **Tokens:** `color.halal.*` only.

### 5.8 `MeterCell` (progress and inline bar, one component)
- **Props:**
  - `value: number`, `max: number`
  - `label: string` (the visible text, e.g. "5 / 7 checks", "$41.20 of $58.00")
  - `segments?: { value: number; token: VizToken; label: string }[]`
  - `scale?: 'row' | 'column'` (whether the column max comes from the page)
- **When to use:**
  - **Progress:** `HalalCertificate.checks` (verified checks out of 7) in the certification queue, and `submission_count` / `attempt_number` against a limit.
  - **Stacked inline bar:** `RefundLiabilitySplit` (platform / restaurant / rider), which sums to `amount_cents`. Show it as three `viz.*` segments with the legend in the tooltip and the text in the cell.
  - **Magnitude bar:** `item_count`, `entry_count` compared with the rest of the column.
- **Accessibility:**
  - The bar is `aria-hidden`. The cell text (`label`) is the value.
  - **Do not** use `role="progressbar"` inside a `gridcell`: it adds a nested widget the grid pattern does not expect, and screen readers read it twice.
  - The segment breakdown lives in `Tooltip` **and** in the row's expanded detail, so keyboard and screen-reader users get the numbers.
- **Tokens:**
  - Track: `surface.sunken`.
  - Fill: `viz.1`/`viz.2`/`viz.6` for categorical series. `viz.8` (#B42318, red) is **never used on a halal-related meter**.
  - Checklist progress: fill `feedback.info.icon`. **Not green**, not even at 7/7: a complete checklist is not certification. The seal is the only green claim, and the certification decision is a human's.
  - Bar height 6px, radius `radius.full`. The minimum 3:1 contrast against the track (04-a11y "Charts: 3:1 against adjacent") is checked in the generator.

### 5.9 `DeltaCell` (counter with change)
- **Props:**
  - `value: number | Cents`
  - `previous: number | Cents | null`
  - `format: 'count' | 'money' | 'percent'`
  - `goodDirection: 'up' | 'down' | 'none'`
- **When to use:** restaurant or admin summary tables that have a comparison period, such as orders this week vs last, or payout vs previous payout. **Only when the contract supplies `previous`.** The client never derives it by fetching another page.
- **Rendering:** the main value, then a small delta: an arrow glyph, a sign and the magnitude ("▲ 12%", "▼ $4.10").
- **Accessibility:** the spoken form is "{value}, up 12 percent from {previous}". The arrow is `aria-hidden`, and the direction is in the words.
- **Tokens:**
  - The delta is text only.
  - Good: `feedback.success.text` (text, not fill, so the [no-green-solids lint rule (L-4)](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/design/01-foundations.md#9-token-pipeline-and-lint-rules) is satisfied).
  - Bad: `feedback.warning.text` for operations, and `feedback.danger.text` only for money losses.
  - `goodDirection:'none'` uses `text.secondary`.
  - **Never used on any halal metric.**

### 5.10 `SparklineCell`: specified, gated on data
- **Props:** `points: readonly number[]` (at most 30), `label: string` (the summary text, e.g. "7-day orders: 42, peak 11 Thu"), `token?: VizToken`, `showLast?: boolean`
- **Implementation:** **pure inline SVG with no library**: one `<polyline>` in a 64×20 viewBox, plus an optional last-point dot. It is about 40 lines and re-renders only when `points` changes. A chart library (Recharts, visx, etc.) would pay 30–100 KB for a 20px line, and it would bring its own tooltip and focus model into a `gridcell`.
- **When to use:** only where the contract returns a series. Today that is **`EarningsSummary.buckets`**, for restaurant or rider payouts. `OrderSummary`, `RestaurantApplicationSummary`, `RiderApplicationSummary`, `Payout`, `StaffUser` and `MenuItem` carry **no time series** (`contracts/openapi.yaml`: a search for `series|trend|previous_period` finds nothing usable). A sparkline anywhere else needs the contract widened first ([the contract is authoritative](https://github.com/shaiknoorullah/hg-mono/blob/main/AGENTS.md#6-how-to-work-here)).
- **Accessibility:** the SVG is `aria-hidden`. `label` is visible, or else it is the accessible text in the cell and in the tooltip. **A sparkline is never the only carrier of the value.**
- **Tokens:** stroke `viz.1` (or `text.secondary`), 1.5px. The last dot has the same colour. No area fill, and no green or red trend colouring.

### 5.11 Existing cells kept as they are
- `PiiCell`: masked by default, reveal is audited ([PII masking and access justification, A-42](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#a-42--global-entity-search-pii-masking-and-access-justification)).
- Actions: `IconButton` + Radix menu (see [composition](#42-composition)).
- `Checkbox` for selection.

---

## 6. When to use each cell, per table

| Table | Pinned start | Columns → cell | Rich cells used | Not used, and why |
|---|---|---|---|---|
| **Admin orders grid** (`OrderSummary`) | `IdCell` code | restaurant `TextCell` + `HalalStateCell` · state `StatusCell` · items `TextCell`(`first_item_names`) + count · `MoneyCell` total · `TimeCell` placed_at · `CountdownCell` deadline_at (non-terminal only, else `—`) · customer `PiiCell` | Countdown, Status, Halal | No sparkline (no series) · no meter (item_count needs no bar) |
| **Restaurant application queue** (`RestaurantApplicationSummary`) | `TextCell` display_name | city/province · `StatusCell` onboarding_state · `MeterCell` submission_count (attempts) · assignee `TextCell` · `CountdownCell` sla_due_at · `CountdownCell` review_lock_expires_at (only while locked) · `TimeCell` submitted_at | Countdown, Status | No halal badge until certified (UNVERIFIED would be noise here) |
| **Rider application queue** (`RiderApplicationSummary`) | name | vehicle_type `TextCell` · `StatusCell` · attempt_number `TextCell` "2 of 3" · `CountdownCell` sla_due_at · `TimeCell` | Countdown, Status | — |
| **Certification queue** (`HalalCertificate`) | `IdCell` certificate_number | restaurant · issuing_body · `HalalStateCell` · `MeterCell` checks "5 / 7 checks" (info fill) · `TimeCell` expires_on (**absolute only**) · `StatusCell` status · verified_by/at | Halal, Meter | **No countdown to expiry** (relative expiry is banned) · no red anywhere · no green meter |
| **Refunds** (`Refund`, `RefundApprovalRequest`) | `IdCell` order code | kind/scope/reason `TextCell` · `MoneyCell` amount (`showCode`) · `MeterCell` liability split (3 segments) · `StatusCell` state · `TimeCell` requested/settled · required_role | Meter (stacked), Money, Status | — |
| **Staff** (`StaffUser`) | full_name | email `PiiCell` (if classed PII) · role `StatusCell kind=staff` · status `StatusCell` · MFA `StatusCell` ("MFA on"/"MFA off", icon + text) · `TimeCell` last_login_at (absolute+relative) | Status | No bars or deltas |
| **Restaurant order history** (`OrderSummary`, restaurant scope) | `IdCell` code | state `StatusCell` · items · `MoneyCell` restaurant payout · `TimeCell` placed_at | Status, Money | No countdown (history is terminal) · no halal badge (it's their own kitchen) |
| **Menu items** (`MenuItem`, `MenuItemVersion`) | name | `MoneyCell` price_cents · availability `StatusCell` · review_status `StatusCell` · dietary/allergen tags `Chip` (veg/nonveg glyphs) · prep_minutes `TextCell` · out_of_stock_until `TimeCell` | Status, Money | No halal badge per item (certification is per restaurant; per-item halal claims are not in the contract) |
| **Payouts** (`Payout`, `EarningsSummary`) | period `TimeCell` range | `MoneyCell` amount · `StatusCell` state (+ hold_reason secondary) · entry_count · `TimeCell` paid_at · failure_message `TextCell` · **`SparklineCell` from `EarningsSummary.buckets`** in the summary header row · `DeltaCell` only if a previous period is added to the contract | Money, Status, Sparkline (gated) | — |

Selection rules:
- At most **two graphic cells per row** (meter, sparkline, countdown ring). More than that turns a queue into a dashboard and slows scanning.
- A graphic cell is only allowed where the comparison is the task (e.g. the liability split, checklist progress). Otherwise use text.
- Native apps keep list rows. LyteNyte is web-only (issue #141).

---

## 7. Accessibility: gaps in LyteNyte to design around

Evidence comes from `lytenyte-core/dist` and `lytenyte-shared/dist` at 2.2.1. A grep of every `aria-*` string emitted finds only these: `aria-colcount`, `aria-colindex`, `aria-rowcount`, `aria-rowindex`, `aria-selected`, `aria-expanded`, `aria-multiselectable`, and one `aria-label` (on the resize handle).

| Gap | Evidence | Mitigation in `DataTable` |
|---|---|---|
| **No `aria-sort`** | not emitted anywhere | Headless `Grid.HeaderCell aria-sort={…}` on the sortable column. The header content is a real `<button>` "Sort by Total, descending". Announce the new order through the polite status region. |
| **No accessible name on `role="grid"`** | the viewport renders `role:"grid"` with no label | `Grid.Viewport aria-labelledby={captionId}`. The [`DataTable` spec](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/design/02-components.md#24-datatable-admin)'s `<caption>` becomes a heading plus `aria-labelledby`, because the grid is div-based, not a `<table>`. **Amend that spec's "real `<table>` semantics" in `docs/decisions/`.** |
| **`aria-rowcount` is the loaded count** | `"aria-rowcount": api.rowView().rowCount` is written after spread props, so it can't be overridden | With keyset paging there is no total. Accept it (it's accurate for the loaded rows), and say "Showing 50 orders, more available" in the status region. Report upstream as a request for an override. |
| **Tab model** | the viewport is `tabIndex=0`. `navigator.js`: on Tab it sets `viewport.inert=true` for one tick, so **Tab leaves the grid**. Cells render `tabIndex=0`, not roving `-1`. | This matches the [`DataTable` spec](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/design/02-components.md#24-datatable-admin) ("arrows within, Tab out"). The first Tab lands on the viewport and ArrowDown enters the cells. The `KeysetGrid` comment "a cell is natively in the tab order… Tab + Enter reaches any row" was **wrong**, and is corrected ([#145](https://github.com/shaiknoorullah/hg-mono/issues/145)). Add the "Skip to table" link (04-a11y line 195) targeting the viewport. |
| **Interactive content inside cells** | docs: "left/right arrows cycle through tabbable elements within a cell before advancing" | Keep **at most one** interactive control per cell (a copy button, a reveal button, an actions menu). Enter on a cell activates the row. The actions menu opens on Enter or Space when focused. |
| **Focus indicator is 1px `--ln-primary-50` (blue)** | `grid.css`: `[data-ln-cell]:focus::before { border: 1px solid var(--ln-primary-50) }` | Override (see [focus](#83-focus-per-docsdecisionsfocus-indicatormd)) to our inset two-layer ring in `--hg-focus-ring-color`. 1px blue fails our focus decision and is below the 2px WCAG 2.4.13 guidance. |
| **Colour-only encoding** | n/a (it's our cells) | [Cell rule 1](#5-the-cell-component-set): every bar or sparkline has visible text. Status has icon + text. Selection has a checkbox + tint. Countdown urgency has a text suffix. |
| **Live updates** | Core offers "cell diff flashing" | **Don't use flashing** for halal columns (the seal never animates). For money and status, only under `prefers-reduced-motion: no-preference`, and with no announcement. Re-sorting from live WS updates must not move the focused row: freeze the order while focus is in the grid and show "New orders available". |
| **Screen-reader testing** | docs claim JAWS and VoiceOver | Add NVDA + Firefox and VoiceOver + Safari passes to #110's done criteria. Grid virtualisation keeps DOM order, which is claimed but needs verifying with our pinned columns. |
| **User select disabled** | `user-select:none` on the viewport | Re-enable for text cells (see [`IdCell`](#52-idcell)). |
| **RTL** | Core supports `rtl` | Pass `rtl` from the document direction (the Arabic font token exists). Pinned start and end columns flip. |

---

## 8. Theming: our tokens on LyteNyte

### 8.1 Loading
- **Import only `@1771technologies/lytenyte-core/grid.css`** (the structural rules, layered as `@layer ln-grid`).
- **Do not import** `light-dark.css`, `design.css` or `fonts.css`:
  - they set about 90 `--ln-*` variables on `:root`
  - they load Inter
  - their dark mode is keyed to `.dark`
- Add the `ln-grid` class on the wrapper (the [unstyled-grid defect](#1-evidence-what-exists-today)).
- Our mapping is `packages/ui-web/src/tokens/grid-theme.css`, exported as `@hg/ui-web/grid-theme.css` and **generated by the token generator** next to `tokens.css` (built in [#145](https://github.com/shaiknoorullah/hg-mono/issues/145)). The generator refuses any `--hg-*` name `tokens.css` does not declare, so a renamed token fails generation instead of silently leaving the grid without styles. Dark mode follows our `[data-theme]` / `prefers-color-scheme` rules automatically, because it only references role variables.
- The theme sits **outside any cascade layer**, so it beats `@layer ln-grid` whichever order the two files load in. It also draws the frame on `.ln-grid` (border, `radius.md`, clip, as `DataTable` does) and drops the viewport's own square border.
- `apps/admin/smoke/grid-styles.test.tsx` pins the wiring: the `ln-grid` wrapper, only `grid.css` from LyteNyte and always with our theme, every variable `grid.css` reads given a role, and none of them a solid green.

### 8.2 Variable map (the variables `grid.css` actually reads)

| `--ln-*` (read by grid.css) | ← HalalGoes role token |
|---|---|
| `--ln-typeface` | `var(--hg-font-ui)` |
| `--ln-font-md` | `var(--hg-text-body-sm-size)` (compact) / `--hg-text-body-md-size` |
| `--ln-row-height` | set by LyteNyte from the `rowHeight` prop (see [density](#43-density)) |
| `--ln-padding-horizontal-cell` | `var(--hg-density-card-padding)` |
| `--ln-bg-ui-panel` | `var(--hg-surface-base)` (cells). The header is overridden to `var(--hg-surface-subtle)` with label type, matching `DataTable`'s body and header. (This draft said `surface-raised`; `surface-base` is what `DataTable` uses, so the two admin tables match.) |
| `--ln-bg-row-alternate` | `var(--hg-surface-base)`. **No banding**: use rules, not zebra (cream on white banding reads as selection) |
| `--ln-bg-row-hover` | `var(--hg-state-hover-overlay)` |
| `--ln-primary-50` | selected-row tint base → **override** the selected `::before` to `var(--hg-state-selected-tint)` instead of LyteNyte's `color-mix(primary 30%)`. The resize handle's hover goes to `var(--hg-border-interactive)` |
| `--ln-text-dark`, `--ln-text` | `var(--hg-text-primary)`, `var(--hg-text-secondary)` |
| `--ln-border`, `--ln-border-row` | `var(--hg-border-decorative)` |
| `--ln-border-strong` | `var(--hg-border-interactive)` (pinned-column edges) |
| `--ln-border-xstrong` | `var(--hg-border-strong)` (pinned-row edges) |

Do **not** map LyteNyte's `--ln-green-*` / `--ln-red-*` / `--ln-yellow-*`. Nothing in Core's `grid.css` reads them. They exist for Pro components, and the `light-dark.css` values include a solid green (`hsla(158,61%,48%)`) that the [no-green-solids lint rule (L-4)](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/design/01-foundations.md#9-token-pipeline-and-lint-rules) would flag if it were ever used as a fill. Leaving them unset keeps them out of the product.

### 8.3 Focus (per `docs/decisions/focus-indicator.md`)
A cell is a **borderless control**, so it takes decision point 3: the two-layer ring in the theme's focus colour, **inset** so it isn't clipped by the neighbouring cell or the viewport's overflow:

```css
.ln-grid [data-ln-cell="true"]:focus-visible::before,
.ln-grid [data-ln-header-cell="true"]:focus-visible::before {
  border: 0;
  box-shadow: inset 0 0 0 2px var(--hg-focus-ring-offset), inset 0 0 0 5px var(--hg-focus-ring-color);
  outline: 2px solid transparent; /* forced-colors */
}
```

This is the same recipe as `.hg-focus-inset` in `globals.css`. Where a cell sits on the selected tint, apply `focusRingOn()`'s flip set. The viewport itself (first Tab stop) gets the outer two-layer ring round the `.ln-grid` frame, because the cells would cover an inset one. Use `:focus-visible` (the library uses `:focus`), so a mouse click doesn't draw the ring; LyteNyte's own 1px `:focus` ring is removed. As built in [#145](https://github.com/shaiknoorullah/hg-mono/issues/145).

### 8.4 Halal colour rules inside the grid
- The **only** solid green pixel in any table is `HalalBadge`'s seal. The [no-green-solids lint rule (L-4)](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/design/01-foundations.md#9-token-pipeline-and-lint-rules) must scan `grid-theme.css` and every cell file. A registered test asserts no `--ln-*` variable resolves into the green hue band.
- Selected rows use `state.selectedTint` (brand-50 peach), not a green or a blue.
- No halal state uses `danger.*` or `viz.8`. Expired uses `halal.expired.*` slate. This covers the certification queue's "overdue review" too: that is an **operational** SLA, so it is shown on the `CountdownCell`, not recoloured onto the halal badge.

---

## 9. Conflicts with our rules, and hidden costs

1. **The [`DataTable` spec](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/design/02-components.md#24-datatable-admin) says "real `<table>` semantics"; LyteNyte is ARIA-grid on `div` elements.** It is compliant with the ARIA grid pattern, but it is a spec change. Record a decision amending that spec and the accessibility standard (caption → `aria-labelledby`, `<th scope>` → `columnheader`).
2. **Two tables exist today.** `KeysetGrid` (LyteNyte, styled since [#145](https://github.com/shaiknoorullah/hg-mono/issues/145), but header lost on empty or error, no PII column support, no `aria-sort`) and `DataTable` (hand-rolled, spec-complete). The cost of #110 is porting `DataTable`'s behaviour onto LyteNyte **without regressing** its PII guarantees, states and a11y, and then deleting `KeysetGrid` and `useGridKeyboard.ts`. Budget it as a rewrite of the row surface, not a re-skin.
3. **Allow-list (#108/#112).** `DataTable` and its cells are compositions of LyteNyte + shadcn/Radix + the existing allow-listed `HalalBadge`, `Price` and `Countdown`. `SparklineCell` and `MeterCell` are custom SVG/CSS, so they must be named explicitly on the allow-list as part of this issue.
4. **Density conflict.** The admin theme token is comfortable at 64px, but the brief and today's code use 44px (see [density](#43-density)). The owner needs to decide.
5. **The contract has no data for sparklines or deltas**, except `EarningsSummary.buckets`. Any other trend cell means widening `contracts/openapi.yaml` first, then fixtures (all states), then regenerating. Don't design sparklines into the orders or queue tables until then.
6. **Export and clipboard are in Core.** Excel/CSV export and range copy would take **masked** values, but a revealed PII value in a `PiiCell` is on screen for 60 s and would be copied by a range copy. `DataTable` sets `cellSelectionMode="none"` and exposes no export. Any future export is a server endpoint with audit, not a client grid feature.
7. **Client sort and filter on a keyset page are wrong** (see [composition](#42-composition)). Never pass `sort`/`filter` to `useClientDataSource` for a server list. A lint or unit test on `DataTable` should assert this.
8. **The `rowHeight` number is duplicated outside CSS.** Read it from the generated `tokens.ts`, never as a literal.
9. **LyteNyte ships AI Skills** (`npx skills add 1771-Technologies/lytenyte`). Useful for #110, but install them per repo and pin the version to 2.2.x so generated code matches the installed API.
10. **Upgrade risk.** LyteNyte went v2.0 → v2.2 in a few months, with many `-dev` pre-releases. Pin `~2.2.1` (not `^`) in `@hg/ui-web`, and move the dependency from `apps/admin` to `@hg/ui-web` so the restaurant web app shares it.
11. **Bundle size.** Around 40 KB compressed with `gzip` (README). Fine for admin and restaurant web. Don't load it on customer or marketing surfaces.
12. **Performance rules for cells:**
    - no per-cell timers (use the shared ticker)
    - no per-cell `Tooltip` portals mounted eagerly (mount on focus or hover)
    - no chart library.

---

## 10. Done when (for #110)
- [ ] `DataTable` on LyteNyte Core with the same public API. `KeysetGrid` is deleted and admin screens are migrated.
- [x] `.ln-grid` + `grid-theme.css` are generated from tokens. `light-dark.css` is no longer imported. Dark mode follows `[data-theme]`. (Done in [#145](https://github.com/shaiknoorullah/hg-mono/issues/145) for `KeysetGrid`; `DataTable` reuses the same two stylesheets.)
- [x] Focus is the inset two-layer ring in `--hg-focus-ring-color` on `:focus-visible`. (Done in [#145](https://github.com/shaiknoorullah/hg-mono/issues/145), in the shared theme.)
- [ ] The 9 cells above live in a new `cells/` folder in `packages/ui-web/src/data/`, each with a `textValue`, a gallery story and fixtures for every state (including null, unknown enum, all 14 order states and all 4 halal states).
- [ ] `aria-sort`, a labelled grid, a polite status region, a "Skip to table" link, and `user-select` restored on ID and text cells.
- [ ] The [no-green-solids lint rule (L-4)](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/design/01-foundations.md#9-token-pipeline-and-lint-rules) scans the grid theme and cells. A test asserts no red token is reachable from `HalalStateCell` or the certification queue.
- [ ] Decisions recorded: the table-semantics amendment to the [`DataTable` spec](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/design/02-components.md#24-datatable-admin), admin grid density, and the allow-list additions (`MeterCell`, `SparklineCell`).
