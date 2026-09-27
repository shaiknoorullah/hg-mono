# The design surface

"Every shipped feature and all its UI states" is the acceptance criterion for
this redesign. It is unverifiable without a list. This is the list.

Extracted from `contracts/openapi.yaml` — 267 schemas, 85 enums, 152 operations —
not from memory.

---

## 1. The distinction that keeps this finite

There are two kinds of enum, and conflating them explodes the work for nothing.

**State families** — each member gets a visibly different treatment, so each must
be designed and reviewed. `OrderState` has 14 members and a customer must be able
to tell `PREPARING` from `READY_FOR_PICKUP` at a glance. All 14 get designed.

**Bounded vocabularies** — members are *data inside* a designed component. The 25
`RefundReasonCode` values are strings in one picker. Design the picker once,
verify the longest string does not break it, and move on. Designing 25 artboards
for 25 strings is theatre.

Every enum below is marked **S** (state family, design each) or **V**
(vocabulary, design the container).

## 2. State families, by owner

| Enum | N | Kind | Surfaces it must render on |
|---|---|---|---|
| `OrderState` | 14 | **S** | customer Tracking + Orders, restaurant Orders, admin OrderDetail |
| `AssignmentState` | 12 | **S** | rider Assignment |
| `RestaurantOnboardingState` | 11 | **S** | restaurant Onboarding, admin queue |
| `DispatchState` | 10 | **S** | rider Offer, admin OrderDetail |
| `RiderOnboardingState` | 10 | **S** | rider Onboarding, admin RiderQueue |
| `RefundState` | 10 | **S** | admin RefundCases, customer Orders |
| `PaymentState` | 8 | **S** | customer Checkout |
| `HalalCheckKey` | 7 | **S** | admin HalalVerification — ×3 `HalalCheckResult` |
| `HalalCertificateStatus` | 6 | **S** | admin, restaurant |
| `KycDocumentState` | 6 | **S** | rider + restaurant documents |
| `RestaurantAvailabilityState` | 5 | **S** | customer Restaurant, restaurant Settings |
| `HalalIssuingBodyStatus` | 5 | **S** | admin registry |
| **`HalalDisplayState`** | **4** | **S** | **customer Discovery + Restaurant — the product's claim** |
| `RiderAvailabilityState` | 4 | **S** | rider Availability |
| `MenuItemAvailabilityState` | 4 | **S** | customer menu, restaurant Menu |
| `HalalCertificateScope` | 4 | **S** | admin verification |
| `DispatchOfferOutcome` | 4 | **S** | rider Offer |
| `RefundReasonCode` | 25 | V | one picker + one list row |
| `DocumentRejectionReasonCode` | 12 | V | one rejection composer |
| `HalalRejectionReasonCode` | 9 | V | one rejection composer |
| `RestaurantRejectApplicationReasonCode` | 9 | V | one rejection composer |
| `RefundKind` / `RefundScope` / `PaymentIntentKind` | 3–4 | V | form controls |

## 3. Per screen, always

Independent of the above, **every** one of the ~38 screens ships four states.
This is repo policy, not a preference — happy-path-only does not merge.

1. **Loading** — and a skeleton is not automatically right; sometimes the honest
   answer is a spinner with a sentence.
2. **Empty** — first-run empty and filtered-to-nothing empty are different
   problems with different copy and different exits.
3. **Error** — recoverable vs terminal, and always a way out.
4. **Populated** — the happy path.

## 4. The four halal states are not negotiable

`HalalDisplayState` is the one enum where a design error is a product failure
rather than a rough edge. Its four members carry the platform's entire claim.

| Member | Treatment | Never |
|---|---|---|
| `CERTIFIED` | seal `#0F7A43` + brass ring `#C9A24B` | — |
| `EXPIRING_SOON` | amber tint, renewal prompt | alarm |
| `EXPIRED` | cool slate `#4E5862` | **red** |
| `UNVERIFIED` | transparent fill, dashed `#B6AEA1` | any badge at all if the field is missing |

See `redesign-constitution.md` §2–3. Invariants 8, 9 and 10 outrank any visual
argument made against them.

## 5. Honest scale

- **38 screens** × 4 baseline states = **152** baseline renderings
- **~120** additional state-family renderings across the S rows above
- **~8** bounded-vocabulary containers

Call it **~280 distinct renderings**, not 38 screens. Anyone quoting this as "a
four-app redesign" is off by an order of magnitude, and that mismatch is how
redesigns get abandoned at 60%.

This is why the pipeline has gates: research before design, two critique passes
before review, review before code. Each gate is cheaper than the rework it
prevents.
