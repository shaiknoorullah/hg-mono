# Contract-Drift Audit — Go backend vs `openapi.yaml`

**79 confirmed drifts** — 7 critical, 21 high, 25 medium, 26 low. Independent Opus audit, adversarially verified.

## Executive summary

The HalalGoes Go backend has drifted from contracts/openapi.yaml across ~79 confirmed findings (7 critical, 21 high, 25 medium, 26 low). Nothing in CI ever compares a byte the running server emits against the contract — both gates check disjoint, contract-internal things — so drift surfaced only in the running product. Lead with the three tiers that matter:

HALAL (the product's single claim): Three surfaces guaranteed to render NO halal seal by construction. GET /v1/cart emits "restaurant": null unconditionally (cartToDTO never assigns Restaurant; the store never even fetches halal data), so the cart — a halal re-assertion surface before checkout — never shows the seal (critical). GET /v1/restaurant/profile emits a flat halal_status string instead of the required `halal` HalalBadge object, so the restaurant profile cannot express display_state (critical). GET /v1/orders/{orderId} (customer view) omits OrderRestaurantRef.halal entirely, tripping the C-12 client-error path (critical). addCartLine inherits the same null-restaurant defect (high). None produce a FALSE badge — the client fails safe to no-badge (invariant #8 holds) — but the required halal presentation is absent platform-wide on these surfaces.

MONEY + APP-CRASH: The restaurant-web order screens are the worst blast radius. The backend serves its own OrderDetailView / OrderSummaryView (flat total_cents/subtotal_cents/currency, no nested `money`, no `customer`, no `lines`) where the contract requires the nested OrderRestaurantView. restaurant-web reads order.money.subtotal_cents / commission_cents / restaurant_net_cents and order.customer.display_name — all undefined at runtime — so the Order Detail and Order Queue screens throw TypeError and crash. This is BOTH a money-display path (the restaurant cannot see what it will be paid: commission_cents / restaurant_net_cents are never even queried) AND an app crash. Every state-transition endpoint (acceptOrder, rejectOrder, markOrderReady, delayOrder) returns the same wrong-shaped struct, so the crash recurs after every successful action. rejectOrder and delayOrder additionally 422 on input (wrong field names: `reason` vs `reason_code`, `delay_minutes` vs `added_minutes`) under DisallowUnknownFields, so reject and delay are broken end-to-end before the response even matters.

ROOT CAUSE: No response-conformance oracle exists. Go "conformance" tests assert against hand-transcribed []string field lists (one file's own comment admits it whitelists non-contract fields), enum checks use hand-maintained Go maps, coverage is only whatever handler authors happened to test, and the apps were built against the Prism mock on :4010 which always emits contract-perfect shapes — so drift was structurally invisible until the real server ran. The durable fix (do it first) is a kin-openapi response-validation harness that runs every handler's live 2xx body through openapi3filter.ValidateResponse against openapi.yaml, making additionalProperties:false / required[] / enums the automatic oracle.

## Root cause (why every gate passed)

No gate ever compares a byte emitted by the running Go server to contracts/openapi.yaml. The two gates check disjoint things and neither closes the loop.

Root `pnpm check` (package.json:18) = validate:contract + validate:fixtures + generate:check + generate:tokens:check + lint + typecheck. I read both TS scripts in tools/contract-tools/src/:
- validate-contract.ts lints the openapi.yaml document itself ($ref resolution, operationId casing, x-roles presence, the money/mass-assignment invariants, YAML-1.1 truthy traps). It parses the YAML and inspects it; it never issues an HTTP request.
- validate-fixtures.ts compiles the openapi.yaml as JSON-Schema-2020-12 (Ajv) and validates the 311 committed fixture JSON files under contracts/fixtures/ against the schema each fixture *names*. It validates static, hand/generator-built fixture files — not server output.
- generate:check regenerates the TS api-client and git-diffs it; generate:tokens:check does design tokens. typecheck/lint are static. So the entire root gate proves the contract is internally consistent and that fixtures + generated TS client match it. The Go server is never invoked by any of these.

Backend `make check` (Makefile:101) = fmt-check vet test; test = `go test -race ./...`. The Go tests that claim to be conformance tests (internal/admin/handler_orders_conformance_test.go, handler_menu_conformance_test.go, internal/rider/rider_shape_test.go, and the account/addresses/restaurant stage3/stage4 files) all assert against Go string literals hand-transcribed from the contract, not against openapi.yaml. Concretely:
- handler_menu_conformance_test.go:48-73 defines menuCategoryRequired/Optional, menuVersionRequired/Optional as []string, and the file header comment (lines 44-50) literally says the impl serves restaurant_id/created_at/updated_at which are 'NOT named by the MenuCategory schema' — then puts them in the `optional` allow-list anyway. The 'closed schema' check (assertMenuClosedObject) is only as correct as that hand-copied list.
- rider_shape_test.go:147 comments the enum vars are 'mirrored from contracts/openapi.yaml'; line 178 hard-codes the RiderMe key set as a literal.
- handler_orders_conformance_test.go:56-105 hard-codes adminViewRequired/adminViewOptional/orderMoneyRequired/etc. as []string.

So the 'conformance' assertion is: does the server match a human's transcription of the contract into Go slices? If the transcription is wrong, stale, or over-permissive (as the menu file admits), a non-conformant response passes. And the loop is never closed against the actual YAML.

Finally, the apps were built against the Prism mock on :4010, which serializes from the contract and therefore always emits contract-perfect shapes. The apps compiled against the generated TS client (whose types come from the contract), so at build time everything typechecked. The real Go server was substituted for the mock at runtime only, where no schema check runs — so drift surfaced only in the running product, not in any gate.

### Durable fix

Adopt option (a) as the primary durable mechanism, backed by (c) as the deeper 'unrepresentable' layer, with (b) folded in for free because the fixtures already carry the operationId+schema+status needed to drive it.

Assessment of the three options in the requested order:

(a) Response-conformance harness — RECOMMENDED, build first. Add a Go test package (e.g. services/hg/internal/conformance) that: loads contracts/openapi.yaml once via kin-openapi (openapi3.NewLoader ... LoadFromFile), builds an openapi3filter router (gorillamux router or routers/legacy), spins each domain's chi router in-process via httptest.NewServer (the tests already do this — buildRouter/buildAdminTestServer), and for every request it issues, runs openapi3filter.ValidateResponse against the matched operation's declared 2xx schema. Because the schemas use additionalProperties:false and required[...], kin-openapi rejects extra fields, missing required fields, wrong types, and open-enum values automatically — no hand-copied []string. This replaces the entire hand-transcribed apparatus in handler_orders_conformance_test.go / handler_menu_conformance_test.go / rider_shape_test.go with one contract-driven validator. Feasible: the doc is clean 3.1 with operationId + application/json response schemas on every op (verified on getOrderAdmin at openapi.yaml:5218-5229), $ref-internal-only (validate-contract.ts already proves refs resolve), and additionalProperties:false present. Cost: add getkin/kin-openapi to go.mod (single dep) + a helper that wraps `do()`/`doJSON()` to validate on the way out. This is the mechanism that makes a non-conformant Go response FAIL the gate.

(b) Fixture replay against the real server — RECOMMENDED as a complementary corpus, low extra cost. The 311 fixtures already declare {operations[], schema, status, payload}. Two ways to use them: (i) as an ADDITIONAL response-schema source in the same harness — after a live call, validate the live body against BOTH the operation's contract schema AND (when a fixture for that operation/state exists) round-trip the fixture's own schema to confirm agreement; (ii) drive request scenarios: for state-machine seeds, seed the DB to the fixture's state, hit the operation, and assert the live response validates against the same component schema the fixture names. Replaying the fixtures as *expected bodies* byte-for-byte is brittle (ids/timestamps differ — the fixture menu_version_approved.json even has an APPROVED version carrying rejection_reason_code, which the conformance test forbids), so replay should assert schema-conformance + invariants, not equality. Net: (b) mainly buys state coverage; the validation engine is still (a).

(c) Generate Go response DTOs FROM the contract — RECOMMENDED as the eventual floor, larger change. oapi-codegen can emit Go types for all component schemas from openapi.yaml (mirror of what the TS api-client already does). If every handler's response value is one of these generated types, a renamed/extra/missing field is a compile error, and drift becomes unrepresentable rather than test-detectable. This is the strongest fix but requires refactoring existing hand-written DTOs to the generated ones (and the generated additionalProperties:false structs must be marshaled with a disallow-unknown discipline). Do it after (a) is catching drift, because (a) is cheap, immediate, and needs no handler rewrite; (c) is the durable end-state that removes the whole class.

Bottom line: (a) now (fail the gate on any non-conformant 2xx body, contract-driven), (b) layered on to get all-states coverage from the existing 311 fixtures, (c) as the follow-up that turns drift into a compile error.

### Gate wiring

Two edits, mirroring how the repo already layers a Go gate under the root pnpm gate.

1) services/hg/Makefile — add a target and fold it into `check`:
   .PHONY: conformance
   conformance: ## Validate every 2xx server response against contracts/openapi.yaml
   	$(GO) test -race -run Conformance ./internal/conformance/... ./internal/...
   and change line 101 from:
   check: fmt-check vet test
   to:
   check: fmt-check vet test conformance
   (If the harness needs Postgres, gate it like the existing container-backed tests — testcontainers is already a dep — so it runs in CI where Docker is present and skips locally without it, matching the current test/test-integration split.)

2) Root package.json — surface it in `pnpm check`. Today root `check` (line 18) never calls into services/hg. Add a script:
   "check:backend": "cd services/hg && make check"
   and append it to the gate:
   "check": "pnpm validate:contract && pnpm validate:fixtures && pnpm generate:check && pnpm generate:tokens:check && pnpm lint && pnpm typecheck && pnpm check:backend"
   This makes the one command CI runs (pnpm check) fail when a Go response drifts from openapi.yaml, closing the loop that is currently open. (Note: today root `pnpm check` does not run any Go at all — that is itself part of why backend drift never tripped the root gate; adding check:backend fixes that regardless of the conformance work.)

