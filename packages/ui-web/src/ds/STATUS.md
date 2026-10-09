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
| Icon | adapter | W1 | the 9 extension names (`chevron-down`, `info`, `more` …) render nothing and report `ICON_NAME_UNKNOWN` |
| Button | adapter | W1 | `critical` is xl with a 72px minimum height; `href` mode as legacy |
| IconButton | adapter | W1 | — |
| Badge | missing | W1 | — |
| Card | legacy | W1 | no `href` |
| Price | legacy | W1 | no `onDark`, `testId`, `style` |
| AppBar | adapter (over `TopBar`) | W2 | `tone`, `large`, `transparent`, `sticky` are accepted and ignored |
| SideNav | legacy (approved) | W2 | — |
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
| Banner + InlineAlert + HalalBanner (one family with `placement`; slate tone; halal props exclude danger) | rebuilt | W4 |
| EmptyState, ErrorState | rebuilt | W4 |
| Skeleton, Spinner | legacy | W1 |
| Textarea | legacy | W3 |
| Tooltip | legacy | W1 |
| ToastProvider, useToast (render the rebuilt `/ds` Toast; `placement`, `position`) | rebuilt | W4 |
| ProgressBar | rebuilt (Radix Progress) | W4 |
| PageAnnouncerProvider, useAnnounce, usePageAnnouncer | rebuilt | W4 |
| DocumentViewer | legacy | W7b |
| FilterBar | legacy | W6 |
