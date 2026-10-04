# Component library evaluation

_For the four HalalGoes apps: two Expo (customer, rider) + two web consoles (admin,
restaurant). Decision anchor: contract-first, we own our code (generated files are not
hand-edited — owned components fit that ethos), one token system across all four, both
themes. Aug 2026._

## Recommendation

| Surface | Library | Why |
|---|---|---|
| **Web** (admin, restaurant) | **shadcn/ui** + **TanStack Table** | Radix primitives + Tailwind, copy-in ownership, themable by CSS vars → our DTCG tokens map directly. TanStack Table is the headless data-table engine (likely "the repo shared earlier"). |
| **Native** (customer, rider — Expo) | **React Native Reusables (RNR)** + **NativeWind** | The shadcn-for-RN standard: same component names/philosophy, NativeWind (Tailwind for RN) + headless primitives. Same mental model and token layer as web shadcn → true web↔native parity. |

Net: **one Tailwind/NativeWind token layer** (crimson palette + Hugeicons + Plus Jakarta
Sans) feeds all four apps; every component is owned code, not an opaque dependency.

## React Native — the contenders

- **React Native Reusables (RNR)** — ✅ pick. shadcn-shaped, copy-into-repo on NativeWind + headless primitives; ownership model (no npm lock-in); growing blocks (auth, onboarding). Most momentum, closest parity with web shadcn.
- **NativeCN** — close second. Same shadcn-to-RN port idea, code ownership, no npm lock-in. RNR is further along on blocks and community.
- **gluestack-ui** — universal (shared web+native code), copy-paste, fast start, strong perf. The win (one shared codebase) doesn't apply here — we already run separate Vite web + Expo native apps behind a generated API client.
- **Tamagui** — compiler-based, best runtime perf, typed style API, universal. Powerful but steeper setup and its own styling model (less direct mapping to our DTCG/Tailwind tokens). Overkill unless perf-critical.

## Web — the contenders

- **shadcn/ui** — ✅ pick. The default for owned, accessible, Tailwind-themed components; CSS-var theming maps 1:1 to our tokens.
- Park UI (Ark), Radix Themes — viable, similar philosophy; smaller ecosystems.
- MUI / Mantine — batteries-included but opinionated and heavier to re-skin to the brand.

## Data tables — DECIDED: LyteNyte Grid

**[LyteNyte Grid](https://github.com/1771-Technologies/lytenyte)** by 1771 Technologies — a
high-performance React data grid — for the dense web consoles (admin A-15 halal queue, refunds,
restaurant/rider management, order oversight). Native tables aren't needed on the Expo apps
(those use lists/cards).

- **Packages:** `@1771technologies/lytenyte-core` (Apache-2.0, free) · `@1771technologies/lytenyte-pro` (commercial — adds pivoting, tree views, master-detail, 150+ features).
- **Styling:** headless _or_ pre-styled with Tailwind / CSS Modules / CSS-in-JS → composes with shadcn and consumes our crimson DTCG tokens directly.
- **Fit:** virtualization (millions of rows, ~40 KB gz), server-side data + infinite scroll, sorting/filtering/pagination, column pinning/resize/reorder, row selection, cell editing.
- **Plan:** start on **Core (free)**; revisit **Pro** only if a console needs grouping/pivot/master-detail. Ships **AI Skills for Claude Code** — use them so grid code is statically verified.

## Icons — DECIDED: Solar

**Solar** — linear (inactive) / bold (active), free, huge set, rounded & friendly. Chosen over
Hugeicons because Hugeicons' solid-rounded is a paid Pro tier (free set is stroke-only), and
Solar ships both stroke and solid for free with the look we want. Active/selected states use a
**soft crimson tint**, not a solid fill (per client: solid fills are "too much on the eyes").