## Systemic patterns

- Backend serves its own hand-written view struct instead of the contract schema — the single largest pattern. OrderDetailView / OrderSummaryView (flat money, no customer, no lines) is returned where every restaurant-order operation contractually requires the nested OrderRestaurantView. Fixing the one shared struct-to-DTO mapping (nest money as RestaurantOrderMoney, add customer OrderCustomerRef, populate lines as OrderLine, add delivery_area/is_late/promised_ready_at) fixes getRestaurantOrder, listRestaurantOrders, acceptOrder, rejectOrder, markOrderReady, and delayOrder at once.
- Halal claim dropped by omission — cartToDTO never assigns Restaurant, orderRestaurantRefDTO has no halal field, and RestaurantProfile emits a flat halal_status string instead of the `halal` HalalBadge object. The store SQL never even fetches halal certification data for cart/order joins. One fix pattern: every restaurant reference on the wire (cart, order, profile) must carry a populated HalalBadge, which requires widening the store queries to join halal_certificate + halal_issuing_body (the catalog domain already does this via toHalalBadge — reuse it).
- Input DTOs use the wrong JSON field name AND decode strictly — reason vs reason_code (rejectOrder), delay_minutes/reason vs added_minutes/reason_code (delayOrder), promised_ready_minutes vs prep_eta_minutes + missing accepted_note (acceptOrder), is_available bool vs availability_state enum (setMenuItemAvailability), plus omitted optional fields (allergens_declared, image_object_id, prep_minutes on create/updateMenuItem, unavailable_menu_item_ids on reject). Because handlers call decodeStrict/DisallowUnknownFields, any contract-correct client is rejected with 422. One fix pattern: align every request DTO's json tags to the contract input schema and add the missing optional fields.
- Nested object flattened to top-level fields — RestaurantProfile.address (PublicAddress) emitted as flat line1/city/province/..., RestaurantHours.intervals emitted as `hours`, RestaurantOrderMoney flattened to top-level total_cents/subtotal_cents. Same wrong-nesting shape across profile, hours, and orders; a contract-driven DTO mapper eliminates the class.
- additionalProperties:false violations from extra fields the struct carries — halal_status/created_at/updated_at on RestaurantProfile, item_count/state_since/reject_reason on order views, status on the onboarding submit response. Strict validators reject these even when required fields are present. Generating response DTOs from the contract (oapi-codegen) makes both the extra-field and missing-field classes unrepresentable.
- Missing/hardcoded-constant values on populated data — cuisines always []string{} (restaurant_cuisine used only for filtering, never projected), logo_image_url hardcoded NULL::text, CartLine.image_url never selected, current_price_cents/PRICE_CHANGED never computed. The data exists in the DB but the SELECT list never projects it; one pattern is widening the card/cart SELECT column set and populating the mapper.
- No response-conformance oracle in either gate — the meta-pattern behind all of the above. Go tests assert against hand-transcribed []string field lists and hand-maintained enum maps; apps were built against the contract-perfect Prism mock. Every drift shape above is exactly what a kin-openapi ValidateResponse harness would have caught automatically via additionalProperties:false + required[] + enum membership.

## Prioritized fix plan

### 1. Build the durable response-conformance harness FIRST (root-cause fix). Add getkin/kin-openapi to services/hg/go.mod. Create services/hg/internal/conformance that loads contracts/openapi.yaml once (openapi3.NewLoader + LoadFromFile), builds an openapi3filter router, spins each domain's chi router in-process via httptest, and runs openapi3filter.ValidateResponse against the matched operation's 2xx schema for every request. Wire it into `make check` and enumerate all 144 operations so every operation with no coverage FAILS rather than silently passing. Delete/replace the hand-transcribed []string apparatus in handler_orders_conformance_test.go, handler_menu_conformance_test.go, rider_shape_test.go. Optionally fold in fixture-driven state seeding (the 311 fixtures already carry operationId+schema+status) and plan oapi-codegen response DTOs as the eventual 'unrepresentable' floor.

_Why:_ No gate ever compares server output to the contract; this is why every drift below shipped invisibly. Building it first means every subsequent fix is verified by the gate, and it prevents regression. additionalProperties:false + required[] + enums in the doc make it a near-complete oracle with a single dependency.

_Endpoints:_ ALL 144 operations (harness makes the contract the oracle for every 2xx body)

### 2. Restore the halal claim on every wire surface that references a restaurant. Widen the cart store query (cart_store.go) to join halal_certificate + halal_issuing_body and reuse the catalog toHalalBadge mapper; assign d.Restaurant a populated RestaurantCard (id, name, halal, availability) in cartToDTO. Add a `halal` HalalBadge field to orderRestaurantRefDTO and join halal data in loadOrderView. Replace RestaurantProfile's flat halal_status string with a nested `halal` HalalBadge object.

_Why:_ Halal verification is the product's single load-bearing claim (invariants #8/#9). These surfaces are guaranteed by construction to render no seal on a checkout-gating cart, the customer order view, and the restaurant profile. Rated critical; the client fails safe (no false badge) so this is not a crash, but the required halal presentation is absent platform-wide.

_Endpoints:_ getCart, addCartLine, getOrder, getRestaurantProfile, submitRestaurantProfile

### 3. Replace the flat OrderDetailView/OrderSummaryView with the contract's nested OrderRestaurantView in one shared struct-to-DTO mapper: nest money as RestaurantOrderMoney and QUERY + populate commission_cents and restaurant_net_cents (currently never selected); add the customer OrderCustomerRef (display_name, phone_masked) with the required join; populate lines[] as OrderLine (with menu_item_id, currency); add delivery_area, is_late, promised_ready_at, elapsed_seconds, rider; drop the extra top-level fields (item_count, state_since, reject_reason) that violate additionalProperties:false.

_Why:_ App-crash AND money path. restaurant-web dereferences order.money.*, order.customer.*, order.lines.reduce — all undefined — crashing Order Detail and Order Queue on load and after every state transition. The restaurant literally cannot see its commission or net payout. One shared fix clears six operations because they all return the same struct.

_Endpoints:_ getRestaurantOrder, listRestaurantOrders, acceptOrder, rejectOrder, markOrderReady, delayOrder

### 4. Align restaurant order/menu INPUT DTOs to the contract and stop 422-ing conformant clients. rejectOrder: rename json `reason`->`reason_code`, add unavailable_menu_item_ids. delayOrder: rename `delay_minutes`->`added_minutes`, `reason`->`reason_code`. acceptOrder: rename `promised_ready_minutes`->`prep_eta_minutes`, add accepted_note. setMenuItemAvailability: replace is_available bool with availability_state enum (derive the DB column from the enum). createMenuItem/updateMenuItem: add allergens_declared, image_object_id, prep_minutes.

_Why:_ App-breaking. Under DisallowUnknownFields, any contract-typed/generated client is rejected with 422, so reject and delay are broken end-to-end and menu availability/creation are unusable. rejectOrder additionally blocks the invariant-5 authorisation-void that accompanies rejection.

_Endpoints:_ rejectOrder, delayOrder, acceptOrder, setMenuItemAvailability, createMenuItem, updateMenuItem

### 5. Fix the restaurant onboarding/profile/hours response shapes to their contract schemas. submitRestaurantDocuments: return a real RestaurantOnboardingStatus (call GetOnboardingStatus) instead of {status:SUBMITTED}. getRestaurantOnboardingStatus: add account_state, current_step (enum), and the steps_completed object; drop the four non-contract fields. getRestaurantProfile/submitRestaurantProfile: nest address as PublicAddress, add account_state, drop created_at/updated_at. getRestaurantHours: rename `hours`->`intervals`, add timezone, rename override `on_date`->`date`.

_Why:_ App-breaking for any strict/generated client: wrong nesting, wrong field names, missing required fields, and additionalProperties:false violations make these responses undecodable, breaking the restaurant onboarding and profile screens. Not halal/money/crash, so below the tiers above.

_Endpoints:_ submitRestaurantDocuments, getRestaurantOnboardingStatus, getRestaurantProfile, submitRestaurantProfile, getRestaurantHours

### 6. Populate the systematically-empty projected fields by widening SELECT lists and mappers. cuisines: project restaurant_cuisine names in cardColumns and populate toCard (fixes card + detail). logo_image_url: select the real column instead of NULL::text in loadOrderView. CartLine.image_url and current_price_cents/PRICE_CHANGED: select the image column and compute price drift in loadCart. Add the missing latent order fields (rider, dispatch_state, delivery_address) and menu version menu_item_id.

_Why:_ Latent/cosmetic (medium-to-low): non-crashing empty arrays and constant nulls degrade gracefully but strip real, contract-defined data (cuisine subtitles vanish on every browse surface, thumbnails blank, price-drift annotation cannot render). No app currently reads several of these, so lowest priority — but the harness from step 1 will flag them, so batch them here.

_Endpoints:_ listRestaurants, getRestaurant, getCart, getOrder, getOwnMenu

## All findings by severity


### CRITICAL (7)

