# Component library evaluation

_For the four Halal Goes apps: two Expo (customer, rider) + two web consoles (admin,
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

## Data tables

**Use the table repo the client specified** (not TanStack Table) for the dense admin queues
(A-15 halal, refunds, restaurant/rider management). _Pending: the client to re-share the repo
link — it was referenced but never captured._ Whatever it is, it slots under shadcn's table
shell on web; the column model + theming map to our tokens the same way.

## Icons — DECIDED: Solar

**Solar** — linear (inactive) / bold (active), free, huge set, rounded & friendly. Chosen over
Hugeicons because Hugeicons' solid-rounded is a paid Pro tier (free set is stroke-only), and
Solar ships both stroke and solid for free with the look we want. Active/selected states use a
**soft crimson tint**, not a solid fill (per client: solid fills are "too much on the eyes").
