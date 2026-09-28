---
covers:
  - docs/design/tokens.json
  - packages/design-tokens/tokens/**
  - packages/ui-web/src/lint/l4-no-green-solids.ts
  - packages/ui-native/src/lint/rules/no-green-solids.cjs
reviewed: 2026-09-28
---

# Decision: old-brand green palette + amendment to invariant #10

_Sep 2026, client-confirmed. Supersedes the interim Crimson direction for the product brand._

## Decision

Adopt the **cleaned old-brand (HalalGoes) palette** — recovered from the old project's deployed
site — kept ≥90% faithful, refined for cleaner ramps and contrast:

| Role | Token | Hex |
|---|---|---|
| Brand / chrome (app bars, headers, primary surfaces) | `color.brand.forest` | `#1B3B31` |
| Brand deep (pressed / near-black chrome) | `color.brand.forest.deep` | `#0F241C` |
| Canvas | `color.surface.canvas` | `#FFFAEA` (warm cream) |
| Card | `color.surface.card` | `#FFFFFF` |
| **Action / CTA** | `color.action` | `#F1521E` (refined from old `#FD5000` — less fluorescent) |
| Ink | `color.ink` | `#232323` |
| Ink muted | `color.ink.muted` | `#6E7C77` (contrast-fixed sage) |
| Sage tint | `color.tint.sage` | `#E9F3E4` (de-neoned from `#EDFDD5`) |
| Border | `color.border` | `#E6E0D4` (warmed to the cream) |
| **Halal seal** (verified) | `color.halal.certified.seal` | `#0F7A43` (brighter, saturated — distinct from forest) |
| Halal ring | `color.halal.certified.ring` | `#C9A24B` (brass) |
| Halal expired | `color.halal.expired.seal` | `#4E5862` (cool slate — never red) |
| Danger (semantic only) | `color.danger` | `#C42B1C` (kept distinct from the orange CTA) |
| Success (tint-only) | `color.success.tint` | `#E9F3E4` text/icon only, never a solid fill |

## Amendment to invariant #10

**Original #10:** "Solid green is reserved to `color.halal.*`. Semantic success is tint-only.
Enforced by lint rule L-4."

**Amended #10 (this decision):**
1. **The deep forest `#1B3B31` / `#0F241C` is classified as a dark brand *neutral* ("pine"),
   not a green state color.** It is intentionally very dark and low-chroma so it reads as chrome
   (like a charcoal/navy would), never as a "success/verified" signal. Permitted as chrome/brand.
2. **The reserved "solid green" that signals *halal-verified* is the brighter, saturated emerald
   `color.halal.certified.seal #0F7A43`** and the `color.halal.*` namespace only. It is kept
   perceptibly brighter/more saturated than the forest chrome so "verified" still pops.
3. **Action is orange (`#F1521E`)**, so green never means "tap here."
4. **Semantic success stays tint-only** and uses neither the forest neutral nor the seal emerald.
5. **Lint L-4 updated:** allow the forest neutrals as chrome; forbid the seal emerald + any bright
   saturated solid green outside `color.halal.*`; keep danger the true red, distinct from the CTA
   orange; keep halal-expired slate, never red.

## Rationale

The client's brand is green-forward (the old identity). Honoring it while protecting the
platform's single claim (halal verification) requires separating **green-as-chrome** (a dark
neutral) from **green-as-verified-signal** (a distinct bright emerald, badge-scoped). This keeps
the *intent* of #10 — a user never mistakes a non-halal element for a halal signal — because the
verified emerald is visually distinct and confined to the halal namespace, and because action is
orange, not green. The pale sage tint and cream are neutral surfaces, not success signals.

## Consequences

- `docs/design/tokens.json` updated to this palette; `packages/ui-native` + `ui-web` token
  outputs regenerated; all four apps re-skin from the shared source in one change.
- The landing page's "fresh marketing identity" is built on this palette (warm/appetizing mood).
- The Crimson direction (and the `packages/design-tokens` crimson layer used by the reference
  home mock) is retired for the product brand; the mock served its purpose.