- **getCart** `GET /v1/cart` — missing_required_field; blast: apps/customer/src/screens/CartScreen.tsx:159, apps/customer/src/screens/CartScreen.tsx:161
  - expects: Cart.restaurant is oneOf[RestaurantCard, null]; RestaurantCard requires [id, name, halal, availability]. A non-empty cart is bound to one restaurant, so a populated RestaurantCard (including the halal seal) is expected — the cart is where the halal claim for the chosen restaurant is re-asserted before checkout.
  - emits: cartToDTO (map.go:57-83) never assigns d.Restaurant; the field is typed `any` in cartDTO (dto.go:18) and left nil, so the wire always emits "restaurant": null even though loadCart (cart_store.go:94-107) loaded c.RestaurantID and c.RestaurantName from the DB. The RestaurantCard and its required halal seal are unconditionally absent from every cart response.
  - evidence: openapi.yaml:7610-7613 (Cart.restaurant oneOf RestaurantCard/null) + openapi.yaml:7206-7212 (RestaurantCard required id,name,halal,availability) vs services/hg/internal/orders/map.go:57-83 (cartToDTO 
- **getOrder** `GET /v1/orders/{orderId}` — halal_field_drift
  - expects: OrderCustomerView.restaurant is OrderRestaurantRef which carries an optional `halal` field of type HalalBadge (required: [display_state]). HalalBadge is the product's single claim: when absent the client renders NO badge and reports a client error. The customer order view must be able to surface the restaurant's halal state.
  - emits: orderRestaurantRefDTO has exactly {id, name, logo_image_url}; there is no `halal` field on the struct at all, and OrderView carries no halal columns. loadOrderView SQL selects only restaurant_id and display_name from the restaurant join. The emitted restaurant ref can never carry a HalalBadge.
  - evidence: openapi.yaml:8104-8118 (OrderRestaurantRef with halal: HalalBadge) & 8189-8211 vs services/hg/internal/orders/dto.go:201-205 (orderRestaurantRefDTO no halal) & map.go:89 & order_read.go:98,106 (SQL se
- **getRestaurantOrder** `GET /v1/restaurant/orders/{orderId}` — wrong_nesting; blast: apps/restaurant-web/src/screens/OrderDetailScreen.tsx
  - expects: money: RestaurantOrderMoney nested object {subtotal_cents, discount_cents?, commission_cents, restaurant_net_cents, total_cents, currency}, required nested field 'money'
  - emits: OrderDetailView flattens money to top-level total_cents, subtotal_cents, currency; there is NO nested 'money' object
  - evidence: openapi.yaml:8404-8408 vs services/hg/internal/restaurant/store.go:141-146. App reads order.money.subtotal_cents/commission_cents/restaurant_net_cents/total_cents at OrderDetailScreen.tsx:324-342 - or
- **getRestaurantOrder** `GET /v1/restaurant/orders/{orderId}` — missing_required_field; blast: apps/restaurant-web/src/screens/OrderDetailScreen.tsx
  - expects: money.restaurant_net_cents (Cents, required) and money.commission_cents (Cents, required) - what the restaurant is paid
  - emits: neither restaurant_net_cents nor commission_cents is emitted anywhere in OrderDetailView
  - evidence: openapi.yaml:8331-8351 vs services/hg/internal/restaurant/store.go:141-146. App renders Price cents=order.money.restaurant_net_cents and commission_cents at OrderDetailScreen.tsx:330,336 - restaurant 
- **getRestaurantProfile** `GET /v1/restaurant/profile` — halal_field_drift
  - expects: RestaurantProfile.halal is a HalalBadge object {display_state (+certifying_body_name, expires_on)} — the load-bearing halal claim on the profile
  - emits: flat string field halal_status (e.g. "CERTIFIED") json:"halal_status"; no 'halal' HalalBadge object is emitted, so a halal-aware client renders no badge / cannot read display_state
  - evidence: openapi.yaml:9011-9012 (halal: HalalBadge) & 7189-7205 vs services/hg/internal/restaurant/store.go:29 (HalalStatus string json:"halal_status") & repo_reads.go:120
- **listRestaurantDocuments** `GET /v1/restaurant/documents` — halal_field_drift; blast: apps/admin/src/screens/ApplicationDetailScreen.tsx
  - expects: The HALAL_CERTIFICATE document row must expose certificate_number, issuer (accepted-registry certifying body) and valid_until so the halal certificate is inspectable/verifiable per R-07
  - emits: certificate_number is never selected or emitted; issuer is renamed issuer_name; valid_until renamed expires_on — the halal certificate's verification fields are dropped/mislabelled on the wire
  - evidence: openapi.yaml:9204-9219 (issuer, certificate_number, valid_until) vs services/hg/internal/restaurant/repo_reads.go:289-306 (selects valid_until AS ExpiresOn, issuer AS IssuerName, no certificate_number
- **attachRestaurantDocument** `POST /v1/restaurant/documents` — wrong_field_name
  - expects: RestaurantDocumentInput.required = [doc_type, stored_object_id]; optional issuer, issuer_body_id, certificate_number, issued_on, valid_until
  - emits: documentInputDTO accepts {stored_object_id, doc_type, expires_on, issuer_name}: 'expires_on' instead of 'valid_until', 'issuer_name' instead of 'issuer', and drops issuer_body_id, certificate_number, issued_on — a contract client sending 'valid_until'/'issuer'/'certificate_number' is 422'd (strict decode) and the halal cert metadata cannot be attached
  - evidence: openapi.yaml:9235-9261 vs services/hg/internal/restaurant/dto.go:54-59

### HIGH (21)

- **getCustomerProfile** `GET /v1/me/profile` — endpoint_missing_or_501
  - expects: 200 -> {data: CustomerProfile} with required account_id, first_name, phone_e164, email_verified, created_at; x-roles CUSTOMER. This is the primary profile-read endpoint.
  - emits: Nothing. No route is registered and no handler exists. routes.go registers only PATCH /v1/me/profile (updateCustomerProfile); there is no r.Get("/v1/me/profile", ...) and no GetCustomerProfile handler method anywhere in services/hg. A GET to this path falls through to the router default (405/404).
  - evidence: openapi.yaml:892-912 (getCustomerProfile GET /v1/me/profile) vs services/hg/internal/account/routes.go:16-36 (only PATCH registered) and services/hg/internal/account/handler.go (no GetCustomerProfile;
- **addCartLine** `POST /v1/cart/lines` — missing_required_field; blast: apps/customer/src/screens/CartScreen.tsx:159, apps/customer/src/screens/RestaurantScreen.tsx
  - expects: 200 response body is the full Cart; Cart.restaurant should carry the populated RestaurantCard (with halal) once a line has been added, since add-to-cart establishes the single restaurant the cart is bound to.
  - emits: AddCartLine (handlers.go:127-154) responds via the same cartToDTO which never populates restaurant; the recomputed cart returned after an add always has "restaurant": null. Same defect applies to updateCartLine, removeCartLine (all route through cartToDTO).
  - evidence: openapi.yaml:1644-1655 (addCartLine 200 -> Cart) + openapi.yaml:7610-7613 vs services/hg/internal/orders/map.go:57-83 (cartToDTO shared by all cart handlers). The cart header restaurant + halal seal n
- **getRestaurantOrder** `GET /v1/restaurant/orders/{orderId}` — missing_required_field; blast: apps/restaurant-web/src/screens/OrderDetailScreen.tsx, apps/restaurant-web/src/screens/OrderQueueScreen.tsx
  - expects: customer: OrderCustomerRef nested object {display_name required, phone_masked required}
  - emits: OrderDetailView has no customer object and no display_name/phone_masked fields
  - evidence: openapi.yaml:8300-8301 & 8352-8362 vs services/hg/internal/restaurant/store.go:136-151. App reads order.customer.display_name/phone_masked at OrderQueueScreen.tsx:71,80 and OrderDetailScreen.tsx:301,3
- **listRestaurantOrders** `GET /v1/restaurant/orders` — wrong_nesting; blast: apps/restaurant-web/src/screens/OrderQueueScreen.tsx
  - expects: data[] items are OrderRestaurantView with nested money(RestaurantOrderMoney), customer(OrderCustomerRef), lines[](OrderLine), delivery_area, is_late
  - emits: OrderSummaryView: flat {id,code,state,total_cents,currency,item_count,placed_at,deadline_at} - no money object, no customer, no lines array, no delivery_area/is_late; adds non-contract item_count
  - evidence: openapi.yaml:3253-3259 & 8267-8330 vs services/hg/internal/restaurant/store.go:125-134 returned by repo_reads.go:761 ListOrders. Queue reads order.lines.reduce (OrderQueueScreen.tsx:89), order.money.t
- **rejectOrder** `POST /v1/restaurant/orders/{orderId}/reject` — wrong_field_name; blast: apps/restaurant-web/src/screens/OrderDetailScreen.tsx
  - expects: OrderRejectInput required [reason_code] with reason_code (RestaurantRejectReasonCode), note (maxLength 500), unavailable_menu_item_ids (uuid[] max 50)
  - emits: rejectInputDTO decodes { reason (string), note } - field named 'reason' not 'reason_code'. decodeStrict rejects unknown fields
  - evidence: openapi.yaml:9513-9530 vs services/hg/internal/restaurant/dto.go:107-111 & handler.go:678-694. App POSTs {reason_code, note} at OrderDetailScreen.tsx:165-167 - server sees unknown field reason_code an
- **delayOrder** `POST /v1/restaurant/orders/{orderId}/delay` — wrong_field_name
  - expects: OrderDelayInput required [added_minutes, reason_code] with added_minutes enum [5,10,15,20] and reason_code (DelayReasonCode)
  - emits: delayInputDTO decodes { delay_minutes, reason } - both names wrong (added_minutes->delay_minutes, reason_code->reason). decodeStrict rejects unknown fields
  - evidence: openapi.yaml:9531-9542 vs services/hg/internal/restaurant/dto.go:113-118 & handler.go:775-796. A contract-typed client sending {added_minutes,reason_code} hits unknown-field 422 and missing required d
- **delayOrder** `POST /v1/restaurant/orders/{orderId}/delay` — wrong_nesting
  - expects: 200 response data is OrderRestaurantView (nested money/customer/lines)
  - emits: returns OrderDetailView (flat money, no customer) - inherits every getRestaurantOrder output drift
  - evidence: openapi.yaml:3441-3453 vs services/hg/internal/restaurant/repo_reads.go:1035 DelayOrder returns *OrderDetailView. Same shape mismatch as GET response.
- **markOrderReady** `POST /v1/restaurant/orders/{orderId}/ready` — wrong_nesting; blast: apps/restaurant-web/src/screens/OrderDetailScreen.tsx
  - expects: 200 response data is OrderRestaurantView (nested money/customer/lines, delivery_area, is_late, promised_ready_at)
  - emits: returns OrderDetailView (flat total_cents/subtotal_cents/currency, no money/customer/delivery_area/is_late)
  - evidence: openapi.yaml:3405-3411 vs services/hg/internal/restaurant/repo_reads.go:984 MarkOrderReady returns *OrderDetailView (store.go:136-151). App setState({order: data.data}) then re-renders detail reading 
- **acceptOrder** `POST /v1/restaurant/orders/{orderId}/accept` — wrong_nesting; blast: apps/restaurant-web/src/screens/OrderDetailScreen.tsx
  - expects: 200 response data is OrderRestaurantView (nested money/customer/lines)
  - emits: returns OrderDetailView (flat money, no customer object)
  - evidence: openapi.yaml:3327-3333 vs services/hg/internal/restaurant/repo_reads.go:866 AcceptOrder returns *OrderDetailView. App sets order from data.data then renders order.money.restaurant_net_cents/commission
- **rejectOrder** `POST /v1/restaurant/orders/{orderId}/reject` — wrong_nesting; blast: apps/restaurant-web/src/screens/OrderDetailScreen.tsx
  - expects: 200 response data is OrderRestaurantView (nested money/customer/lines)
  - emits: returns OrderDetailView (flat money, no customer object)
  - evidence: openapi.yaml:3363-3369 vs services/hg/internal/restaurant/repo_reads.go:933 RejectOrder returns *OrderDetailView. Same money/customer shape mismatch as GET response.
- **submitRestaurantDocuments** `POST /v1/restaurant/documents/submit` — wrong_nesting
  - expects: 200 body data must be a RestaurantOnboardingStatus object (required: onboarding_state, account_state, current_step, progress_percent, steps_completed) — 'Pack submitted; onboarding is now DOCUMENTS_REVIEW'
  - emits: httpx.Respond(..., map[string]string{"status":"SUBMITTED"}) — a single {"status":"SUBMITTED"} field, none of the RestaurantOnboardingStatus required fields present
  - evidence: openapi.yaml:2904-2914 (data: RestaurantOnboardingStatus) & 8904-8907 (required set) vs services/hg/internal/restaurant/handler.go:319
- **getRestaurantOnboardingStatus** `GET /v1/restaurant/onboarding/status` — missing_required_field
  - expects: RestaurantOnboardingStatus.required = [onboarding_state, account_state, current_step, progress_percent, steps_completed]; steps_completed is an object {profile, documents_uploaded, documents_submitted, documents_approved, payout_account, menu_published}; current_step enum [PROFILE,DOCUMENTS,AWAITING_REVIEW,FIX_DOCUMENTS,PAYOUT,MENU,DONE]
  - emits: OnboardingStatus struct emits {onboarding_state, progress_percent, profile_complete, hours_complete, documents_ready, halal_verified}; missing account_state, current_step and the steps_completed object; adds unspecified profile_complete/hours_complete/documents_ready/halal_verified
  - evidence: openapi.yaml:8904-8938 vs services/hg/internal/restaurant/store.go:36-43 & repo_reads.go:91-98
- **getRestaurantProfile** `GET /v1/restaurant/profile` — wrong_nesting
  - expects: RestaurantProfile.required includes address (a nested PublicAddress object) and timezone; the address is a nested object with line1/line2/city/province/postal_code/latitude/longitude
  - emits: RestaurantProfile view struct is FLAT: province, postal_code, city, line1, line2, latitude, longitude are top-level fields, no nested 'address' object at all — the required 'address' property is absent
  - evidence: openapi.yaml:8962 (required address) & 8989-8990 (address: PublicAddress) vs services/hg/internal/restaurant/store.go:18-24
- **getRestaurantProfile** `GET /v1/restaurant/profile` — extra_field
  - expects: RestaurantProfile additionalProperties:false; owner_first_name/owner_last_name allowed; no account_state string beyond RestaurantAccountState; no halal_status, created_at, updated_at fields
  - emits: emits halal_status, created_at, updated_at (not in schema) and OMITS account_state (a required field) — required[] is [id, legal_name, display_name, address, timezone, account_state, onboarding_state]
  - evidence: openapi.yaml:8961-8962 (additionalProperties:false; required account_state) vs services/hg/internal/restaurant/store.go:29-32 (halal_status, created_at, updated_at; no account_state)
- **submitRestaurantProfile** `PUT /v1/restaurant/profile` — wrong_nesting
  - expects: 200 response is RestaurantProfile (nested address + halal HalalBadge, account_state required) — same as getRestaurantProfile
  - emits: returns the same flat RestaurantProfile view (via GetProfile) — inherits every getRestaurantProfile drift: missing nested address, missing halal badge, missing account_state, extra halal_status/created_at/updated_at
  - evidence: openapi.yaml:2749-2750 (data: RestaurantProfile) vs services/hg/internal/restaurant/repo_reads.go:195 (returns GetProfile) & store.go:10-33
- **getRestaurantHours** `GET /v1/restaurant/hours` — wrong_field_name
  - expects: RestaurantHours.required = [timezone, intervals, overrides]; the weekly array is named 'intervals'
  - emits: HoursView emits {"hours":[...],"overrides":[...]} — the array is named 'hours' not 'intervals', and the required 'timezone' field is entirely absent
  - evidence: openapi.yaml:9102-9116 (required timezone,intervals,overrides) vs services/hg/internal/restaurant/store.go:63-66 (Hours json:"hours", no Timezone)
- **getRestaurantHours** `GET /v1/restaurant/hours` — wrong_field_name
  - expects: HoursOverride.required = [date, is_closed]; the field is named 'date'
  - emits: HoursOverrideRow emits json:"on_date" — the required 'date' field is missing (renamed on_date)
  - evidence: openapi.yaml:9117-9134 (date, is_closed) vs services/hg/internal/restaurant/store.go:55 (OnDate json:"on_date")
- **setRestaurantHours** `PUT /v1/restaurant/hours` — wrong_nesting
  - expects: 200 response RestaurantHours (timezone + intervals + overrides)
  - emits: returns HoursView (hours/overrides, no timezone, override keyed on_date) — same drift as getRestaurantHours
  - evidence: openapi.yaml:2808-2810 vs services/hg/internal/restaurant/repo_reads.go:283 (returns GetHours) & store.go:63-66
- **listRestaurantDocuments** `GET /v1/restaurant/documents` — wrong_field_name
  - expects: KycDocument fields: doc_type, state, issuer, certificate_number, issued_on, valid_until, version, subject_type, rejection_reason_code, review_note, reviewed_at, created_at (required: id, subject_type, doc_type, state, version, created_at)
  - emits: DocumentRow emits {id, subject_id, doc_type, state, stored_object_id, expires_on, issuer_name, created_at}: uses 'expires_on' instead of contract 'valid_until', 'issuer_name' instead of 'issuer', adds non-schema 'stored_object_id', and OMITS required subject_type and version plus certificate_number, issued_on, rejection_reason_code, review_note, reviewed_at
  - evidence: openapi.yaml:9185-9233 vs services/hg/internal/restaurant/store.go:69-78 & repo_reads.go:305-306
- **attachRestaurantDocument** `POST /v1/restaurant/documents` — wrong_field_name
  - expects: 201 response is a KycDocument (valid_until, issuer, certificate_number, version, subject_type, ...)
  - emits: returns DocumentRow with expires_on/issuer_name/stored_object_id, no version, no subject_type, no certificate_number — same KycDocument drift as the list endpoint
  - evidence: openapi.yaml:2873-2874 (data: KycDocument) vs services/hg/internal/restaurant/repo_reads.go:330-339 & store.go:69-78
- **listMenuReviewQueue** `GET /v1/admin/menu-reviews` — missing_required_field
  - expects: MenuItemVersion carries the claim-bearing fields under review: `ingredients_text` (type [string,'null']) and `image_url` (type [string,'null'], format uri). The review queue exists precisely to review 'words, picture, dietary and allergen assertions' per the operation description.
  - emits: The `menuItemVersion` wire struct omits both `ingredients_text` and `image_url` entirely — they are never present as JSON fields, so every item in the review queue is returned without its ingredients text or its picture. The store persists ingredients_text (store_menu.go:212,219) but the DTO never carries it to the wire.
  - evidence: openapi.yaml:9457 (ingredients_text), openapi.yaml:9467 (image_url) vs services/hg/internal/admin/dto.go:477-492 (menuItemVersion struct has neither field) and services/hg/internal/admin/handler_menu.

### MEDIUM (25)

- **listNotifications** `GET /v1/notifications` — missing_required_field
  - expects: Notification.order_id: type [string,'null'] format uuid — 'names an entity id, so a tap always lands on the object'. The response object is additionalProperties:false; order_id is a defined property.
  - emits: The Go notificationResponse struct (handler.go:148-157) has no order_id field, and the store SELECT (store.go:331,339,350,363) never selects order_id. The wire object can never carry order_id, so a notification about an order cannot deep-link to that order by id.
  - evidence: openapi.yaml:7010-7012 (order_id property on Notification) vs services/hg/internal/account/handler.go:148-157 (notificationResponse omits order_id) and services/hg/internal/account/store.go:331 (SELEC
- **listRestaurants** `GET /v1/restaurants` — other; blast: packages/ui-native/src/content/RestaurantCard.tsx:83, packages/ui-native/src/content/RestaurantCard.tsx:153-159, apps/customer/src/screens/DiscoveryScreen.tsx:51
  - expects: RestaurantCard.cuisines: array of strings (openapi.yaml:7228-7231), populated from the restaurant's cuisine associations — rendered as the card subtitle line.
  - emits: cuisines is hardcoded to an empty slice [] for every card. The restaurantRow struct has no cuisines field and cardColumns SELECT never joins restaurant_cuisine for output; the table is used only for filtering (repo.go:149-152). toCard sets Cuisines: []string{} unconditionally (mappers.go:32).
  - evidence: openapi.yaml:7228-7231 (cuisines array) vs services/hg/internal/catalog/mappers.go:32 (Cuisines: []string{}) and services/hg/internal/catalog/repo.go:30-57 (restaurantRow has no cuisines field). Consu
- **getRestaurant** `GET /v1/restaurants/{restaurantId}` — other; blast: apps/customer/src/screens/RestaurantScreen.tsx
  - expects: RestaurantDetail inherits RestaurantCard.cuisines (openapi.yaml:7228, 7320-7322) — the detail header shows cuisine tags.
  - emits: Same empty-cuisines defect: RestaurantDetail embeds RestaurantCard built by toCard, so cuisines is [] on detail too (handler_discovery.go:94 -> mappers.go:32).
  - evidence: openapi.yaml:7320-7322 (RestaurantDetail allOf RestaurantCard) vs services/hg/internal/catalog/handler_discovery.go:94 (card := toCard(...)) and mappers.go:32. Same root cause as listRestaurants; list
- **setMenuItemAvailability** `PUT /v1/restaurant/menu/items/{itemId}/availability` — wrong_field_name
  - expects: MenuItemAvailabilityInput requires `availability_state` (enum [AVAILABLE, OUT_OF_STOCK]) plus optional `out_of_stock_until`. additionalProperties:false.
  - emits: availabilityInputDTO (services/hg/internal/restaurant/dto.go:96-99) reads `is_available` (bool) + `out_of_stock_until`. The handler decodes with decodeStrict/DisallowUnknownFields (handler.go:521), so a contract-correct client sending `availability_state` gets 422 (unknown field) and the required field is never honoured; the backend instead expects a boolean the contract does not define.
  - evidence: openapi.yaml:9490-9505 (MenuItemAvailabilityInput: availability_state enum) vs services/hg/internal/restaurant/dto.go:96-99 + handler.go:520-523. When restaurant-web wires this endpoint it will send a
- **getOwnMenu** `GET /v1/restaurant/menu` — missing_required_field
  - expects: OwnedMenu.categories[].items[] is MenuItemOwnerView = allOf(MenuItem + owner fields). MenuItem base requires [id, name, price_cents, currency, availability_state, tax_category]; owner overlay requires [category_id]. So each item MUST carry a flat `name` and `tax_category` (both required), plus description, image_url, dietary_tags, allergen_tags, ingredients_text, prep_minutes, variant_groups, addon_groups.
  - emits: MenuItemView (services/hg/internal/restaurant/store.go:91-103) emits only {id, category_id, price_cents, currency, availability_state, out_of_stock_until, sort_order, live_version, pending_version, created_at, updated_at}. The required `name` and `tax_category` fields are absent from the item level — name/description/tags are instead nested under live_version/pending_version. So the response violates the MenuItem base contract: no top-level name, no tax_category.
  - evidence: openapi.yaml:9415 (MenuItemOwnerView) + openapi.yaml:7459 (MenuItem required[]) vs services/hg/internal/restaurant/store.go:91-103. No app consumes getOwnMenu yet (grep of apps/ for getOwnMenu is empt
- **getOwnMenu** `GET /v1/restaurant/menu` — missing_required_field
  - expects: MenuItemVersion.required = [id, menu_item_id, version, review_status, created_at]. `menu_item_id` (uuid) is REQUIRED on every version object.
  - emits: restaurant.MenuItemVersion (store.go:106-116) has json tags {id, version, name, description, ingredients_text, dietary_tags, allergen_tags, review_status, created_at} — `menu_item_id` is entirely missing, as are optional restaurant_id, image_url, rejection_reason_code, review_note, submitted_at, reviewed_at.
  - evidence: openapi.yaml:9436-9440 (MenuItemVersion required includes menu_item_id) vs services/hg/internal/restaurant/store.go:106-116 (loadItemVersion at repo_reads.go:455-477 never selects menu_item_id). Laten
- **createMenuItem** `POST /v1/restaurant/menu/items` — missing_required_field
  - expects: MenuItemInput allows `allergens_declared` (bool), `image_object_id` (uuid), and `prep_minutes` (int32) in addition to name/category_id/price_cents/description/ingredients_text/dietary_tags/allergen_tags/sort_order. additionalProperties:false.
  - emits: menuItemInputDTO (services/hg/internal/restaurant/dto.go:71-80) omits `allergens_declared`, `image_object_id`, and `prep_minutes`. Since the handler decodes strict (DisallowUnknownFields), a client sending the contract-legal `allergens_declared` / `image_object_id` / `prep_minutes` gets 422; those fields can never be set.
  - evidence: openapi.yaml:9289-9330 (MenuItemInput properties) vs services/hg/internal/restaurant/dto.go:71-80. allergens_declared is the explicit acknowledgement that an empty allergen list is intentional (allerg
- **updateMenuItem** `PATCH /v1/restaurant/menu/items/{itemId}` — missing_required_field
  - expects: MenuItemUpdateInput permits optional `allergens_declared` (bool), `image_object_id` (uuid), `prep_minutes` (int32).
  - emits: menuItemUpdateDTO (services/hg/internal/restaurant/dto.go:83-92) omits allergens_declared, image_object_id, prep_minutes. decodeStrict 422s any body carrying them.
  - evidence: openapi.yaml:9394-9414 (MenuItemUpdateInput) vs services/hg/internal/restaurant/dto.go:83-92.
- **getOrder** `GET /v1/orders/{orderId}` — missing_required_field
  - expects: OrderCustomerView.rider: oneOf [RiderPublicProfile, null] — the customer projection carries the rider's public profile.
  - emits: orderCustomerViewDTO has no rider field; OrderView struct has no rider fields; SQL does not join dispatch/rider. The rider block is absent from getOrder/getActiveOrder (exists only on the separate /rider and /tracking endpoints).
  - evidence: openapi.yaml:8228-8231 (rider oneOf RiderPublicProfile|null) vs services/hg/internal/orders/dto.go:178-199 & order_read.go:17-49; latent — no app reads order.rider yet
- **getOrder** `GET /v1/orders/{orderId}` — missing_required_field
  - expects: OrderCustomerView.dispatch_state: oneOf [DispatchState, null] — the subordinate dispatch machine state.
  - emits: orderCustomerViewDTO has no dispatch_state field; OrderView carries no dispatch state; loadOrderView SQL does not join the dispatch row.
  - evidence: openapi.yaml:8232-8235 (dispatch_state) vs services/hg/internal/orders/dto.go:178-199 & order_read.go:96-114 (no dispatch join); latent
- **getOrder** `GET /v1/orders/{orderId}` — missing_required_field
  - expects: OrderCustomerView.delivery_address: oneOf [Address, null] — the customer's delivery address on the order projection.
  - emits: orderCustomerViewDTO has no delivery_address field; OrderView has no address field. SQL selects delivery_instructions but not the delivery address. Key absent from body.
  - evidence: openapi.yaml:8218-8221 (delivery_address oneOf Address|null) vs services/hg/internal/orders/dto.go:178-199 & order_read.go:96-114 (no address column selected); latent
- **getRestaurantOrder** `GET /v1/restaurant/orders/{orderId}` — missing_required_field; blast: apps/restaurant-web/src/screens/OrderDetailScreen.tsx, apps/restaurant-web/src/screens/OrderQueueScreen.tsx
  - expects: delivery_area (string, PII-safe pre-acceptance), promised_ready_at (nullable date-time), is_late (boolean), elapsed_seconds (int32), rider (OrderRiderRef|null)
  - emits: none of delivery_area, promised_ready_at, is_late, elapsed_seconds, rider present in OrderDetailView
  - evidence: openapi.yaml:8309-8402 vs services/hg/internal/restaurant/store.go:136-151. App reads order.delivery_area (OrderQueueScreen.tsx:96, OrderDetailScreen.tsx:314), order.promised_ready_at (OrderDetailScre
- **acceptOrder** `POST /v1/restaurant/orders/{orderId}/accept` — wrong_field_name; blast: apps/restaurant-web/src/screens/OrderDetailScreen.tsx
  - expects: OrderAcceptInput { prep_eta_minutes (int32 1..120, optional), accepted_note (string maxLength 200, optional) }
  - emits: acceptInputDTO decodes only { promised_ready_minutes }; no prep_eta_minutes, no accepted_note. Handler uses decodeStrictOptional (DisallowUnknownFields)
  - evidence: openapi.yaml:9500-9512 vs services/hg/internal/restaurant/dto.go:101-105 & handler.go:610-621. App sends body:{} (OrderDetailScreen.tsx:116) so accept survives now, but any prep_eta_minutes/accepted_n
- **getRestaurantOrder** `GET /v1/restaurant/orders/{orderId}` — extra_field
  - expects: OrderRestaurantView additionalProperties:false - no top-level total_cents/subtotal_cents/currency/state_since/reject_reason
  - emits: OrderDetailView emits top-level total_cents, subtotal_cents, currency, state_since, reject_reason outside the schema
  - evidence: openapi.yaml:8268-8269 vs services/hg/internal/restaurant/store.go:137-151. Strict contract validator fails these responses; consuming app tolerates extras.
- **getRestaurantOrder** `GET /v1/restaurant/orders/{orderId}` — missing_required_field; blast: apps/restaurant-web/src/screens/OrderDetailScreen.tsx
  - expects: each OrderLine requires menu_item_id (uuid) and currency (Currency); optional variant_name, addons[], special_request
  - emits: OrderLineView emits only line_no, name, quantity, unit_price_cents, line_total_cents - missing required menu_item_id and currency
  - evidence: openapi.yaml:8119-8148 vs services/hg/internal/restaurant/store.go:154-160. App renders line.line_total_cents/quantity (OrderDetailScreen.tsx:267-290) so screen survives, but menu_item_id/currency abs
- **rejectOrder** `POST /v1/restaurant/orders/{orderId}/reject` — missing_required_field
  - expects: unavailable_menu_item_ids (array of uuid, max 50) - prompts marking items out of stock
  - emits: rejectInputDTO has no unavailable_menu_item_ids field; dropped/422'd by DisallowUnknownFields
  - evidence: openapi.yaml:9524-9530 vs services/hg/internal/restaurant/dto.go:107-111. Not yet sent by app but part of reject contract.
- **setRestaurantHours** `PUT /v1/restaurant/hours` — wrong_field_name
  - expects: RestaurantHoursInput.required = [intervals]; body carries 'intervals' array and 'overrides' with HoursOverride items keyed by 'date'
  - emits: hoursInputDTO decodes json:"hours" (not intervals) and hoursOverride decodes json:"on_date" (not date); with strict decoding a contract-correct client sending {intervals,overrides:[{date}]} is rejected 422 UNKNOWN_FIELD and the required intervals never bind
  - evidence: openapi.yaml:9135-9149 & 9117-9134 vs services/hg/internal/restaurant/dto.go:39-51 (Hours json:"hours", OnDate json:"on_date")
- **getRestaurantOnboardingStatus** `GET /v1/restaurant/onboarding/status` — extra_field
  - expects: additionalProperties:false — response may contain EXACTLY onboarding_state, account_state, current_step, progress_percent, steps_completed (+ optional blocking_reason, review_cycle, rejection)
  - emits: extra top-level booleans profile_complete, hours_complete, documents_ready, halal_verified not defined anywhere in RestaurantOnboardingStatus
  - evidence: openapi.yaml:8905-8906 (additionalProperties:false) vs services/hg/internal/restaurant/store.go:39-42
- **submitRestaurantProfile** `PUT /v1/restaurant/profile` — wrong_field_name
  - expects: RestaurantProfileInput.required includes cuisine_ids and avg_prep_minutes; timezone is NOT an input property (server-derived) and delivery_radius_m is NOT a property of the input
  - emits: profileInputDTO adds timezone and delivery_radius_m as accepted json fields — but the input decoder is strict (DisallowUnknownFields); the contract's additionalProperties:false means a compliant client that never sends them is fine, yet the server treating timezone/delivery_radius_m as writable diverges from the server-owned-field contract
  - evidence: openapi.yaml:9021-9036 (required/properties, no timezone/delivery_radius_m) vs services/hg/internal/restaurant/dto.go:24,27
- **getRiderMe** `GET /v1/riders/me` — missing_required_field; blast: apps/rider/src/RiderHome.tsx
  - expects: RiderMe with optional-but-app-critical fields: photo_url (string|null, uri), phone_e164 (PhoneE164), rating_avg (number|null 0-5), vehicle (RiderVehicle|null). Contract marks them optional (not in required[]), but the rider app's profile header and vehicle card render only when present.
  - emits: riderMeResponse struct emits ONLY {account_id, first_name, last_name, onboarding_state, account_status, availability_state, next_route}. GetRiderProfile SQL selects none of photo_url/phone/rating/timezone and performs no rider_vehicle join, so these can never be populated.
  - evidence: openapi.yaml:9542-9579 (RiderMe: phone_e164:9554, photo_url:9556, vehicle:9565, active_assignment_id:9569, rating_avg:9572, timezone:9576) vs services/hg/internal/rider/handler.go:503-511 (riderMeResp
- **getRiderDashboard** `GET /v1/riders/me/dashboard` — other; blast: apps/rider/src/screens/AvailabilityScreen.tsx
  - expects: RiderDashboard.active_assignment (Assignment|null) and current_offer (DispatchOffer|null) reflecting the actual active work — the dashboard is described as 'the only recovery path after a crash: it always returns the active assignment with its exact state'.
  - emits: dashboardResponse hardcodes ActiveAssignment:nil and CurrentOffer:nil unconditionally; GetDashboard never loads assignment/offer state.
  - evidence: openapi.yaml:9805-9812 vs services/hg/internal/rider/handler.go:603-608 (dashboardResponse) and handler.go:1245-1255 (always nil). Contract intent openapi.yaml:3753-3758. Field is nullable so no crash
- **decideMenuVersion** `POST /v1/admin/menu-reviews/{versionId}/decision` — missing_required_field
  - expects: The returned MenuItemVersion carries `ingredients_text` and `image_url` (the claim-bearing fields).
  - emits: Same `menuItemVersion` struct is returned; `ingredients_text` and `image_url` are never serialized.
  - evidence: openapi.yaml:9457,9467 vs services/hg/internal/admin/dto.go:477-492; response built via renderMenuItemVersion at handler_menu.go:385.
- **createMenuItemOnBehalf** `POST /v1/admin/restaurants/{restaurantId}/menu/items` — missing_required_field
  - expects: MenuItemOwnerView.live_version / pending_version are full MenuItemVersion objects, which include `ingredients_text` and `image_url`. MenuItemOwnerView (via base MenuItem) may also carry optional `image_url`, `ingredients_text`, `dietary_tags`, `allergen_tags`, `out_of_stock_until`, `prep_minutes`, `variant_groups`, `addon_groups`.
  - emits: The embedded `menuItemVersion` in live_version/pending_version omits `ingredients_text` and `image_url`; the `menuItemOwnerView` struct itself omits the optional base-MenuItem claim fields (image_url, ingredients_text, dietary_tags, allergen_tags, out_of_stock_until, prep_minutes, variant_groups, addon_groups).
  - evidence: openapi.yaml:9415-9435 (MenuItemOwnerView allOf MenuItem), openapi.yaml:9457,9467 (version fields) vs services/hg/internal/admin/dto.go:438-451 (menuItemOwnerView) and dto.go:477-492 (menuItemVersion)
- **getPublicConfig** `GET /v1/config/public` — endpoint_missing_or_501
  - expects: 200 with data: PublicConfig — required fields currency (Currency enum), served_provinces (Province[]), quote_ttl_seconds (int32), restaurant_response_window_seconds (int32), max_tip_cents (Cents/int64 minor units), support_enabled (bool), default_map_center {latitude, longitude}; plus optional support_phone_e164, support_hours, terms_version.
  - emits: No handler exists. system.Routes (services/hg/internal/system/routes.go:17-54) registers only /health, /health/ready, /internal/deps, /healthz, /readyz, /debug/deps. cmd/hg/main.go:275 is the sole call to system.Routes and no other module registers /v1/config/public. Request returns 404.
  - evidence: openapi.yaml:211-236 (path) + 6636-6685 (PublicConfig schema) vs services/hg/internal/system/routes.go:22-53 (no route) and services/hg/internal/system/doc.go:29 (TODO: getPublicConfig not implemented
- **getOpenApiDocument** `GET /v1/openapi.json` — endpoint_missing_or_501
  - expects: 200 with the generated OpenAPI 3.1 document (object, additionalProperties:true). A CI drift check is documented to depend on this route.
  - emits: No handler exists. Not registered in system.Routes (routes.go:22-53) nor anywhere else in services/hg. Request returns 404.
  - evidence: openapi.yaml:189-210 (path getOpenApiDocument) vs services/hg/internal/system/routes.go:22-53 (no route) and services/hg/internal/system/doc.go:32 (TODO: getOpenApiDocument not implemented)

### LOW (26)

- **listSessions** `GET /v1/auth/sessions` — other
  - expects: Contract declares Limit + Cursor query parameters and a PageMeta {next_cursor, has_more, total?} that supports real cursor pagination over the account's live sessions.
  - emits: Handler ignores both parameters: it calls store.ListLiveSessions(ctx, p.AccountID, 50) with a hardcoded limit of 50 and always returns Meta{NextCursor: nil, HasMore: false}. Cursor is never read; a page boundary is never emitted.
  - evidence: openapi.yaml:577-604 (listSessions parameters Limit/Cursor, response required [data, meta] with PageMeta) vs services/hg/internal/auth/handlers.go:536 (ListLiveSessions(..., 50)) and handlers.go:554 (
- **listNotifications** `GET /v1/notifications` — missing_required_field
  - expects: Notification.channels_attempted: array of NotificationChannel, with the documented invariant that the INAPP row always exists (inbox is system of record). Defined property on the additionalProperties:false schema.
  - emits: The Go notificationResponse struct (handler.go:148-157) has no channels_attempted field and the store never selects delivery-channel data. The delivery-attempt metadata is absent from every notification on the wire.
  - evidence: openapi.yaml:7002-7009 (channels_attempted on Notification) vs services/hg/internal/account/handler.go:148-157 and store.go:331. Optional field, no app consumer — cosmetic/latent.
- **getRestaurantMenu** `GET /v1/restaurants/{restaurantId}/menu` — other; blast: apps/customer/src/screens/RestaurantScreen.tsx, apps/restaurant-web/src/screens/MenuScreen.tsx
  - expects: MenuItem.availability_state is MenuItemAvailabilityState enum [AVAILABLE, OUT_OF_STOCK, HIDDEN, BLOCKED]; customer menu returns out-of-stock items marked unavailable (not hidden). Response schema is clean and fully populated (name, price_cents int64, currency, tax_category, dietary/allergen tags, variant_groups, addon_groups, item_count).
  - emits: Customer menu (catalog: dto.go MenuItem l.132-148, mappers.go toMenuItem l.89-135, handler_discovery.go l.142-160) matches the contract field-for-field: price_cents int64, [] for empty tag/option lists, item_count set per category. No drift found on the consumed customer endpoint.
  - evidence: openapi.yaml:7459-7515 (MenuItem) vs services/hg/internal/catalog/dto.go:132-148 + mappers.go:89-135 — conformant. Recorded as a no-drift confirmation for the one menu endpoint the apps actually consu
- **getCart** `GET /v1/cart` — other
  - expects: CartLine.image_url is type [string,'null'] format uri — an optional line thumbnail; when the menu item has an image the cart line should carry its URL.
  - emits: cartLineDTO.ImageURL (dto.go:32) is never set in cartToDTO (map.go:68-72) and loadCart's SQL (cart_store.go:112-114) never selects an image column, so image_url is unconditionally null on every cart line.
  - evidence: openapi.yaml:7652-7654 (CartLine.image_url) vs services/hg/internal/orders/map.go:68-72 (ImageURL never assigned) and cart_store.go:112-114 (no image column selected). Latent nullable field not curren
- **getCart** `GET /v1/cart` — other
  - expects: CartLine.availability.current_price_cents is oneOf[Cents, null] — the current unit price, surfaced with reason PRICE_CHANGED when a line's live price drifts from the cart price (C-19/R-19 annotate-never-mutate).
  - emits: cartAvailabilityDTO.CurrentPriceCents (dto.go:58) is never set; cartToDTO builds Availability only from IsAvailable + UnavailReason (map.go:72), and loadCart never computes a PRICE_CHANGED reason nor a current price, so current_price_cents is always null and PRICE_CHANGED is never emitted.
  - evidence: openapi.yaml:7702-7705 (current_price_cents) + openapi.yaml:7698 (PRICE_CHANGED reason) vs services/hg/internal/orders/map.go:72 (Availability populated without CurrentPriceCents) and cart_store.go:15
- **getOrder** `GET /v1/orders/{orderId}` — missing_required_field; blast: apps/customer/src/screens/TrackingScreen.tsx
  - expects: OrderCustomerView.eta_at: type [string,'null'] format date-time — the customer-facing ETA the tracking UI renders.
  - emits: orderCustomerViewDTO has no eta_at JSON field; OrderView struct has no ETA field; SQL selects no eta column. The key is entirely absent from the wire body.
  - evidence: openapi.yaml:8244-8246 (eta_at) vs services/hg/internal/orders/dto.go:178-199 (no eta_at) & order_read.go:17-49; consumer TrackingScreen.tsx:108 reads state.order.eta_at as estimatedAt — undefined, ET
- **getOrder** `GET /v1/orders/{orderId}` — wrong_nullability
  - expects: OrderRestaurantRef.logo_image_url: type [string,'null'] format uri — the restaurant's logo, populated when it exists.
  - emits: loadOrderView hardcodes the logo column as NULL::text in the SELECT list, so logo_image_url is ALWAYS null for every order regardless of whether the restaurant has a logo. Field name/type match but the value is a constant null.
  - evidence: openapi.yaml:8114-8116 (logo_image_url) vs services/hg/internal/orders/order_read.go:98 (SELECT ... r.display_name, NULL::text) & map.go:89 (RestaurantLogoURL always nil)
- **listRestaurantOrders** `GET /v1/restaurant/orders` — extra_field
  - expects: OrderRestaurantView additionalProperties:false; item_count is not a contract field
  - emits: OrderSummaryView emits item_count and top-level total_cents/currency that belong under money
  - evidence: openapi.yaml:8268 vs services/hg/internal/restaurant/store.go:130. Strict validator rejects; app instead recomputes count from lines (themselves missing).
- **createAssignmentTransition** `POST /v1/riders/me/assignments/{assignmentId}/transitions` — wrong_enum_value
  - expects: AssignmentTransitionInput.to_state is an AssignmentState, but as a rider-driven forward transition only the rider-reachable states are legal inbound (ASSIGNED, EN_ROUTE_TO_PICKUP, ARRIVED_AT_PICKUP, PICKED_UP, EN_ROUTE_TO_DROPOFF, ARRIVED_AT_DROPOFF, DELIVERED). Server-only/terminal states (UNDELIVERABLE, RETURNING, RETURNED, CANCELLED_BY_PLATFORM, REASSIGNED) are set by the platform, never posted by a rider client.
  - emits: The handler's inbound allow-list assignmentStates accepts ALL 12 AssignmentState values including the server-only CANCELLED_BY_PLATFORM, REASSIGNED, UNDELIVERABLE, RETURNING, RETURNED as valid to_state at the validation layer (the service-layer transition rules are the only guard).
  - evidence: contracts/openapi.yaml:5999-6018 (AssignmentState enum) & 10105-10111 (to_state) vs services/hg/internal/dispatch/handlers.go:226-231 (assignmentStates map) and 249-253 (validation)
- **getAssignment** `GET /v1/riders/me/assignments/{assignmentId}` — other
  - expects: Assignment.items[].allergen_tags is an array of AllergenTag enum values, intended to carry each line's real allergen tags for the rider.
  - emits: loadItems always hardcodes it.AllergenTags = []string{} and never reads any allergen column; every item's allergen_tags is emitted as an empty array regardless of the actual order line. Shape is valid (empty array is legal) but the field is never populated.
  - evidence: contracts/openapi.yaml:10066-10069 (allergen_tags) vs services/hg/internal/dispatch/store_reads.go:256 (it.AllergenTags = []string{})
- **getAssignment** `GET /v1/riders/me/assignments/{assignmentId}` — other
  - expects: Assignment.dropoff.phone_alias is a nullable proxy number 'deactivated 30 minutes after the assignment terminates' — the rider-facing proxied customer contact.
  - emits: a.Dropoff.PhoneAlias is never assigned; the store comment states the proxy alias is out of scope for V1, so it is always serialized as null even for a live, non-terminal assignment. Shape-valid (nullable) but the contract-described capability is absent.
  - evidence: contracts/openapi.yaml:10036-10038 (dropoff.phone_alias) vs services/hg/internal/dispatch/store_reads.go:158-159 (comment: left nil until the proxy service lands)
- **getRiderMe** `GET /v1/riders/me` — other
  - expects: RiderMe.active_assignment_id (string|null uuid) and timezone (Timezone) present so the app can restore an active-delivery route after a crash and localise times.
  - emits: riderMeResponse omits active_assignment_id and timezone entirely; struct has no such fields and SQL does not fetch them.
  - evidence: openapi.yaml:9569-9577 vs services/hg/internal/rider/handler.go:503-511. Not currently read by any app file (RiderHome.tsx does not reference active_assignment_id/timezone), so latent.
- **getRiderDashboard** `GET /v1/riders/me/dashboard` — missing_required_field; blast: apps/rider/src/screens/AvailabilityScreen.tsx
  - expects: Optional RiderDashboard.blocking_reasons (array<string>) and tracking_health (TrackingHealth|null).
  - emits: dashboardResponse omits both fields; app falls back with 'blocking_reasons ?? []'.
  - evidence: openapi.yaml:9813-9820 vs services/hg/internal/rider/handler.go:603-608. AvailabilityScreen.tsx:97 uses `data.data.blocking_reasons ?? []` so the absence degrades gracefully (banner never shows) — lat
- **setRiderAvailability** `PUT /v1/riders/me/availability` — other; blast: apps/rider/src/apiTypes.ts, apps/rider/src/screens/AvailabilityScreen.tsx
  - expects: RiderAvailability {availability_state, since, can_receive_offers, blocking_reasons(required), go_offline_after_delivery(optional)}. blocking_reasons carries machine codes so the app can deep-link to each unmet condition.
  - emits: RiderAvailability struct matches field-for-field, but service.SetAvailability always returns BlockingReasons:[]string{} on the 200 path (unmet conditions are surfaced only via the 422/403 error envelope, not on the success body).
  - evidence: openapi.yaml:9755-9782 vs services/hg/internal/dispatch/types.go:103-109 (shape correct) and service.go:100 (BlockingReasons hardcoded empty on success). Contract-shape-conformant; behavioural, no fie
- **reportRiderPositions** `POST /v1/riders/me/positions` — other
  - expects: 202 with RiderPositionAck {accepted:int32, rejected:[{index:int32, code:enum STALE_POINT|FUTURE_POINT|LOW_ACCURACY}], current_position_recorded_at:string|null}.
  - emits: RiderPositionAck struct and RejectedPoint match exactly; handler responds 202. No drift.
  - evidence: openapi.yaml:9859-9882 vs services/hg/internal/dispatch/types.go:169-180 and handlers.go:376 (StatusAccepted). Conformant — reported as clean.
- **getRiderEarningsSummary** `GET /v1/riders/me/earnings/summary` — other
  - expects: EarningsSummary {period, buckets[EarningsBucket], total:EarningsBucket, unpaid_balance_cents:Cents, next_payout_at:string|null, currency}; EarningsBucket all *_cents int64.
  - emits: EarningsSummaryDTO and EarningsBucketDTO match field-for-field; all money int64 *_cents, effective_cents_per_hour *int64. No drift.
  - evidence: openapi.yaml:10208-10258 vs services/hg/internal/payments/types.go:292-313. Conformant — reported as clean.
- **listRiderEarningEntries** `GET /v1/riders/me/earnings/entries` — other
  - expects: {data:[EarningEntry], meta:PageMeta}; EarningEntry {id,type,status,gross_cents,currency,formula_version,earned_at required; all *_cents int64; surge_multiplier as exact decimal string not float}.
  - emits: EarningEntryDTO matches field-for-field; all money int64 *_cents; surge_multiplier is string; RespondList wraps {data,meta}. No drift.
  - evidence: openapi.yaml:10151-10207 vs services/hg/internal/payments/types.go:269-289 and handlers.go:404 (RespondList). Conformant — reported as clean.
- **getConnectStatus** `GET /v1/connect/status` — wrong_nullability
  - expects: ConnectStatus.bank_last4: [string,'null'] — 'Display only' card/bank last4, optional and nullable. A partner that has completed onboarding with a bank account attached should surface bank_last4.
  - emits: Always null. ConnectRow (earnings_store.go:265-276) has no bank_last4 field at all, and the GetConnectAccount SELECT (earnings_store.go:283-284) does not read it; connectStatusFrom / GetConnectStatus never set ConnectStatusDTO.BankLast4, so it serializes as null unconditionally.
  - evidence: openapi.yaml:8847-8849 (bank_last4) vs services/hg/internal/payments/earnings_store.go:265-285 (ConnectRow + SELECT omit bank_last4) and services/hg/internal/payments/earnings.go:225-237 / connect.go:
- **getConnectStatus** `GET /v1/connect/status` — wrong_nullability
  - expects: ConnectStatus.requirements.deadline: [string,'null'] date-time — Stripe's requirements deadline surfaced verbatim to the partner.
  - emits: Always null. connectStatusFrom (connect.go:56-61) and GetConnectStatus (earnings.go:230-235) build ConnectRequirementsDTO without ever setting Deadline, even though the Stripe adapter parses acct.Requirements.CurrentDeadline (stripe.go:434-436). ConnectRow does not carry it and the SELECT does not read it.
  - evidence: openapi.yaml:8844-8846 (requirements.deadline) vs services/hg/internal/payments/connect.go:56-61 and earnings.go:230-235 (Deadline never assigned) and earnings_store.go:265-285 (ConnectRow has no dead
- **getHalalCertificate** `GET /v1/admin/halal-certificates/{certificateId}` — extra_field; blast: apps/admin/src/screens/HalalVerificationScreen.tsx
  - expects: The operation description (A-15) states support agents receive 'status, expires_on, the issuing body's name and the rejection reason AND NOTHING ELSE'. The HalalCertificate schema however has required:[id, restaurant_id, status, checklist_version, checks] and additionalProperties:false.
  - emits: renderCert() for a support-only principal emits id, restaurant_id, status, checklist_version, expires_on, checks:[], rejection_reason_code AND ALSO issuing_body:{id, name, status} (not name-only) plus restaurant_id, id, checklist_version. Every emitted field is contract-permitted and the schema-required fields (id, restaurant_id, checklist_version, checks) MUST be present, so the wire response validates against HalalCertificate. The 'nothing else' prose is stricter than the schema, and the schema wins for conformance. This is a redaction-tightness question (support agent sees issuing_body.id/status and cert id/restaurant_id/checklist_version beyond the prose), not a wire-shape drift — the response is schema-valid.
  - evidence: openapi.yaml:4506-4531 (getHalalCertificate description + HalalCertificate 200) and openapi.yaml:10413-10469 (HalalCertificate schema, required[] + additionalProperties:false) vs services/hg/internal/
- **createMenuItemOnBehalf** `POST /v1/admin/restaurants/{restaurantId}/menu/items` — extra_field
  - expects: MenuItemOwnerView is allOf(MenuItem + {category_id, live_version, pending_version, sort_order}); the base MenuItem does not name `restaurant_id`. No additionalProperties:false on the allOf base, so an extra field is schema-permitted but non-canonical.
  - emits: `menuItemOwnerView` emits `restaurant_id`, a field the composed schema does not name.
  - evidence: openapi.yaml:7459-7513 (MenuItem properties, no restaurant_id), openapi.yaml:9415-9435 vs services/hg/internal/admin/dto.go:440 (RestaurantID json:"restaurant_id").
- **getOrderAdmin** `GET /v1/admin/orders/{orderId}` — other
  - expects: OrderAdminView = OrderCustomerView (base) + admin fields. The operation description states the payload carries delivery address & instructions, dispatch_state, dispatch_history, rider, timeline generated from the same read model the customer app uses. Base OrderCustomerView optional fields include delivery_address, delivery_instructions, special_instructions, rider, dispatch_state, state_since, quote_id, eta_at, can_cancel, ready_at, picked_up_at, delivered_at, completed_at; the admin branch adds optional dispatch_history.
  - emits: `adminOrderView` omits all of: delivery_address, delivery_instructions, special_instructions, rider, dispatch_state, dispatch_history, state_since, quote_id, eta_at, can_cancel, ready_at, picked_up_at, delivered_at, completed_at. All contract-required fields (id, code, state, restaurant, lines, money, placed_at, timeline, payment, refunds, internal_money) are present, and OrderCustomerView has no additionalProperties:false, so omission is schema-legal — but the support 'complete order picture' (delivery address, dispatch history) is absent.
  - evidence: openapi.yaml:8189 (OrderCustomerView required), openapi.yaml:8218-8266 (optional fields), openapi.yaml:10711-10759 (OrderAdminView admin fields incl dispatch_history) vs services/hg/internal/admin/dto
- **cancelOrderAdmin** `POST /v1/admin/orders/{orderId}/cancel` — other
  - expects: Returns OrderAdminView with the same base OrderCustomerView optional fields (delivery_address, rider, dispatch_state, etc.).
  - emits: Same `adminOrderView` struct — the base OrderCustomerView optional fields are omitted.
  - evidence: openapi.yaml:1017-1027 (200 -> OrderAdminView), openapi.yaml:8189-8266 vs services/hg/internal/admin/dto.go:393-409, handler_orders.go:328-362.
- **createUpload** `POST /v1/uploads` — other
  - expects: PresignedUpload.required_headers is described as the headers the client must send verbatim, explicitly naming Content-Type, Content-Length AND x-amz-checksum-sha256 as the headers the signature binds — the checksum header is what makes a 1 MiB JPEG signature unusable to push a 9 MiB PDF (openapi.yaml:8772-8779).
  - emits: The handler populates required_headers with only {Content-Type, Content-Length}; no x-amz-checksum-sha256 entry, and PresignedPutObject (store.go:101) binds only bucket/key — the SHA-256 is never bound into the signature (services/hg/internal/files/store.go:107-110).
  - evidence: openapi.yaml:8772-8779 vs services/hg/internal/files/store.go:107-110. required_headers is typed additionalProperties:string, so the map CONTENTS are not schema-constrained — this is a functional/secu
- **getRealtimeSchema** `GET /v1/realtime/schema` — other
  - expects: RealtimeSchemaBundle.events keyed {type}@v{version}, each value a JSON Schema for that payload; the operation exists (P-22) so a field rename in a payload cannot silently break four apps — i.e. the per-event schemas must describe the payload's fields.
  - emits: schemaBundle() emits, for every catalogue type, a permissive stub schema {"type":"object","additionalProperties":true} (schema.go:16-34 objectSchema()). No field is described; a rename of any payload field would pass this endpoint unchanged. The code's own TODO admits the per-type schemas are 'the object shape, not the field list'.
  - evidence: openapi.yaml:868-889 (getRealtimeSchema / RealtimeSchemaBundle 6879-6892) vs services/hg/internal/realtime/schema.go:16-34. Structurally conformant because the contract's events values are additionalP
- **connectWebSocket** `GET /v1/ws (hello control frame)` — wrong_nullability
  - expects: websocket.md §4.1 hello.data.roles is [{r: Role, s: uuid|null}] — the scope id s is populated for role grants that are scoped (e.g. RESTAURANT-scoped staff roles carry their restaurant scope_id).
  - emits: sendHello() builds every helloRole with S: nil unconditionally (send.go:53-56); the roles come from rolesFromSnapshot which decodes only the r token and discards any scope (handlers.go:215-234). So a scoped restaurant/rider role's scope id is always emitted null in hello.
  - evidence: websocket.md:198 (hello roles [{r,s}]) and packages/api-client/src/realtime.ts:54 (roles: Array<{r,s: string|null}>) vs services/hg/internal/realtime/send.go:53-56 and handlers.go:223-231. Data-comple