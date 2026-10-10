# `@hg/ui-web/ds` and `/proposed`: what each export is today

Redesign screens import from `@hg/ui-web/ds` (approved components) and `@hg/ui-web/proposed`
(composites awaiting the owner's approval packet). Props follow the live Claude Design
`components/index.d.ts`. Each row moves from **legacy** or **adapter** to **rebuilt** as its work
package lands; the props do not change, so app code does not either.

- **legacy**: the existing component, re-exported; its shape already matches.
- **adapter**: the existing component behind a thin prop-renaming wrapper (`compat.tsx`).
- **rebuilt**: rebuilt on shadcn/ui (or LyteNyte for DataTable).
- **missing**: not exported yet. Build against the planned props in the live `index.d.ts`, and
  file a `ds-request(web): <Component>` issue if your WP needs it before the listed WP.

Work packages: `plan/design-system.md` §4.1 on the read-only `claude/redesign-canvases` branch; progress is tracked in [#661](https://github.com/shaiknoorullah/hg-mono/issues/661).

## `@hg/ui-web/ds`

| Export | Today | Rebuilt in | Known gaps until rebuilt |
|---|---|---|---|
| Icon (+ `ICON_NAMES`, `ICON_MAP`) | **rebuilt** | W1 | the 9 extension names and 25 glyphs from #198 are mapped; `move` has no Solar glyph yet |
| Button | **rebuilt** | W1 | — (adds optional `link` variant, `tone="onChrome"`, `priceCents`) |
| IconButton | **rebuilt** | W1 | — (adds optional `tone`) |
| Badge | **rebuilt** | W1 | — |
| Card | **rebuilt** | W1 | — |
| Price | **rebuilt** | W1 | — (adds optional `display-lg` size) |
| KeyValueList (approved) | **rebuilt** | W1 | — |
| StatCard (approved) | **rebuilt** | W1 | — |
| `formatTime12h` (the one 12-hour formatter) | **rebuilt** | W1 | — |
| AppBar | rebuilt | W2 | additions `leading`, `brand`, `role`, `loadingLabel`; `titleAs`/`onTitlePress` (packet P19) not yet |
| SideNav | rebuilt | W2 | count pill is drawn in place until W1's Badge lands; on-chrome tile uses on-accent until `surface-chrome-selected` (packet T7) exists. Admin names (#699) accepted as aliases |
| DetailPanel | rebuilt | W2 | additions `open`, `busy`, `returnFocusRef`, `label`, `id`, `width="panel"` (380/460px) for #675 and #699 |
| SplitPanes | rebuilt | W2 | horizontal only; additions `units="px"`, `fill`, controlled `collapsed`, `onResize` (#699) |
| Input | adapter | W3 | `otp` is the legacy 6-cell row |
| Select | adapter | W3 | `onChange` receives the value, not an event |
| Checkbox | adapter | W3 | use `onCheckedChange`; `onChange(event)` is not offered |
| RadioGroup | adapter | W3 | `options` only (no `<Radio>` children); `onChange(value)` without an event |
| Switch | adapter | W3 | `size` ignored |
| SegmentedControl | missing | W3 | — |
| Countdown | rebuilt | W4 | adds `silent`, `barOnly` / `variant="bar-only"` (packet P6) and `className` |
| Menu | rebuilt (Radix DropdownMenu) | W4 | adds `menuitemradio` (`type: 'radio'` or `checked`), and the restaurant stub's `trigger`, `triggerLabel`, `variant`, `separatorBefore` |
| Modal (+ deprecated `Dialog`) | rebuilt (Radix Dialog) | W4 | confirm and alert only on web |
| Toast | rebuilt | W4 | not Radix `Toast.Root` (it also renders inline); the hover and focus pause is kept by hand |
| StatusTimeline (+ `ORDER_STATES`, `resolveTimeline`) | rebuilt | W4 | — |
| HalalBadge, HalalShield | legacy | W5 | — |
| HalalCertificationPanel | legacy | W5 | no `headingLevel` |
| HalalChecklist (+ gate helpers) | legacy | W5 | — |
| DataTable | missing | W6 (LyteNyte) | the legacy root `DataTable` has a different shape |
| Rating | legacy | — | out of launch scope; do not extend |
| Sheet, BottomNav | not on web | — | working tasks use DetailPanel; phones only |

## `@hg/ui-web/proposed`

| Export | Today | Rebuilt in |
|---|---|---|
| EmptyState, ErrorState | rebuilt | W4 |
| Skeleton, Spinner | **rebuilt** | W1 |
| Separator | **rebuilt** (new) | W1 |
| Textarea | legacy | W3 |
| Tooltip (+ TooltipProvider) | **rebuilt** | W1 |
| ToastProvider, useToast (render the rebuilt `/ds` Toast; `placement`, `position`) | rebuilt | W4 |
| Banner + InlineAlert + HalalBanner (one family with `placement`: Banner defaults to the page bar, InlineAlert to inline; slate tone; halal props exclude danger) | rebuilt | W4 |
| ProgressBar | rebuilt (Radix Progress) | W4 |
| PageAnnouncerProvider, useAnnounce, usePageAnnouncer | rebuilt | W4 |
| DocumentViewer | legacy | W7b |
| FilterBar | legacy | W6 |
| Disclosure | rebuilt | W2 |
| SkipLink | rebuilt | W2 |
| SystemBannerSlot (= SystemBannerStack) | rebuilt | W2 |
| StickyFooter (= ActionBar) | rebuilt | W2 |
| NavDrawer | rebuilt | W2 |
| SectionNav | rebuilt | W2 |
