---
covers: []
reviewed: 2026-10-04
---

# The design surface

"Every shipped feature and all its UI states" is the acceptance criterion for the redesign. It is
unverifiable without a list; this is the list. The rules every screen follows are in the
[redesign constitution](redesign-constitution.md).

---

## 1. Where the screens are

The screens are Claude Design canvases built on
[the HalalGoes design system](https://claude.ai/artifact/1GwGVZz8Ju9wcz4HfCnzbv). The owner
approved them on 1 October 2026
([sign-off](https://github.com/shaiknoorullah/hg-mono/issues/85#issuecomment-5976668489)), and the
changes from the owner's round-2 answers are in
[the round-2 changes summary](https://claude.ai/artifact/7sonXGkNxgmg2PXsKTgaa7). A canvas that
grew past Claude Design's file limit was split along its sections, so each app's redesign issue
keeps the current list.

| App | Canvases | Current list |
|---|---|---|
| Customer (phone) | [Discover & Order](https://claude.ai/artifact/F2MfULPYoJQkkLsA5G3aFk) · [Cart & Checkout](https://claude.ai/artifact/GWcvkXwQ7sxHgt6YV7Q9eq) · [Track & After](https://claude.ai/artifact/Haff8hBnnp7dTfC4svtevA) · [Sign-in](https://claude.ai/artifact/HdmzQ4h2D22cMZvJ17a8cX) · [Account](https://claude.ai/artifact/MYT5tBoEHpPuRegpMusYHV) | [#80](https://github.com/shaiknoorullah/hg-mono/issues/80#issuecomment-5923387325) |
| Rider (phone) | [Sign-in & Onboarding](https://claude.ai/artifact/Und8nB7Jz3Zvap4YWdvFXX) · [Payouts & Account](https://claude.ai/artifact/EnL31eVhT89tqLCKDdbM4Z) · [Shift & offers](https://claude.ai/artifact/JJsWRMctEXTssZsT4qnEGN) · [Delivery](https://claude.ai/artifact/Kw4bXJ1tMABt9kXFyD46VB) · [Earnings](https://claude.ai/artifact/Bmjz5bZDtEbhypv1sTTx2D) · [Delivery history & What's new](https://claude.ai/artifact/BZ4vZmESKMfTPQVWPrGWcb) | [#81](https://github.com/shaiknoorullah/hg-mono/issues/81#issuecomment-5923387558) |
| Restaurant (desktop, landscape tablet) | [Sign-in](https://claude.ai/artifact/9AZ5YnbTdrfyFK1mUwYtCw) · [Onboarding application](https://claude.ai/artifact/91cZ3XgVs6RtiJncKjaSaT) · [Live Orders](https://claude.ai/artifact/3SMSe4oeDv36Ji9sNZjoja) · [Menu & Hours](https://claude.ai/artifact/EPxdhT9UsfzARZVWgv6da7) · [Payouts](https://claude.ai/artifact/Djdm2j2nZaE3ULnyVudcjw) · [Settings](https://claude.ai/artifact/VkGvVQsxmCHp8CGnCLVKga) | [#82](https://github.com/shaiknoorullah/hg-mono/issues/82#issuecomment-5923387783) |
| Admin (desktop) | [Restaurant Verification](https://claude.ai/artifact/6QRa35DR4iwCGdftXEASRp) · [Rider Onboarding](https://claude.ai/artifact/QWWsWuHQd6auhtrSVJiQbk) · [Orders](https://claude.ai/artifact/LUWY7aLqsxxkWWnkGRJos8) · [Refunds](https://claude.ai/artifact/NDbFfhcv4MwRgwjmFtpxrx) · [Staff](https://claude.ai/artifact/Y7wjQPGX2UAtS238ZDVhU1) · [Alerts, Sessions & System](https://claude.ai/artifact/11QnFovXMrnVMHgAh4bBFC) | [#83](https://github.com/shaiknoorullah/hg-mono/issues/83#issuecomment-5923388010) |

Some screens are hidden at launch, so release 1.0 does not build them even where a canvas draws
them: the restaurant Staff screen and liability insurance upload
([restaurant](../decisions/README.md#restaurant)), the customer alerts bell
([customer app](../decisions/README.md#customer-app)), and "My sessions" and the restaurant
"Account security" screen ([launch scope](../decisions/README.md#launch-scope-and-contract)). Seal
screens come out of all four apps ([halal and trust](../decisions/README.md#halal-and-trust)).

## 2. The distinction that keeps this finite

There are two kinds of enum, and conflating them multiplies the work for nothing.

**State families:** each member gets a visibly different treatment, so each must be designed and
reviewed. `OrderState` has 14 members, and a customer must be able to tell `PREPARING` from
`READY_FOR_PICKUP` at a glance. All 14 get designed.

**Bounded vocabularies:** the members are data inside a designed component. The 25
`RefundReasonCode` values are strings in one picker. Design the picker once, check that the
longest string does not break it, and move on. Designing 25 artboards for 25 strings is theatre.

Every enum below is marked **S** (state family, design each member) or **V** (vocabulary,
design the container).

## 3. State families, by owner

Extracted from [`contracts/openapi.yaml`](../../contracts/openapi.yaml) on 4 October 2026: 267
schemas, 85 enums, 152 operations. The round-2 contract work changes some of these (launch
operations, [#182](https://github.com/shaiknoorullah/hg-mono/issues/182); rider and restaurant
rules such as the pickup code replacing the seal scan,
[#183](https://github.com/shaiknoorullah/hg-mono/issues/183); customer and admin rules,
[#184](https://github.com/shaiknoorullah/hg-mono/issues/184)). Recount when they land.

| Enum | N | Kind | Where it renders |
|---|---|---|---|
| `OrderState` | 14 | **S** | customer tracking and orders; restaurant live strip and order panes; admin orders workspace |
| `AssignmentState` | 12 | **S** | rider delivery |
| `RestaurantOnboardingState` | 11 | **S** | restaurant onboarding; admin restaurant verification |
| `DispatchState` | 10 | **S** | rider offers; admin orders workspace |
| `RiderOnboardingState` | 10 | **S** | rider onboarding; admin rider onboarding |
| `RefundState` | 10 | **S** | admin refunds; customer order view |
| `PaymentState` | 8 | **S** | customer checkout |
| `HalalCheckKey` | 7 | **S** | admin verification console, each one × the 3 `HalalCheckResult` values |
| `HalalCertificateStatus` | 6 | **S** | admin verification; restaurant settings |
| `KycDocumentState` | 6 | **S** | rider and restaurant documents; admin review |
| `RestaurantAvailabilityState` | 5 | **S** | customer restaurant page; restaurant hours |
| `HalalIssuingBodyStatus` | 5 | **S** | admin issuing-body registry |
| **`HalalDisplayState`** | **4** | **S** | **customer Discover, search, restaurant page and orders: the product's claim** ([below](#4-the-four-halal-states-are-not-negotiable)) |
| `RiderAvailabilityState` | 4 | **S** | rider Home |
| `MenuItemAvailabilityState` | 4 | **S** | customer menu; restaurant menu |
| `HalalCertificateScope` | 4 | **S** | admin verification |
| `DispatchOfferOutcome` | 4 | **S** | rider offers |
| `RefundReasonCode` | 25 | V | one picker and one list row |
| `DocumentRejectionReasonCode` | 12 | V | one rejection composer |
| `HalalRejectionReasonCode` | 9 | V | one rejection composer |
| `RestaurantRejectApplicationReasonCode` | 9 | V | one rejection composer |
| `RefundKind` / `RefundScope` / `PaymentIntentKind` | 3–4 | V | form controls |

## 4. The four halal states are not negotiable

`HalalDisplayState` is the one enum where a design error is a product failure rather than a rough
edge. Its four members carry the platform's whole claim. Their colours are the `color.halal.*`
tokens in Claude Design, so this table names treatments, not values.

| Member | Treatment | Never |
|---|---|---|
| `CERTIFIED` | The halal seal, labelled "Halal certified" | Shown when the field is missing |
| `EXPIRING_SOON` | Amber tint in every app, labelled "Halal certified · expires 20 Oct" ([round 1](../decisions/README.md#halal-and-trust), [round 2](../decisions/README.md#halal-and-trust-1)) | Alarm |
| `EXPIRED` | Cool slate | **Red**; in a customer listing |
| `UNVERIFIED` | No badge for customers | In a customer listing |

Customer listings and restaurant pages only ever include `CERTIFIED` and `EXPIRING_SOON`
restaurants ([launch decisions](../decisions/README.md#settled--launch-decisions-sep-2026-client-confirmed-at-rc1)).
A missing field renders no badge at all. The rules behind this table are
[the halal invariants](../../AGENTS.md#3-non-negotiable-invariants) and the
[redesign constitution](redesign-constitution.md#2-the-halal-rules-outrank-every-design-argument);
they outrank any visual argument made against them.

## 5. Every screen, always

Independent of the state families, **every** screen ships four states. This is
[repo policy](../../AGENTS.md#6-how-to-work-here), not a preference: happy-path-only does not
merge.

1. **Loading.** A skeleton is not automatically right; sometimes the honest answer is a spinner
   with a sentence.
2. **Empty.** First-run empty and filtered-to-nothing empty are different problems, with
   different copy and different exits.
3. **Error.** Recoverable or terminal, and always a way out.
4. **Populated.** The happy path.

## 6. Count renderings, not screens

The work is every screen times its four baseline states, plus every state-family member it shows,
plus one container per vocabulary. Before the redesign that came to about 280 renderings across
about 38 screens; the approved canvases drew more, because each one covers every state and
variant. Quoting it as "a four-app redesign" understates it by an order of magnitude, and that
mismatch is how redesigns get abandoned part-way.

That is why the pipeline has gates: design in Claude Design, agent critique, owner approval, then
code. Each gate is cheaper than the rework it prevents.
