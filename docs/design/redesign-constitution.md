# The redesign constitution

One shared ground truth for the redesign of all four apps. Four designers working
in parallel produce four products unless they answer to the same document; this
is that document.

**What this governs:** `apps/customer`, `apps/rider`, `apps/restaurant`,
`apps/admin` — roughly 38 screens.

**What is being redesigned:** composition, hierarchy, flow and density. Not the
brand, not the palette, not the component library.

---

## 1. Frozen. Do not change these.

| Thing | Where | Why it is frozen |
|---|---|---|
| Design tokens | `docs/design/tokens.json` | Four surfaces share them. A local tweak is a fork. |
| RN components | `@hg/ui-native` | 41 components, both themes, already accessibility-reviewed. |
| Web components | `@hg/ui-web` | Same. |
| Halal colour family | `color.halal.*` | It encodes a religious claim. See §3. |

A redesign that needs a new token or a new primitive is a redesign that has
misread the system. Say so and stop, rather than adding one.

## 2. The three invariants that are not design opinions

These exist because violating them makes a religious claim the platform has no
standing to make. They outrank taste, consistency and every visual argument.

- **8 — A missing halal field renders NO badge.** Never an optimistic one.
  Silence is never consent on a halal claim.
- **9 — NEVER red for a halal state.** Red reads as *haram*. Expired is cool
  slate: "we cannot currently vouch", not "this food is forbidden".
- **10 — Solid green is reserved to `color.halal.*`.** Semantic success is
  tint-only. Enforced by lint rule L-4.

## 3. The four halal states, exactly

The only four. There is no fifth, and no in-between.

| State | Fill | Text | Accent | Reads as |
|---|---|---|---|---|
| **Certified** | `#0F7A43` seal | `#FFFFFF` on seal | `#C9A24B` brass ring | We checked, it passed |
| **Expiring** | `#FBF1D8` tint | `#7A5600` | `#D9BE7A` border | Renew before it lapses |
| **Expired** | `#EDEFF1` tint / `#4E5862` seal | `#39424B` | `#B9C0C7` border | **Our knowledge lapsed** — not a verdict |
| **Unverified** | transparent | `#6E6658` | `#B6AEA1` dashed | We have not checked |

Dark-scheme counterparts exist for every one of these in `tokens.json`. Use them;
do not dim the light values.

## 4. Registers — per app, already wired

The system carries a density register per surface. Both RN apps set theirs
correctly today (`apps/customer/App.tsx:251`, `apps/rider/App.tsx:214`), so this
is a constraint to design *into*, not a bug to fix.

| Register | rowHeight | cardPadding | gutter | Apps |
|---|---|---|---|---|
| `comfortable` | 64 | 16 | 16 | customer |
| `roomy` | 72 | 20 | 20 | **rider** |
| `compact` | 44 | 12 | 12 | admin |

Touch targets, from `target.*`:

| Token | px | Use |
|---|---|---|
| `min` | 44 | Absolute floor. Nothing interactive is smaller, on any surface. |
| `field` | 56 | Rider surfaces. |
| `criticalField` | 72 | **Irreversible actions under time pressure.** |

`compact` is a density, not a licence to go below 44 or to drop contrast.

## 5. Known defect: dark mode is switched off

Both mobile apps hard-code `scheme="light"` (`customer/App.tsx:251`,
`rider/App.tsx:214`) while a complete dark palette exists in the tokens. For a
rider working a winter evening in Ontario this is the difference between a
usable screen and a flashbang. Treat restoring it as in scope for the rider app;
raise it for the customer app rather than assuming.

## 6. The operating context — how "user-oriented" is judged

A redesign is judged against the situation of use, not against a dribbble shot.

- **Customer.** One hand, phone, hungry, deciding. Probably comparing. Needs to
  know *what this is* and *whether we vouched for it* before anything else.
- **Rider.** Outdoors, Ontario weather, gloves, night, two-second glances, paid
  per delivery, under a countdown. Every second of friction is their money.
  Nothing irreversible within accidental reach.
- **Restaurant.** Tablet propped in a hot loud kitchen, mid-service, high staff
  turnover. The 180s acceptance deadline is running and missing it voids the
  order. Must be learnable without training.
- **Admin.** A consequential, irreversible decision about someone else's
  religious observance. Seven checks, two of them server-computed and
  un-overridable. Approving by accident must be impossible.

## 7. The gate — every screen, before it ships

1. Empty, loading and error states all exist. Happy-path-only does not merge.
2. Nothing interactive below 44px.
3. Body text ≥4.5:1; ≥7:1 on rider surfaces.
4. The primary action is identifiable in one glance.
5. No solid green outside `color.halal.*` (lint L-4 will catch it; do not make it work for its money).
6. No halal state rendered red, under any circumstance.
7. Both schemes render — or the surface is documented as light-only with a reason.
8. Every factual claim on screen traces to `claims.ts` or a domain spec.

## 8. Process

1. **Audit** — `docs/design/audit/<app>.md`, one per app. What exists, what is wrong, why it costs the user.
2. **Brief** — the intended structure per screen, in terms of existing components.
3. **Artboards** — reviewable, commentable, before any code.
4. **Code** — only what has been approved.

No step skipped. The artboard stage is what makes disagreement cheap.
