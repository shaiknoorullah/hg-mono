# The customer stack's shared-package edits, for the owning tracks

Owner answer O3 absorbs PRs #625, #634, #635, #639 and #649 into the customer redesign track (#656).
Their app logic moves to `apps/customer/src/redesign/`; their edits to files the customer track does
not own are exported here as patches (MASTER-PLAN §2.3 step 3–4). Data branch: never merge.

| Patch | From | Owner | Fold into |
|---|---|---|---|
| `625-bottomnav.patch` | #625 | DS native | N2: BottomNav full-width raised bar, links with `aria-current` |
| `634-icons-radio-price-checkbox.patch` | #634 (on #625) | DS native + web | N1 Icon map (native and web Solar ids), N3 Radio `priceCents` slot, Checkbox |
| `635-appbar-input-icons.patch` | #635 (on #625) | DS native + web | N2 AppBar cream tone/actions, N3 Input `tel` +1 prefix, N1 icons |
| `639-stepper-ordertrack-appbar-input.patch` | #639 (on #625) | DS native | N3 QuantityStepper, N5 `order-track` (12-hour), N2 AppBar, N3 Input |
| `649-ui.patch` | #649 (on #634) | DS native + web | same areas as #634 after #644's multi-variant change |
| `639-deps.patch` | #639 | DS native deps window | `pnpm-lock.yaml`, `apps/customer/package.json` |
| `639-deploy-release.patch` | #639 | orchestrator lane | `deploy/.env.example`, `RELEASING.md`, `apps/customer/.env.example` |

Each patch is `git diff <base>...<pr-head> -- <paths>`, so it holds only that PR's own change.
