# Admin console — design audit and redesign brief

_Halal Goes admin web (`apps/admin`). Audit performed Sep 2026 against `docs/design/*`,
`docs/spec/05-admin.md`, `contracts/openapi.yaml` and every file under `apps/admin/src`.
No code was changed._

---

## 0. Scope, method, and the constraints I am designing inside

**Read, in order:** `AGENTS.md` · `docs/design/01-foundations.md`, `02-components.md`,
`03-patterns.md`, `04-accessibility.md` · `docs/design/admin-order-detail.md`,
`support-desk.md`, `handoff-verification.md` · `docs/spec/05-admin.md` (A-15 at
`05-admin.md:962`–`1080`, the feature table at `:2909`) · `contracts/openapi.yaml` (the
`/v1/admin/*` surface, `:4402`–`:5442`) · all 10 screens, 3 components and 7 lib modules in
`apps/admin/src`, plus the two `@hg/ui-web` components the admin app leans on hardest
(`HalalChecklist`, `DataTable`) and the ones it does not use at all.

**What is frozen, with the values.**

*Density.* `docs/design/tokens.json` carries exactly three density modes:

| mode | `rowHeight` | `cardPadding` | `gutter` |
|---|---:|---:|---:|
| `compact` | **44** | **12** | **12** |
| `comfortable` | 64 | 16 | 16 |
| `roomy` | 72 | 20 | 20 |

The **admin register is `compact` — 44 / 12 / 12** per `01-foundations.md:417` (§10: the
`operational` theme covers "restaurant web, admin web … `compact` density"), §4's density
table (`01-foundations.md:291`, "compact → restaurant queue, **admin tables**"), and
`03-patterns.md:356` ("# 4. Admin surface (`operational` theme, `compact` density)").

**The built app does not run that.** The generated theme declares admin as `comfortable`:
`packages/ui-web/src/tokens/themes.ts:1384`–`1394` (`"density": "comfortable"`, metrics
`64/16/16`), with a header note at `themes.ts:9`–`17` inventing a two-tier rule — admin
"runs `comfortable` and drops to `compact` inside table regions via
`[data-hg-density="compact"]`". `themeAttributes('admin')` (`themes.ts:2761`–`2771`)
therefore stamps `data-hg-density="comfortable"` on the admin wrapper at `App.tsx:83` and
`App.tsx:183`, and `App.tsx:31` asserts "comfortable density" as the intent.

This is an unreconciled contradiction between a frozen token file plus two design documents
and the generated theme, and it needs a `docs/decisions/` entry either way. **This brief
specifies compact (44/12/12) for every table, queue and chrome region, and names the one
place I argue for comfortable padding on purpose** (§4.3) — using the existing
`comfortable` token, not a new value.

*Other frozen values I use below, all from `tokens.json`:* `space.1..24` = 4/8/12/16/20/24/32/40/48/64/80/96 ·
`radius.xs 4 · sm 8 · md 12 · lg 16` · `target.min 44`, `target.spacing 8` ·
`icon.sm 16 · md 20 · lg 24 · xl 32` · type steps `heading.lg 20/26 · heading.sm 16/22 ·
body.md 15/22 · body.sm 13/19 · label.md 13/16 · label.sm 11/14 · caption 12/17 ·
mono.md 13/19` · the halal namespace `color.halal.certified.seal #0F7A43`,
`certified.ring #C9A24B`, `certified.tint #E9F3E4`, `expired.seal #4E5862`,
`expired.tint #EDEFF1`, `unverified.border #B6AEA1` (dashed), `expiring.tint #FBF1D8`.

*Components.* Frozen. Everything I propose composes what already ships in `@hg/ui-web`.
Note two gaps that constrain the brief: **`Sheet` and `Modal` do not exist** in `ui-web`
(`03-patterns.md:360` calls for a `Sheet variant="side"` for admin row detail — there is no
such component; `AppShell`'s `aside` region is the available substitute), and **`Countdown`
does not exist** (specified at `02-components.md:555`, no file in `packages/ui-web/src`).

---

## 1. Per screen

### 1.0 `App.tsx` — shell, navigation, and the sign-in gate

**Purpose.** Frame every screen; gate the console behind email + password + TOTP.

**What it renders.** `LoginGate` (`App.tsx:62`–`137`): a single `Card` with three `Input`s
and a submit `Button`. Then `AdminShell` (`App.tsx:177`–`210`): `AppShell` +
`SideNav` with six items (`App.tsx:49`–`56`) and a `Routes` block of ten routes
(`App.tsx:191`–`205`).

**Problems.**

1. **The most important screen in the product has no place in the information
   architecture.** `NAV` (`App.tsx:49`–`56`) is Restaurants · Riders · Orders · Refunds &
   disputes · System · Staff. Halal verification is reachable only as
   `/certificates/:certificateId` (`App.tsx:194`–`197`), and the only link to it is a
   `Button` buried in a card two thirds down the application detail screen
   (`ApplicationDetailScreen.tsx:255`). There is **no halal queue**: an admin cannot ask
   "which certificates are waiting on me", cannot see expiring certificates (A-17), and
   cannot reach the instrument without first picking a restaurant. `03-patterns.md:360`
   names four queues with saved views — "onboarding, **halal**, refunds, cases"; and
   `03-patterns.md:412` specifies the halal screen's own empty state as "*No pending
   certificates* → the drained state, plus a link to the **halal register**". Neither the
   queue nor the register exists.
2. **`AppShell`'s admin affordances are all left unused.** `AppShell` accepts
   `skipTargets`, `pageHeader`, `aside`, `systemBanner`, `density`
   (`packages/ui-web/src/navigation/AppShell.tsx:33`–`57`). `App.tsx:184`–`189` passes
   `sideNav`, `routeKey`, `routeAnnouncement`, `className` and nothing else. Consequences:
   `04-accessibility.md:184` requires "Admin adds 'Skip to table'" — it is never added, so
   every queue screen makes a keyboard user tab the whole nav to reach a grid; there is no
   sticky page header for filters (`03-patterns.md:360`); there is no `aside` region, which
   is the only side-detail mechanism the library actually has.
3. **Icons are knowingly wrong and the comment says so.** `App.tsx:42`–`47` documents that
   none of the six nav icons is a literal match and picks "the closest legible stand-in" —
   `bell` for Refunds & disputes, `check` for System, `home` for Restaurants. `check` for
   System is the worst of these: on the one surface where a tick mark means "this check
   passed", a tick is spent on a nav label.
4. **`LoginGate` names a raw colour.** `App.tsx:124` —
   `color: 'var(--hg-feedback-danger-text, #9E1E23)'`. `styles.css:4` claims "this app never
   names a colour"; this is the exception, and the fallback hex is exactly the class of
   literal that lint L-1/L-2 exists to prevent. `ErrorState`/`Banner` already carry that copy.
5. **No session state beyond a bearer token.** `lib/token.ts:10` holds the access token in a
   module variable; a reload signs the admin out (`token.ts:1`–`9` claims this as intended).
   There is **no `/v1/me`, no role anywhere in the client** (grepped: `src/lib`, `src/App.tsx`
   contain no role concept). Every screen therefore renders every control to every staff
   role and lets the server refuse — see §1.3 problem 12 for why that is dangerous on the
   halal screen specifically.
6. `styles.css:74`–`78` caps `.adm-main` at `max-width: 72rem` centred. That is a reading
   measure for a document, not an operations console; it throws away the horizontal space a
   two-pane evidence layout needs on the one screen that needs it most.

---

### 1.1 `OnboardingQueueScreen.tsx` — restaurant onboarding queue (A-13)

**Purpose / the admin's job.** "Give me the next restaurant application I should review,
oldest first, and tell me which ones have breached SLA."

**What it renders.** An `h1`, a one-line description, and a `KeysetGrid` with six columns —
Restaurant, City, State, Submissions, Submitted, SLA (`:63`–`75`). SLA is a `Chip` reading
"SLA breached" / "On track", tone warning/neutral (`:34`–`37`). Row click →
`/applications/:restaurantId` (`:95`).

**Problems.**

1. **`take-next` is never called, so the queue permits cherry-picking.**
   `contracts/openapi.yaml:4512` defines `POST /v1/admin/restaurant-applications/take-next`:
   "`SELECT … FOR UPDATE SKIP LOCKED`, so two admins pressing this simultaneously receive
   different applications. The claim locks the application to that admin for 60 minutes …
   a stale decision attempt is `409 REVIEW_LOCK_LOST`. **There is no cherry-picking.**" The
   screen offers no such control; `onRowActivate` (`:95`) lets any admin open any row.
2. **The two fields that would make a collision visible are not rendered.**
   `RestaurantApplicationSummary` carries `assigned_admin_id` and
   `review_lock_expires_at` (`openapi.yaml:11038`–`11043`). Neither is a column
   (`:63`–`75`). Two admins looking at the same queue cannot tell that a row is claimed, by
   whom, or for how much longer.
3. **No filters at all**, though the endpoint takes `state[]` and `sla_breached`
   (`openapi.yaml:4477`–`4493`) and `FilterBar` ships in the library
   (`packages/ui-web/src/data/FilterBar.tsx:46`, including `savedViews`). `:47`–`49` sends
   only `limit` and `cursor`.
4. **Two of the three empty states specified do not exist.** `03-patterns.md:362`–`365`
   requires three distinct copies: no records / filtered-to-nothing / **queue drained** ("a
   *positive* state with the last-processed timestamp, so an admin can tell 'done' from
   'broken'. This distinction is the whole reason the three cases are separated"). The screen
   ships one: "Queue is empty / No restaurant applications are waiting on review right now"
   (`:97`–`98`).
5. **SLA is styled as a status chip, not as time.** `sla_due_at` is a timestamp; the screen
   reduces it to a boolean (`:35`) evaluated once at render — `Date.now()` in a pure render
   function, so a row does not flip to breached while an admin watches. The contract's own
   note on that field is load-bearing: "**There is no auto-approval on breach, ever**"
   (`openapi.yaml:11048`) — which makes remaining-time the operational quantity, not
   breached/not-breached.
6. `onboarding_state` renders raw (`:71`): `DOCUMENTS_REVIEW`, `PENDING_SUBMISSION`. The app
   has an `enumLabel` helper (`lib/format.ts:43`) and uses it in the rider queue (`RiderQueueScreen.tsx:56`).

---

### 1.2 `ApplicationDetailScreen.tsx` — one restaurant application (A-13/A-14/A-18)

**Purpose / the admin's job.** "Is this business who it says it is, are its documents in
order, and should it be approved?"

**What it renders.** Back button, `h1` + state line, a prominent warning `Banner` listing
blockers (`:175`–`188`), a Business identity `Card` (`:190`–`215`), a read-only `DataTable`
of documents (`:221`–`235`), and a Halal certification `Card` with five fields and the link
into the seven-check instrument (`:238`–`266`).

**Problems.**

1. **There is no decision.** `POST /v1/admin/restaurant-applications/{restaurantId}/decision`
   exists (`openapi.yaml:4572`) and the rider equivalent is fully built
   (`RiderApplicationDetailScreen.tsx:215`–`251`). This screen has no approve, no reject, no
   `ConfirmDialog`. A-18 — "Restaurant approval / rejection decision", V1, on the critical
   path (`05-admin.md:2945`) — is unbuilt, so the restaurant funnel dead-ends here.
2. **Documents cannot be reviewed, or even seen.**
   `POST /v1/admin/restaurant-documents/{documentId}/review` exists
   (`openapi.yaml:4621`: "Each document is reviewed independently, with a structured reason
   code (never a browser `prompt()`)"). The table (`:61`–`94`) is five read-only columns with
   no row actions and **no viewer** — `DataTable` supports `rowActions`
   (`packages/ui-web/src/data/DataTable.tsx:76`) and `DocumentViewer` ships
   (`packages/ui-web/src/data/DocumentViewer.tsx:44`). A-14 is unbuilt and
   `03-patterns.md:373` (§4.2 Document review: "The document is always visible while
   reviewing — a reviewer must never scroll away from the evidence to record a decision")
   is unimplemented on this surface.
3. **`address_pin_warning` is dropped.** `openapi.yaml:11070` — "Soft warning when the map
   pin is more than 5 km from the postal-code centroid." The screen renders coordinates as
   bare numbers (`:206`–`213`) and never surfaces the warning. Coordinates are an onboarding
   gate precisely because a geo split-brain "killed every checkout at rider assignment"
   (`openapi.yaml:4471`).
4. **The halal card understates the one claim the business runs on.** Five `DetailRow`s and
   a `Chip label={cert.status}` (`:251`). Nothing shows how many of the seven checks are
   recorded, or which. An admin cannot tell from here whether this certificate is untouched
   or six-sevenths done — which is exactly the state they need to decide whether to pick it up.
5. **A generic `Chip` renders a halal status.** `:251` uses `tone={cert.status === 'APPROVED'
   ? 'neutral' : 'warning'}`. `HalalBadge` exists for this with a `surface: 'operational'`
   variant, fixed reviewed copy, four glyph forms, and — critically — it renders **nothing**
   on an absent state (`packages/ui-web/src/certification/HalalBadge.tsx:33`–`47`,
   `:63`–`75`). Routing a halal state through `Chip` bypasses RULE H-2
   (`01-foundations.md:170`: "A halal state is never 'a colour'. It is always
   `{fill, ring, glyph, label}` shipped as one token group and one component (`HalalBadge`)").
6. Blockers render through `JSON.stringify` as a last resort (`:183`), though the contract
   types them as `string[]` (`openapi.yaml:11065`–`11069`). Defensive code that can print a
   JSON blob into a prominent warning banner.
7. `DataTable` is given no `onSortChange`, no `density`, no `stickyFirstColumn`
   (`:221`–`235`), so `aria-sort` — required by `04-accessibility.md:239` for admin — never
   appears on this table.

---

### 1.3 `HalalVerificationScreen.tsx` + `HalalChecklist` — the seven-check instrument (A-15) ★

**Purpose / the admin's job.** Decide whether a certificate passes H1–H7, and therefore
whether the platform will vouch, in public, for this kitchen's food. This is the screen the
business cannot survive getting wrong.

**What it renders.** `HalalVerificationScreen.tsx:138`–`215`: a Back button, `h1` "Halal
verification", one paragraph of rules (`:147`–`150`), a "Certificate under review" `Card`
with four fields (`:180`–`202`), then `HalalChecklist` (`:204`–`211`).
`HalalChecklist` (`packages/ui-web/src/certification/HalalChecklist.tsx:249`–`327`) renders a
heading, a permanent audit note, a `TranscribedFields` definition list of seven fields
(`:660`–`691`), an `<ol>` of seven `fieldset` rows, then the decision footer. Everything is a
**single column** stacked vertically inside the 72rem `.adm-main`.

The component's internal discipline is genuinely good and I want to say so before the
criticism: the approve affordance cannot be rendered without a `HalalApprovalGate` that only
`openApprovalGate` mints (`:305`–`309`, `:334`–`343`), so approval-without-seven-passes is a
type error rather than a review comment; H5/H7 render read-only with a lock glyph and no
control at all, and `HalalCheckRecordInput.checkKey` is typed `OverridableCheckKey` so
submitting one will not compile (`:49`–`57`, `:542`–`556`); the ≥20-character override note
is blocked *with an explanation* rather than silently disabled (`:220`–`228`); the audit
notice is permanent (`:259`–`262`). That is the right instinct in the right place.

The problems are everything around it.

1. **★ The certificate document is nowhere on the screen.** No `DocumentViewer`, no
   presigned fetch, no link, no thumbnail — confirmed by grep across `apps/admin/src`. But
   every piece needed is already in place: `HalalCertificate.document_id` is on the payload
   (`openapi.yaml:11140`–`11143`), `GET /v1/documents/{documentId}/download-url`
   (`operationId: createDocumentDownloadUrl`) mints a 120-second audited presign
   (`openapi.yaml:2628`–`2660`), and `DocumentViewer` implements the expiry-is-the-expected-path
   behaviour, the no-cache blob path and the audit notice
   (`packages/ui-web/src/data/DocumentViewer.tsx:1`–`74`).

   The consequence is not cosmetic. Four of the seven checks are *defined as* comparisons
   against the document (`05-admin.md:978`–`986`): H1 "the scan is legible, all pages
   present, no visible alteration"; H3 `certified_legal_name` vs the registered legal name;
   H4 `certified_address` vs the premises address; H6 whether `scope` covers what will be
   sold. **On this screen an admin can record all four without ever seeing the evidence any
   of them refers to.** H1 is not merely hard — it is unanswerable: there is no scan to call
   legible. `03-patterns.md:373` states the principle for the lesser case of ordinary KYC:
   "a reviewer must never scroll away from the evidence to record a decision." Here there is
   no evidence to scroll to.

2. **★ The transcription step does not exist.** A-15's behaviour opens with it: "When an
   admin opens the halal panel they must **transcribe, from the uploaded certificate**, six
   structured fields … plus `scope`" and "Nothing here is inferred, OCR'd or auto-approved"
   (`05-admin.md:966`–`974`). `PUT /v1/admin/halal-certificates/{certificateId}/transcription`
   (`operationId: transcribeHalalCertificate`) is in the contract
   (`openapi.yaml:4688`–`4722`) and is **never called** by the app (grep: the screen calls
   only `…/checks` at `:73` and `…/decision` at `:105`). `TranscribedFields`
   (`HalalChecklist.tsx:660`–`691`) *displays* seven values read-only; nothing writes them.

   So the fields against which H2–H7 are computed arrive from somewhere the UI does not show
   and the admin cannot correct. There is no `issuing_body_id` `Select` — the registry that
   makes H2 meaningful (`openapi.yaml:4822`, `/v1/admin/halal-issuing-bodies`; the three
   accepted bodies are settled as HMA Canada, HFSAA, ISNA Canada in
   `docs/decisions/README.md:23`) is never rendered, and the contract is explicit that "free
   text is not permitted, because a free-text issuer field makes the badge meaningless"
   (`openapi.yaml:4695`). H5 and H7 — the two uncomputable-by-hand checks — are derived from
   `issued_on`/`expires_on` and `(issuing_body_id, certificate_number)`; if those were
   transcribed wrong, **H5 and H7 are confidently wrong and un-overridable**, and this screen
   gives the admin no way to fix the input.

3. **★ The claim has no referent on screen.** H3 compares the certified name to "the
   restaurant's registered legal name or a recorded alias"; H4 compares the certified address
   to "the onboarding premises address". Neither referent is on this screen. The restaurant's
   `profile.legal_name` and `profile.address` live on the *other* route
   (`ApplicationDetailScreen.tsx:192`, `:196`–`205`). The screen does not even print the
   restaurant's name: the header is the literal string "Halal verification"
   (`HalalVerificationScreen.tsx:144`–`146`) and the four-field card shows
   `certified_legal_name` — the claim — with nothing to compare it to
   (`:186`–`188`). **An admin recording H3 and H4 is working from memory or a second browser
   tab.** That is the definition of a check that will drift.

4. **★ Recording one check destroys the notes typed for the others.** `record()` writes a
   single check then calls `reload()` (`HalalVerificationScreen.tsx:79`–`90`). `useLoad`'s
   `run` resets to `{status:'loading', data:null}` (`lib/load.ts:56`–`57`), and the screen
   renders the checklist only under `status === 'ready' && data`
   (`HalalVerificationScreen.tsx:178`). So every record **unmounts `HalalChecklist`** — and
   its `drafts` / `rowErrors` state (`HalalChecklist.tsx:126`–`127`) goes with it. An admin
   who works the way the screen is laid out (read down, fill in seven rows, then submit)
   loses six notes on the first "Record H1", with no warning and no recovery. Those notes are
   not incidental: A-15 R5 makes a ≥20-character note *mandatory* for any human override and
   "surfaced in the halal register report" (`05-admin.md:1043`–`1045`). The interaction
   actively punishes the behaviour the rule depends on.

   The same reload also flashes the entire screen to eight `Skeleton` blocks
   (`:152`–`159`) seven times per certificate, and violates `04-accessibility.md:170`
   ("Focus is never moved on a data refresh") by destroying and recreating the focused control.

5. **★ Approve is one unconfirmed click, and it is the cheapest action on the screen.**
   `HalalApproveAction` (`HalalChecklist.tsx:345`–`367`) is a `<button>` with an
   `onClick={() => onApprove(gate)}` and no confirmation. `HalalVerificationScreen.tsx:124`–`127`
   fires the decision immediately. Meanwhile **reject** demands a reason code from a closed
   enum *and* ≥20 characters of text (`HalalChecklist.tsx:233`–`247`). The friction is
   inverted: the action that publishes a halal claim to the public is one click, and the
   action that withholds one takes two fields.

   `ConfirmDialog` ships, is used twice elsewhere in this very app
   (`RiderApplicationDetailScreen.tsx:231`, `OrderDetailScreen.tsx:344`), has a `children`
   slot documented for exactly this ("Extra content — a `StatusTimeline`, a `Countdown`, an
   affected-record summary", `packages/ui-web/src/feedback/ConfirmDialog.tsx:61`) and even
   carries a comment pointing at this feature ("`noteMinLength` > 0 makes it mandatory
   (A-15 R5 uses 20)", `ConfirmDialog.tsx:57`). It is not used on the approve path.

6. **Approve appears in the same place the blocking notice was, with no transition.** The
   footer swaps `OutstandingNotice` for a filled primary button at the same position
   (`HalalChecklist.tsx:305`–`309`). The seventh pass turns a paragraph into a live,
   irreversible-in-effect control under the pointer, one render after a full-screen skeleton
   flash (problem 4). That is a click-through geometry.

7. **The outstanding notice speaks in abbreviations.** "Approval is unavailable: 2 checks are
   outstanding — H1, H6" (`HalalChecklist.tsx:375`, `:384`). `02-components.md:254` asks for
   exactly this, so the component is compliant — but at the moment an admin is blocked, "H1,
   H6" requires them to scroll and decode. The keys are also not links, so there is no way
   to jump to the row that is blocking.

8. **PASS and FAIL are visually identical once selected.** Both radio items resolve to
   `data-[state=checked]:bg-control-selected-bg` with a `✓` indicator and the word
   (`HalalChecklist.tsx:573`–`590`). Not-by-colour-alone is satisfied; *glanceability* is
   not. There is no per-row state summary and no roll-up, so a mis-set radio four rows up is
   invisible, and an admin cannot see "5 pass, 1 fail, 1 not assessed" anywhere on the screen.

9. **The two locked checks are under-marked relative to their power.** H5/H7 get
   `border-line-interactive bg-surface-subtle`, a 16px lock glyph and the words
   "Server-computed · not overridable" inside the legend (`HalalChecklist.tsx:520`–`535`,
   `:693`–`710`). That is a subtle border swap in a column of seven otherwise-identical
   cards. These are the two checks that stop an expired certificate and a certificate reused
   at another restaurant — `03-patterns.md:418` says so in terms: "**The admin may not
   proceed with an unevaluated H5 or H7** — these are the two checks that protect against
   expired and duplicate certificates, and a design that lets them be skipped under load is
   how a bad certificate gets approved." The visual hierarchy does not reflect that.

10. **No per-check loading or per-check error state.** `03-patterns.md:416`–`418` requires
    the checklist to render immediately with all seven rows while "only the system-computed
    results (H2/H3/H5/H7) show inline skeletons", Approve disabled *and saying so* while any
    computed check is still loading, and a computed check that fails to evaluate showing an
    error on that row. The implementation has one screen-level loading state
    (`HalalChecklist.tsx:152`–`171`) and one screen-level error
    (`:173`–`198`) — there is no representation of "H7 could not be computed", so an
    unevaluated H7 is indistinguishable from `NOT_ASSESSED`.

11. **A server-side `422 CHECK_FAILED` / `CHECKLIST_INCOMPLETE` lands in a toast and
    disappears.** `HalalVerificationScreen.tsx:116` shows `{variant:'danger', title:'Decision
    failed'}`. `03-patterns.md:418` requires "the named keys are highlighted inline and focus
    moves to the first one". Nothing is highlighted; the named keys in `details` are dropped.

12. **The screen is blind to the viewer's role, and the failure mode is a fully-armed
    instrument full of em-dashes.** `HalalChecklist` has a `readOnly` prop documented for
    exactly this — "Support agents may read status and outcome but may not record or decide
    (A-15 Role)" (`HalalChecklist.tsx:78`–`82`) — and `HalalVerificationScreen.tsx:204`–`211`
    never passes it. Per A-15 AC5 (`05-admin.md:1054`–`1056`) a support agent's GET returns
    `status`, `expires_on`, `issuing_body_name`, `rejection_reason_code` "**and nothing
    else** — no `document_id`, no `certified_address`, no check notes". So a support agent
    sees the seven-check console with every field rendered as "—" (the `?? '—'` fallbacks at
    `:187`–`199` and `HalalChecklist.tsx:666`–`675`), seven live radio groups, seven Record
    buttons, and a reject panel — all of which will 403. The UI teaches the least-trained
    role that the instrument is broken.

13. **The four-field summary card duplicates the transcription block and adds nothing.**
    `HalalVerificationScreen.tsx:180`–`202` shows Certified name / Issuing body / Certificate
    no. / Status; `TranscribedFields` (`HalalChecklist.tsx:665`–`676`) shows the same three
    plus address, dates and scope. Two renderings of the same facts, neither of which is the
    comparison the checks need. `status` prints raw (`:199`) — `PENDING`, not "Pending".
14. `404` detection is string-matched on `error.code === '404' || 'NOT_FOUND'`
    (`:162`), where `toAsyncError` sets `code` from the error envelope
    (`lib/load.ts:24`–`27`) — a transport-level 404 arrives as `TRANSPORT_ERROR` and falls
    to the generic `ErrorState`, so the "Certificate not found" empty state (`:163`–`167`)
    is unlikely to render in practice.
15. **The record button label is an abbreviation with no verb object**: "Record H1"
    (`HalalChecklist.tsx:630`). Seven buttons, all reading like a form field id.

---

### 1.4 `RiderQueueScreen.tsx` — rider onboarding queue (A-23)

**Purpose.** Same shape as §1.1 for riders.

**What it renders.** Grid of Rider / Vehicle / State / Attempt / Submitted / SLA (`:54`–`61`).

**Problems.** All of §1.1's, identically, against the same contract affordances:
`POST /v1/admin/rider-applications/take-next` exists (`openapi.yaml:4975`) and is unused;
no filters; one empty state where three are specified (`:83`–`84`); `onboarding_state` raw
(`:57`) while `vehicle_type` gets `enumLabel` (`:56`) — inconsistent within one column set;
SLA again a render-time boolean (`:26`). The file also duplicates
`OnboardingQueueScreen`'s fetch/state machine verbatim (`:35`–`52` vs `:44`–`61`) — a
maintenance risk for two screens that must behave identically and currently diverge in
small ways.

---

### 1.5 `RiderApplicationDetailScreen.tsx` — one rider application (A-23)

**Purpose / the admin's job.** "Is this person eligible, 18+, with valid documents and a
vehicle?" — and decide.

**What it renders.** Back, header, an under-18 `Banner` (`:153`–`160`), a blockers `Banner`
(`:162`–`175`), Identity and Vehicle `Card`s, a documents `DataTable` (`:203`–`212`), an
approve/reject action row gated on `onboarding_state === 'DOCUMENTS_REVIEW'` (`:215`–`229`),
and a `ConfirmDialog` for reject with reason codes and a 10-character mandatory note
(`:231`–`251`).

**This is the best-built screen in the app** — it is the only one with a complete
decision loop, and the under-18 banner correctly frames a server-computed value as
non-overridable (`:158`). Problems are narrower:

1. **Approve has no confirmation and fabricates its own audit trail.** `:111`–`122` sends
   `{decision:'APPROVE', reason_code:'OTHER', reason_text:'Approved on review.'}` — a
   hard-coded reason on a one-click button (`:217`–`224`), while reject gets a full
   `ConfirmDialog`. The contract requires a reason on every state-changing admin action
   precisely so the record means something (`openapi.yaml:11077`–`11080`); a constant string
   satisfies the validator and defeats the purpose. Same inverted friction as §1.3 problem 5.
2. **Documents cannot be seen or reviewed.** Three read-only columns (`:48`–`63`), no
   `rowActions`, no `DocumentViewer`, while
   `POST /v1/admin/rider-documents/{documentId}/review` exists (`openapi.yaml:5076`). An
   admin approves a rider's licence and insurance without looking at them.
3. `data.profile.email` is rendered in the clear (`:179`) with no `PiiCell` and no
   justification capture, though `PiiCell` ships for this (`packages/ui-web/src/data/PiiCell.tsx:29`–`44`)
   and A-42 governs it.
4. The reject `ConfirmDialog` uses `noteMinLength={10}` (`:240`) against the contract's
   `reason_text` minimum of 10 (`openapi.yaml:11090`) — correct here, but note it differs
   from A-15's 20, and neither value is shared from one place.

---

### 1.6 `OrdersAdminScreen.tsx` — cross-tenant order lookup (A-38 / A-42)

**Purpose.** "Find the order the customer is phoning about."

**What it renders.** An `h1`, a note that every read is audited, an `Input` + a bespoke
`<button className="adm-nav-link">` labelled Search (`:85`–`103`), and a five-column grid
(`:67`–`73`).

**Problems.**

1. **The search affordance is not a button.** `:92`–`102` is a raw `<button>` wearing
   `.adm-nav-link` — a class `styles.css:38`–`39` admits is a leftover nav style. Its
   `min-height` is unset, so it does not meet `target.min 44`
   (`04-accessibility.md:66`), and it sits next to a real `Button` component that would.
2. **One search field, three specified inputs.** `03-patterns.md:424` — "Search by order
   number/**phone**/**email**". Only `code` is wired (`:50`). There is no state filter
   despite the file's own header comment describing one ("A code search **and a state
   filter** both reset the cursor stack", `:8`) — the filter was designed, documented and
   not built.
3. **The error copy for no-match is the wrong event.** `:117` — "No orders match this
   search. Clear the code filter to see the full queue" is shown for *both* an empty table
   and a filtered-to-nothing table, because `KeysetGrid` has one empty state. Patterns
   §4.1 and §4.4 both require these be distinct, and §4.4 asks for the accepted formats to
   be listed on a no-match.
4. **The screen's own promise about PII is false.** `:3`–`5`: "nothing here masks or unmasks
   — that only happens on the detail screen's justified reveal." The detail screen has no
   reveal (§1.7 problem 2). A-42 masking exists nowhere in the app.
5. `stateChip` collapses all 14 order states into terminal/non-terminal
   (`:30`–`34`) and prints them raw (`FAILED`, `AWAITING_RESTAURANT`). `StatusTimeline`
   already owns the full admin vocabulary
   (`packages/ui-web/src/feedback/orderStateVocabulary.ts`) and is used two screens over.

---

### 1.7 `OrderDetailScreen.tsx` — the full order view (A-38, `admin-order-detail.md`)

**Purpose / the admin's job.** "Everything about this order, and the ability to act on it or
reach anyone involved."

**What it renders.** Back, header with code + state chips + placed-at + a deadline string
(`:205`–`217`); then the two-column `.adm-order-layout` — left: `LiveMapBox`, Customer,
Restaurant, Rider cards (`:220`–`264`); right: `StatusTimeline`, Items, Money, Refunds,
Actions (`:266`–`341`); then a cancel `ConfirmDialog` (`:344`–`372`), a "Linked case" card
(`:374`–`383`), an inline refund form (`:385`–`414`) and a `DISPUTED` banner (`:416`–`423`).

**Problems.**

1. **The cancel flow cannot be completed.** `ConfirmDialog` is a Radix `AlertDialog` with a
   portal and a full-viewport scrim at `z-modal`
   (`packages/ui-web/src/feedback/ConfirmDialog.tsx:145`–`148`, `:159`). The "Support case
   ID" `Input` that `onConfirm` **requires** — `if (!caseId.trim()) throw new Error('A
   support case ID is required to link this cancellation.')` (`:356`–`358`) — is rendered in
   the page body *behind* that scrim, conditional on the same `cancelOpen` flag
   (`:374`–`383`). The field is unreachable while the dialog it gates is open, so the dialog
   can only ever throw. The fix is the slot the component already provides
   (`ConfirmDialog.tsx:61`, `children`).
2. **No PII, no contact, no reveal — the design spec's central ask is absent.**
   `admin-order-detail.md` §"Parties & contacts (all three)" requires name, phone, delivery
   address and order-history count for the customer; name, phone, address, halal status and
   prep state for the restaurant; name, phone, vehicle, rating and current leg for the rider;
   "Contact affordances (call / message)"; and audited PII access. The screen renders a city
   and a street line (`:230`–`237`), a restaurant name (`:243`), and
   `first_name` + `last_initial` + vehicle type (`:255`–`258`). **No phone number, no contact
   control, no `PiiCell`, no justification, no history count, no rating, no prep state.**
   Support cannot do the one thing this screen was specified to enable.
3. **The "live" map is a still.** There is no WebSocket, `EventSource` or poll anywhere in
   `apps/admin/src` (grepped). `LiveMapBox` receives coordinates from a single GET
   (`:186`–`193`) and `useLoad` never refetches (`lib/load.ts:68`–`70`), yet the component's
   own header claims "Rider position is live over the realtime channel where available"
   (`LiveMapBox.tsx:6`–`7`) and a pin is labelled "Rider (live)" (`:189`).
   `admin-order-detail.md` requires "rider location + state stream over the existing
   **WebSocket** realtime channel" with a last-known fallback. The label is a claim the code
   does not honour.
4. **The deadline countdown does not count.** `formatCountdown`
   (`lib/format.ts:29`–`41`) defaults `now = new Date()` evaluated once per render; there is
   no ticker. `:215` and `:224` therefore print a frozen "12m left" that stays "12m left".
   `admin-order-detail.md` asks for "a prominent **ETA + `deadline_at` countdown**", and
   invariant 4 makes `deadline_at` the mechanism by which nothing waits forever. A frozen
   countdown is worse than none: it reads as fresh.
5. **A halal state is rendered as a neutral `Chip`, always.** `:244`–`248`:
   `<Chip label={enumLabel(data.restaurant.halal.display_state ?? 'UNKNOWN')} tone="neutral" />`.
   Three faults in one line. (a) `HalalBadge surface="operational"` exists for precisely this
   and is bypassed, so RULE H-2's composite `{fill, ring, glyph, label}` is reduced to a grey
   outline (`01-foundations.md:170`). (b) `CERTIFIED` and `EXPIRED` render **identically** —
   same tone, same shape, differing only in a word — which honours "never red" while
   destroying the distinction that matters to an admin handling a halal complaint.
   (c) When `display_state` is absent the `?? 'UNKNOWN'` fallback **renders a badge reading
   "Unknown"**. Invariant 8 is "a missing halal field renders **no badge** — never an
   optimistic one", and `HalalBadge` implements that by construction — `null`, `undefined`
   and unrecognised values "all render nothing" (`HalalBadge.tsx:34`–`38`). This line
   manufactures a badge out of an absent field.
6. **The timeline is lossy.** `:271` maps transitions to `{state: t.to_state, at: t.at}` and
   drops everything else. `admin-order-detail.md` requires "every state transition with
   timestamps … **plus dispatch waves/offers and any escalation (`NO_RIDER_FOUND`)**". A
   `NO_RIDER_FOUND` escalation is invisible.
7. **No chain-of-custody, so a halal-integrity dispute has no evidence.**
   `handoff-verification.md` defines `package_seal` (`ISSUED → BOUND → PICKUP_VERIFIED →
   DELIVERY_VERIFIED | TAMPER_REPORTED`) and an append-only `handoff_event` log as "the
   evidence trail for disputes", and routes a broken seal into A-33/A-35 with "the scan
   history + photo as evidence". The refund reason list on this very screen offers
   `HALAL_CONCERN` (`:76`), and `RefundCasesScreen.tsx:85` adds `HALAL_INTEGRITY` — but
   neither screen shows a seal state or a single handoff event. The admin adjudicates a
   halal-integrity claim with no access to the proof the system was designed to collect.
8. **No support context.** `support-desk.md` Phase 1 is "in-context support (**highest
   value**): the linked-conversations + quick-reply + create-ticket + call panels on the
   order/customer records." None of it is here: no linked conversations, no SLA/CSAT, no
   softphone, no note.
9. **Two competing action patterns on one screen.** Cancel uses a modal `ConfirmDialog`;
   refund uses an inline `Card` form (`:385`–`414`) that appears *below* the two-column
   layout, off-screen at most window heights, with no focus move and no `role="dialog"`.
   Both are money-moving, audited, irreversible actions.
10. `Ledger residual` is printed as a money row among nine others (`:300`–`307`). Invariant
    6 makes a non-zero residual a systemic alarm, not a line item; nothing distinguishes
    `$0.00` from `-$2.31`.
11. `data.state` and `payment.state` print raw (`:210`, `:297`).
12. The `DISPUTED` banner is rendered **last in the DOM** (`:416`–`423`), after all content
    and both forms — the highest-severity fact about the order is the last thing a screen
    reader reaches and is below the fold for a sighted user. `AppShell.systemBanner`
    (`AppShell.tsx:38`) exists to put it above the scroll region and is unused.

---

### 1.8 `RefundCasesScreen.tsx` — refunds and disputes (A-33 / A-35)

**Purpose.** "List every refund and open a new case."

**What it renders.** A header row with an "Open a case" toggle `Button` (`:174`–`191`), a
collapsible new-case `Card` (`:193`–`214`), a six-column `DataTable` (`:216`–`228`), and a
bespoke prev/next pair (`:230`–`241`).

**Problems.**

1. **There is no case.** The screen is a refund list and a refund creation form. A-35 is
   dispute *case* management and A-37 is "Case model, queue and assignment" — no case
   object, no assignment, no state, no linked conversation. `support-desk.md` is explicit
   that the case is the platform's system of record and that escalation links to it.
2. **The order is unidentifiable.** `:56` renders `row.order_id.slice(0, 8)` with the UUID
   in a `title` attribute. A `title` is hover-only, which `04-accessibility.md:76` forbids
   as the sole route to information ("no action is hover-only"), and the comment at
   `:52`–`55` correctly identifies the real problem — `Refund` carries no human order code —
   then ships the truncation anyway. A support agent holding "HG-8F3K2Q" cannot find it here.
3. **No filters, no search, on a screen whose whole job is finding a case.** `:112`–`114`
   sends `limit` and `cursor` only.
4. **The authority-cap escalation is a toast.** `:148`–`153`: a `202` shows "Above your
   authority cap — escalated / An approval request was created. No refund exists yet." Then
   the form closes and the list reloads — and the `RefundApprovalRequest` appears nowhere,
   because the table lists refunds. The most consequential outcome of the action is announced
   in the most ephemeral surface available. `03-patterns.md:430` is unambiguous: "A refund
   action failure is **never** swallowed … The UI states plainly whether money moved."
5. **Money is entered as a decimal string and multiplied.** `:140` —
   `cents(Math.round(Number(amount) * 100))`. `Number('12.34') * 100` is `1233.9999…`; the
   `Math.round` saves this particular case, but a free-text CAD field parsed through a float
   on the one screen that moves money is exactly the shape invariant 3 exists to forbid. The
   `Input` has no `inputMode`, no pattern, no min/max and no validation (`:200`).
6. **The "goodwill" rule is enforced only by label.** `PARTIAL_AMOUNT` is labelled
   "(goodwill only)" (`:74`) and the amount field appears only when reason is `GOODWILL`
   (`:199`) — but the user can select `PARTIAL_AMOUNT` with any other reason and submit with
   no amount. The screen states a rule it does not hold.
7. **The header promises dual approval and shows none.** `:180`–`182` — "capped and
   dual-approved above CAD 50" — with no cap value from config, no indication of the
   signed-in admin's own cap, and no approval queue.
8. Pagination is hand-rolled (`:230`–`241`) instead of the `Pagination` component every
   other list uses via `KeysetGrid`, so this table's paging looks and behaves differently.
9. `DataTable` gets no `onSortChange` (`:216`–`228`) → no `aria-sort`, against
   `04-accessibility.md:239`.

---

### 1.9 `DependencyDashboardScreen.tsx` — system dependencies (G-7)

**Purpose.** "Is the platform's infrastructure actually connected to what it thinks it is?"

**What it renders.** Header, a 20-line explanation, then — in practice — an `ErrorState`.

**Problems.**

1. **The screen cannot work and its own 25-line header comment proves it.**
   `:12`–`35` traces the CORS failure to a Traefik `ipallowlist` scoped to `127.0.0.1/32`
   and concludes: "this is a genuinely host-only debug route … no client-side routing change
   makes it browser-reachable." So a nav item ("System", `App.tsx:54`) leads to a screen
   whose only reachable state is an error, and whose error copy explains that this is correct
   (`:82`–`85`). The diagnosis is excellent; shipping it as one of six top-level
   destinations is not. AGENTS.md §"Known gaps" records the same thing about
   `DependencyReport` and a `/debug/deps` route.
2. **Two health vocabularies now exist.** `HealthPill` renders HEALTHY / WATCH / AT_RISK
   (`components/HealthPill.tsx:11`–`18`) as an outline+tint pill with a **bare coloured
   dot** (`:14`, `styles.css:124`–`129`). The dot is `aria-hidden` and the word is always
   printed, so `04-accessibility.md:53` is satisfied — but `01-foundations.md:170`'s RULE
   H-2 reasoning ("A bare green dot is not a halal indicator") plus §1.4's "There is no bare
   coloured dot anywhere" argue the pattern should not exist at all on this surface. `Chip`
   and `Banner` already cover it.
3. `dependencyReportHealth` (`lib/health.ts:25`–`31`) returns `AT_RISK` on any disconnected
   dependency but the screen shows no aggregate remediation, and the critical-probe set is a
   client-side string set (`lib/health.ts:44`) duplicating a server judgement.

---

### 1.10 `StaffListScreen.tsx` — staff accounts (A-01/A-02/A-03)

**Purpose.** "Who has a platform role, what is it, and is MFA on?"

**What it renders.** A six-column read-only `DataTable` (`:42`–`87`).

**Problems.**

1. **Read-only by construction, so A-01 is unbuilt.** `:110` — "only a super admin may
   change it" — and there is no invite, no role change, no suspend. Not a defect in itself,
   but the screen does not say it is a V0 placeholder, so it reads as complete.
2. **MFA enrolment is a plain string in a text column.** `:76`–`80` renders "Enrolled" /
   "Not enrolled" as body text. On a console where MFA is mandatory
   (`App.tsx:39`–`40`), "Not enrolled" is an actionable security finding and should be
   impossible to scan past; it is currently the least prominent cell in the row.
3. **`pii` is declared and then deliberately defeated.** `:47`–`51` marks `full_name` and
   `email` as PII, then the comment explains no `onRevealPii` is passed, so the columns
   render in the clear. Defensible for a staff directory — but it means the one screen that
   declares PII columns demonstrates the masking machinery being switched off, and no screen
   anywhere demonstrates it on.
4. `role` and `status` print raw enums (`:66`, `:72`). No sort, so no `aria-sort`. A local
   `formatTimestamp` (`:28`–`32`) duplicates `lib/format.ts:10`.

---

### 1.11 `components/KeysetGrid.tsx` — the queue grid

**Purpose.** One reusable keyset-paginated grid for the three queue screens.

**Problems.**

1. **It is a second table implementation that discards `DataTable`'s admin contract.**
   `02-components.md:403` designates `DataTable` as the admin table for "orders,
   restaurants, riders, documents, **the halal register**, audit events, refunds". `KeysetGrid`
   wraps `@1771technologies/lytenyte-core` instead (`:15`), so the three busiest screens in
   the console lose: `aria-sort` on sortable headers, sticky first column, the per-row
   actions menu with unique accessible names, `PiiCell` integration, and the row-selected
   checkbox — every one of which `04-accessibility.md:239` or `02-components.md:403`–`415`
   requires of an admin table. `DataTable` implements them
   (`packages/ui-web/src/data/DataTable.tsx:73`–`94`, `:298`, `:365`).
2. **Loading, empty and error all destroy the table.** `:86`–`101` return `Skeleton`s,
   `EmptyState` or `ErrorState` **instead of** the grid. `03-patterns.md:367`–`369` requires
   the opposite three times over: "5 skeleton rows in the real column geometry. **Never a
   centred spinner replacing the table** — that loses the header and the user's place";
   "`EmptyState` inside the table body, **header retained**"; "`ErrorState` in the table body
   with the **header retained**; filters preserved so Retry is one click." The current
   behaviour is the specified anti-pattern.
3. **Row height is hard-coded.** `:109` — `rowHeight={44}`. The value happens to equal
   `density.compact.rowHeight`, but `01-foundations.md:294` is explicit: "Components read
   `density.*`; they do not hard-code 16." A literal here is how a density decision stops
   being a token.
4. **Pagination mode contradicts the pattern.** `:148` passes `mode="pages"`.
   `Pagination`'s own doc says `load-more` is "the admin default — patterns §4.1 'Cursor
   pagination with load-more'" (`packages/ui-web/src/data/Pagination.tsx:54`–`57`), and
   `02-components.md:409` says "**Cursor pagination only** … no page numbers".
5. **`height = 480` is fixed** (`:57`, `:105`), so the grid does not use available viewport
   and a queue of 25 rows at 44px (1,100px) always scrolls inside a 480px box nested in the
   page's own scroll. Two scrollbars on the primary work surface.
6. Activation is wired to `cell`, with a 16-line comment explaining why (`:112`–`136`) —
   good engineering, but it means **every cell is a tab stop**, so a keyboard user tabs
   6 times per row through a 25-row page. `DataTable` implements a single tab stop with
   arrow navigation (`useGridKeyboard.ts`, `DataTable.tsx:48`).

---

### 1.12 `components/LiveMapBox.tsx` — the order map

**Purpose.** Show restaurant, rider and destination for one order.

**Problems.**

1. **★ It paints a filled solid green outside the halal namespace, and it paints it on
   every restaurant regardless of halal state.** `:66`:

   ```
   const color = pin.kind === 'restaurant' ? 'var(--hg-color-halal-verified, #067A55)' : '#B42318';
   ```

   `--hg-color-halal-verified` **does not exist**. The generated property is
   `--hg-color-halal-certified-seal: #0F7A43`
   (`packages/ui-web/src/tokens/tokens.css:72`). So the var never resolves and the literal
   fallback always paints. `#067A55` is not in the halal namespace — it is the semantic
   success solid that `01-foundations.md:162` uses as its own counter-example ("halal seal
   … vs success.solid #067A55 → 2.00:1"). I ran the project's own rule against it:

   ```
   isReservedGreenSolid('#067A55') → { hue: 160.86 }   inHalalSet: false
   isReservedGreenSolid('#0F7A43') → { hue: 149.16 }   inHalalSet: true
   ```

   `#067A55` is a reserved green solid outside `color.halal.*` — a direct breach of
   invariant 10 / RULE H-1 (`01-foundations.md:168`). Worse, the condition is
   `pin.kind === 'restaurant'`, and `OrderDetailScreen.tsx:178`–`185` pushes that pin for
   **any** restaurant with coordinates. A restaurant whose certificate expired yesterday
   gets the verified-halal pin. That is an optimistic halal signal on a non-certified state —
   invariant 8 — and the pin is a bare 14px circle with no shield and no label
   (`:67`–`73`), which RULE H-2 names as "a spec violation" in those words.
2. **Lint L-4 cannot see either fault, for two independent reasons.** (a) The admin app is
   not in the rule's target set: `apps/admin/package.json:13` defines
   `"lint": "tsc --noEmit"`, so `pnpm check` → `pnpm lint` → `pnpm -r lint` runs a
   typecheck here, never L-4 — even though `run.ts:11`–`13` documents how
   (`tsx node_modules/@hg/ui-web/src/lint/run.ts apps/restaurant/src`). (b) Even when
   pointed at it, L-4 passes: I ran
   `tsx packages/ui-web/src/lint/run.ts apps/admin/src` → `L-4 no-green-solids: clean`.
   The reason is `isAllowedVar` (`l4-no-green-solids.ts:186`–`190`), which allows any var
   whose name starts with `--hg-color-halal` — so a **misspelled** halal var name launders
   a non-halal green fallback straight past the rule. The executable form of the invariant
   has a hole exactly the shape of this bug.
3. `'#B42318'` (`:66`) is a second raw literal — the value of `viz.8`, written by hand.
4. **The map has no text equivalent.** `02-components.md:440` is categorical: the map "is
   `aria-hidden` and is **always accompanied by an equivalent text summary** that is the
   actual accessible content: 'Rider is 1.2 km away, about 6 minutes.' … **The map is never
   the only way to know where the order is.**" `:116` sets `aria-hidden={!ready}` and there
   is no summary; once the map loads, `aria-hidden` flips to false and a screen reader gets a
   Mapbox canvas.
5. **No `stale` or `degraded` state.** `02-components.md:436`–`438` requires a
   "Location updating…" banner and a frozen last-known marker after 45s, and a `degraded`
   state when the socket is down. With no realtime at all (§1.7 problem 3), every render is
   silently stale and nothing says so.
6. The ETA overlay and the `missingLabel` overlay share one class and are positioned by
   inline style override (`:128`–`131`), so on an order with both they can collide; and both
   float over the map with `box-shadow: 0 1px 4px rgba(0,0,0,0.12)` — a raw colour in
   `styles.css:190`, outside the elevation tokens.
7. The `useEffect` dependency array is a joined string with an eslint-disable (`:89`–`90`),
   and `expanded` is a dependency, so **expanding the map tears down and rebuilds the Mapbox
   instance**, refetching tiles and losing pan/zoom.

---

### 1.13 `lib/` — the shared machinery

- **`load.ts:56`–`57`** — `run()` sets `{status:'loading', data:null}`, so **every** reload
  blanks the screen. This is the mechanism behind §1.3 problem 4 (lost notes) and it makes
  the "keep the header, keep the user's place" rule (`03-patterns.md:367`) impossible for any
  screen built on `useLoad`. A `revalidating` flag that preserves `data` would fix five
  findings at once.
- **`load.ts:56`–`66`** — `run` has an empty dependency array with an eslint-disable and a
  comment that the fetcher is "provided fresh per render"; it therefore closes over the
  **first** `fetcher`. `reload()` after a route param change can refetch the previous id.
  There is also no request cancellation, so a late response from an abandoned screen wins.
- **`format.ts:29`–`41`** — `formatCountdown` does not tick (§1.7 problem 4). There is no
  `Countdown` component in `ui-web` to reach for, despite `02-components.md:555`.
- **`format.ts:7`–`8`** — `en-CA`, hard-coded, with no timezone. A-15's expiry rule turns on
  "end of day **America/Toronto**" (`05-admin.md:1029`); this formats in the browser's zone,
  so an admin outside Ontario reads a different date than the one the rule applies.
- **`api.ts` / `config.ts:9`–`10`** — base URL defaults to the Prism mock on `:4010`. Fine
  for development; worth noting that nothing in the UI indicates whether the console is
  looking at fixtures or production, on a surface where "approve" publishes a halal claim.
- **`token.ts`** — a reload signs the admin out mid-review. On the halal screen that means
  losing every unrecorded note with no warning; there is no idle/expiry warning anywhere.

---

## 2. The five worst problems, ranked

### 1. The verification screen has no certificate on it. Four of the seven checks are therefore unanswerable.

`HalalVerificationScreen.tsx` renders no document, and nothing in `apps/admin/src` calls
`createDocumentDownloadUrl` — while `document_id` is on the payload
(`openapi.yaml:11140`), the audited 120-second presign endpoint exists
(`openapi.yaml:2628`), and `DocumentViewer` ships built and tested
(`packages/ui-web/src/data/DocumentViewer.tsx`).

**Risk — this is the direct route to a wrong halal decision.** H1 asks whether the scan is
legible, complete and unaltered; there is no scan. H3 and H4 are comparisons; neither
referent is on the screen (the restaurant's legal name and premises address live on
`/applications/:id`). H6 asks whether the certificate's scope covers what will be sold.
An admin facing seven radio groups and no evidence has two options: record `PASS` on the
basis of the transcription in front of them — which nobody on this screen entered and nobody
can check — or leave the console and work from email. The first produces a badge the
platform cannot defend; the second produces a badge whose audit trail
(`HalalChecklist.tsx:259`–`262`, A-15 R7) records a decision process that did not happen
here. A forged or altered certificate passes H1 by default, because H1 has no input.

### 2. The transcription step does not exist, so H5 and H7 — the two un-overridable checks — are computed from fields the admin never entered and cannot correct.

A-15 opens with transcription of six fields plus scope
(`05-admin.md:966`–`974`, "Nothing here is inferred, OCR'd or auto-approved").
`transcribeHalalCertificate` (`openapi.yaml:4688`) is never called; the fields render
read-only (`HalalChecklist.tsx:660`–`691`) and the issuing-body registry `Select` — the
thing that gives H2 meaning, and whose accepted set is settled at three bodies
(`docs/decisions/README.md:23`) — does not exist.

**Risk — a wrong halal decision that the system will defend as correct.** H5 is
`issued_on ≤ today AND expires_on ≥ today + min_remaining_days`; H7 is uniqueness on
`(issuing_body_id, certificate_number)`. Both are server-computed and, by design, cannot be
overridden by anyone including a Super Admin (A-15 R1). That design is only safe if the
inputs are right. With no transcription UI, a wrong `expires_on` yields a confident
`H5 = PASS` on an expired certificate, and a wrong `certificate_number` yields a confident
`H7 = PASS` on a certificate already approved for a different restaurant — the precise
scenario A-15 acceptance criterion 2 exists to prevent (`05-admin.md:1049`–`1052`). The
admin sees a lock glyph and the words "computed by the server", reasonably trusts them, and
has no affordance anywhere to fix the input that made them wrong.

### 3. Approve is one unconfirmed click, it is cheaper than reject, and recording a check silently destroys the notes typed for the other six.

`HalalApproveAction` is a bare `onClick` with no `ConfirmDialog`
(`HalalChecklist.tsx:356`–`364`; the screen fires immediately at
`HalalVerificationScreen.tsx:124`–`127`), while reject requires a reason code and ≥20
characters (`HalalChecklist.tsx:233`–`247`). Separately, each `Record Hn` calls `reload()`
(`HalalVerificationScreen.tsx:90`), `useLoad` blanks `data` (`lib/load.ts:56`), the screen
unmounts the checklist (`HalalVerificationScreen.tsx:178`), and `drafts`
(`HalalChecklist.tsx:126`) is destroyed.

**Risk — approve-through, and the loss of exactly the evidence A-15 R5 requires.** The
component's type-level gate makes it impossible to approve *without seven passes*; it does
nothing to make an admin *read* before the seventh. The gate opens and a filled primary
button materialises where a paragraph was, one render after a full-page skeleton flash. And
the workflow the layout invites — read down, fill seven rows, submit — is punished: the
first submit deletes the other six notes, so an admin learns to record one row at a time and
type each override justification under a seven-times-repeated screen reset. Override notes
are the audit trail for every human judgement on this screen and are surfaced in the halal
register report; the interaction is hostile to producing them.

### 4. The queues permit two admins to review the same application, and give neither of them any way to notice.

`POST …/take-next` exists on both queues (`openapi.yaml:4512`, `:4975`) with
`FOR UPDATE SKIP LOCKED`, a 60-minute lock, `409 REVIEW_LOCK_LOST` and the explicit
statement "There is no cherry-picking". Neither queue screen calls it; both let any admin
open any row (`OnboardingQueueScreen.tsx:95`, `RiderQueueScreen.tsx:81`). `assigned_admin_id`
and `review_lock_expires_at` are on the payload (`openapi.yaml:11038`–`11043`) and are not
columns. No screen handles `409 REVIEW_LOCK_LOST`.

**Risk — colliding decisions on a halal certificate, and silent work loss.** Two admins open
the same restaurant, both walk the seven checks, one approves and one rejects; whichever
lands second gets a `409` rendered as a generic toast (`HalalVerificationScreen.tsx:116`)
with no explanation that someone else already decided, and no indication of what the decision
was. The lock exists in the backend specifically to make this unrepresentable; the UI opts out
of it. Secondary risk: without take-next, work is chosen by preference rather than FIFO, so
SLA-breaching applications can sit while easier ones are picked — and the queue's SLA column
is a render-time boolean that never updates.

### 5. The order map paints a filled solid green — not the halal green, a raw hex of the semantic success green — on every restaurant pin regardless of halal state, and the lint that exists to prevent this cannot see it.

`LiveMapBox.tsx:66` resolves `var(--hg-color-halal-verified, #067A55)` — a property name
that does not exist (the real one is `--hg-color-halal-certified-seal`,
`tokens.css:72`), so `#067A55` always paints. Verified against the project's own rule:
hue 160.86°, a reserved green solid, not in `HALAL_HEXES`. The condition is
`pin.kind === 'restaurant'` (`:66`), fed unconditionally from
`OrderDetailScreen.tsx:178`–`185`.

**Risk — a false verified-halal signal, on an admin surface, that the CI gate is blind to.**
Invariant 10 and RULE H-1 give `color.halal.*` a monopoly on filled solid green so that green
means one thing; `#067A55` breaks the monopoly with the very hex the foundations document uses
as its counter-example. RULE H-2 forbids a bare dot as a halal indicator; this is a 14px
circle with no shield and no label. And invariant 8 forbids an optimistic badge on a missing
or non-certified state; this paints the verified colour for an expired certificate. The lint
misses it twice: `apps/admin/package.json:13` aliases `lint` to `tsc --noEmit` so L-4 never
runs over this tree, and `isAllowedVar` (`l4-no-green-solids.ts:186`) allows anything prefixed
`--hg-color-halal`, so the typo itself is the exemption. "Prefer making a bug
unrepresentable over testing for it" is the repo's rule; here the mechanism built to do that
has a gap a typo fits through.

### The next five, for completeness

6. **The cancel flow cannot be completed** — the mandatory case-ID field renders behind the
   modal scrim that requires it (`OrderDetailScreen.tsx:344`–`383`). A support agent cannot
   cancel an order.
7. **A-42 masking exists nowhere**, while `OrdersAdminScreen.tsx:3`–`5` claims it happens on
   the detail screen. `PiiCell` ships unused. No phone number is shown anywhere, so support
   also cannot *reach* anyone (`admin-order-detail.md` §Parties).
8. **A halal state rendered as a neutral `Chip`** in two places
   (`OrderDetailScreen.tsx:244`–`248`, `ApplicationDetailScreen.tsx:251`), one of which
   manufactures an "Unknown" badge from an absent field, against invariant 8 and RULE H-2 —
   while `HalalBadge` implements both correctly and is never imported.
9. **`KeysetGrid` implements the three empty/loading/error anti-patterns the patterns doc
   names** (`KeysetGrid.tsx:86`–`101`) and drops `aria-sort`, row actions and single-tab-stop
   keyboard nav on the three busiest screens.
10. **A-14 / A-18 are unbuilt**, so the restaurant funnel has no decision and no document
    review, while the rider funnel has both — meaning the *restaurant* path, the one the halal
    claim hangs off, is the less complete of the two.

---

## 3. Redesign direction

**What this console is for.** Nine of these ten screens are ordinary operations software and
should be boring, dense and fast. One is not. The halal verification screen is the only place
in the entire product where a human being decides whether Halal Goes will vouch, publicly and
in a religious register, for food it has not seen. Everything else — orders, refunds, riders,
staff — is furniture around that act. The current app treats all ten as the same kind of
thing: the same `.adm-stack` column, the same 72rem measure, the same card rhythm, the same
one-click primary button. That uniformity is the root design error. A console where the
consequential screen looks like the staff list is a console that teaches its operators that
nothing on it is consequential.

**The decision is irreversible in the only way that matters.** Technically it is not: A-15
gives a Super Admin `REVOKE`. But revocation runs the A-17 lapse path — delist plus notify
plus a P1 case at Tier 3 (`05-admin.md:1046`–`1047`) — which is what happens *after* the
platform has already told customers this kitchen is halal. Between approve and revoke, orders
were placed by people who chose this restaurant for precisely one reason. You cannot un-serve
a meal. So the design target is not "prevent an invalid approval" — the type-level gate
already does that well. It is **"make an unconsidered approval feel wrong to perform"**.

**Four principles.**

**1. Evidence and claim in one eyeful, always.** Every check on this screen is a comparison,
and a comparison performed from memory is not a check. The document goes on the start side and
stays there, independently scrollable, never scrolled away from — `03-patterns.md:373` already
demands this for ordinary KYC, and it matters more here. Alongside each comparison check, the
platform's own value and the certificate's claimed value sit **adjacent, in the same row, in
`mono.md` where they are identifiers** (`01-foundations.md:209` already requires monospace +
tabular numerals for identifiers that must not be misread, citing the UI face's weakness at
`1/l/I` and `0/O` — certificate numbers are exactly that). H3 stops being "does this look
right" and becomes "are these two strings the same". That is a question a tired person can
answer correctly at 5pm.

**2. Deliberate friction, spent precisely.** `03-patterns.md:387` already calls this screen
"the one place where the admin UI is deliberately slower than it could be", and the friction
budget is currently spent in the wrong places. It is spent on: seven separate round trips,
seven screen resets, seven "Record Hn" buttons. It is not spent on: the approve. Invert that.
Recording the seven checks should be one pass with one local draft and one submit — fast,
undestructive, resumable. The approve should cost something: an `alertdialog` that restates
what is about to become true in public, lists the seven checks with their results, names the
issuing body and the expiry date, states that the admin's identity and the timestamp are being
written to the audit log, and requires a positive action to proceed. `ConfirmDialog` does all
of this today and is used for rejecting a *rider* but not for approving a *halal certificate*.

**3. Asymmetry of tone, never asymmetry of colour.** Approve must not read as a celebration
and reject must not read as a condemnation. Under invariant 9 and RULE H-3, red is
unavailable for any halal state — "red would read as *haram*, a religious ruling the platform
does not make" — and under invariant 10 solid green is reserved to `color.halal.*`, so a green
"success" approve is unavailable too. This is a constraint that happens to be correct: the
right register for both buttons is the neutral-and-brand one the system already has
(`action.primary` orange for the confirm, `action.tertiary` outline for the alternative), with
the weight carried by **words and by the dialog**, not by hue. The single place the halal
palette should appear on this screen is *after* the decision, as the state the certificate has
reached — `HalalBadge`, composite, with the shield, once.

**4. Compact is a density, not a licence to crowd.** The admin register is 44/12/12
(`tokens.json`, `01-foundations.md:291`). Compact means short rows and 12px gutters in tables
and chrome. It does not mean `text-fg-tertiary` body copy, it does not mean 11px `label.sm` for
anything a decision rests on, and it does not permit dropping below `target.min 44` (the
Search control at `OrdersAdminScreen.tsx:92` already does). The evidence and decision panes of
the verification console are the one region where I argue for `comfortable` padding (16) on
purpose: it is a reading surface, not a scanning surface, and the existing token already
provides the value — no new value needed.

**What the console should feel like.** A queue that hands you work rather than letting you
pick it, and shows you whose work is whose. A verification screen that looks like an
instrument panel rather than a form: document on the left, claim-versus-platform comparisons
on the right, the two locked checks visibly different in kind from the five you control, a
running "5 of 7 recorded" state you can see without scrolling, and one decision at the bottom
that stops and asks. Every other screen in the console should be flatter, denser and quieter
than that screen — the hierarchy between them *is* the design.

---

## 4. Screen-by-screen redesign brief

Everything below composes shipped `@hg/ui-web` components and frozen token values only. Where
a needed component does not exist (`Sheet`, `Countdown`) I say so and name the substitute.

### 4.0 Shell and IA (`App.tsx`)

- **Nav becomes seven items, grouped.** `SideNav` already takes `groups`
  (`App.tsx:164` passes one). Group 1 — *Review*: **Halal certificates** (new, first),
  Restaurants, Riders, Menus. Group 2 — *Operate*: Orders, Refunds & disputes. Group 3 —
  *Platform*: Staff, System. Halal first, because it is the product; `System` is a debug
  route and belongs last (§1.9).
- **Nav badges.** Each review item carries its queue depth and, where the queue has one, a
  breached-SLA count — `Chip tone="warning"` inline in the `SideNav` label slot.
- **Pass `skipTargets`** — `[{id:'queue-table', label:'Skip to table'}]` on queue routes,
  `[{id:'certificate-document', label:'Skip to certificate'}, {id:'halal-checks', label:'Skip
  to checks'}]` on the verification route. Required by `04-accessibility.md:184`.
- **Use `pageHeader`** for the per-screen `h1` + `FilterBar`, so filters stay put while the
  table scrolls, and **`systemBanner`** for anything at the severity of "order is disputed"
  or "your review lock expires in 4 minutes".
- **Drop the 72rem cap** (`styles.css:75`) on the two-pane routes; keep a measure cap only on
  prose regions.
- Replace `LoginGate`'s raw-hex error (`App.tsx:124`) with `Banner variant="danger"`.
- Fix the icons: `System` must not be `check`.

### 4.1 Halal verification console — `/certificates/:id` ★

**The layout.** Two panes, `grid-template-columns: minmax(0, 1fr) minmax(0, 34rem)` above
960px, single column below, matching `03-patterns.md:387`–`411`'s diagram. The start pane is
**sticky and independently scrollable**; the end pane scrolls the work.

**Above the fold, without scrolling, on a 1280×800 window — non-negotiable:**

1. The restaurant's **name** (currently absent entirely — `HalalVerificationScreen.tsx:144`
   says only "Halal verification"), the certificate number in `mono.md`, and the certificate's
   current `status` via `HalalBadge surface="operational"` (which renders nothing on an
   absent state — invariant 8 for free).
2. The **review-lock state**: who holds it and how long remains. Nothing else on this screen
   matters if someone else is deciding it.
3. The **certificate document**, rendered.
4. The **progress roll-up**: "3 of 7 recorded · 2 pass · 1 fail · 2 locked". A single
   `Banner emphasis="subtle"` line, `label.md`, tabular numerals.
5. The **audit notice** (`HalalChecklist.tsx:259` already ships it — keep it, raise it).

**Start pane — the evidence.**

- `DocumentViewer` (`packages/ui-web/src/data/DocumentViewer.tsx`) against
  `createDocumentDownloadUrl` (`openapi.yaml:2628`) using `certificate.document_id`.
  Pass `title="Halal certificate"`, `expiresAt`/`serverNow` from the presign response,
  `auditNotice` (default true), `allowDownload={false}`. Its `expired` state is the expected
  path, not an error — the component already implements that; the screen must not wrap it in
  an `ErrorState`.
- **When `document_id` is null**, this is a hard block, not an empty state:
  `Banner variant="warning" emphasis="prominent"`, "No certificate document is attached, so
  H1 cannot be assessed and this certificate cannot be approved." Per `03-patterns.md:381`:
  "*Document genuinely missing* → a hard error blocking approval, because a check cannot be
  recorded against a document nobody can see." Never red — this is a halal surface.

**End pane, block 1 — transcription.**

- A real form calling `transcribeHalalCertificate` (`openapi.yaml:4688`), in the A-15 field
  order: `certificate_number` (`Input`, `mono.md`, tabular), `issuing_body_id` (**`Select`
  populated from `/v1/admin/halal-issuing-bodies`** — free text is not permitted),
  `certified_legal_name`, `certified_address` (`Textarea`), `issued_on` / `expires_on`,
  `scope` (`Select`, the four enum values with the plain-English strings already written at
  `HalalChecklist.tsx:98`–`103`).
- Header states the rule verbatim: nothing here is inferred or OCR'd.
- On save, the screen **must not blank**: the checks recompute server-side
  (`openapi.yaml:4712`) and the response is the whole certificate, so patch state in place.
- Collapses to a summary `Card` once saved, with an "Edit transcription" tertiary action —
  because a mis-transcribed date is currently unfixable and that is finding #2.

**End pane, block 2 — the seven checks, restructured.**

- **Two visually distinct groups, not one list of seven.** Group A, "Your five judgements":
  H1, H2, H3, H4, H6 — `Card variant="outlined"`, `surface.raised`, full controls. Group B,
  "Computed and locked": H5, H7 — `surface.subtle`, `border.interactive`, a group-level
  heading that says once, at 16/22 `heading.sm`, "These two are computed by the server. No
  one, including a Super Admin, can override them", plus the lock glyph per row. Right now
  the difference between a check you own and a check that owns you is a border colour swap
  inside an identical card (`HalalChecklist.tsx:520`–`525`).
- **Each comparison check renders both values side by side.** H3: platform
  `profile.legal_name` | certificate `certified_legal_name`. H4: platform premises address |
  certificate `certified_address`. H2: the certificate's issuing body and its registry
  status. H6: `scope`'s plain-English meaning against what the restaurant will sell. Two
  columns, `mono.md` for identifiers, labels in `label.md`. This is the single highest-value
  change on the screen after the document itself — it converts four judgement calls into four
  string comparisons.
- **One draft, one submit.** Keep the three-way `PASS`/`FAIL`/`NOT_ASSESSED` control and the
  note-with-counter exactly as built (they are good), but record the set in one `PUT
  …/checks` call — the endpoint already takes an array (`HalalVerificationScreen.tsx:79`) and
  is currently handed one element. On response, patch in place; never unmount the checklist.
  A "3 unsaved" indicator in the sticky decision bar, and a `beforeunload` guard.
- **Per-row computed states.** Where `computed_result` is pending, that row shows a
  `Skeleton` in the result slot and the decision bar states that approval is unavailable
  while a computed check is outstanding (`03-patterns.md:416`–`418`). Where a computed check
  errored, that row shows the error inline and approval stays shut.
- **The outstanding list becomes navigable.** "2 checks outstanding" with each key as an
  in-page link that moves focus to that `fieldset` — and spelled out ("H1 — legible and
  complete"), not just "H1".

**End pane, block 3 — the decision bar.**

- **Sticky to the bottom of the end pane**, so it is always visible and always in the same
  place. Left: the roll-up. Right: the actions, **Reject first, Approve last**, ≥24 apart
  (`04-accessibility.md:75`; `HalalChecklist.tsx:408` already does the 24).
- **Approve opens a `ConfirmDialog`** (`destructive={false}`, `confirmLabel="Approve
  certificate"`) whose `children` slot — provided for exactly this
  (`ConfirmDialog.tsx:61`) — restates: restaurant name, issuing body, expiry date, scope,
  and the seven checks with their recorded results. Description: what becomes publicly true,
  that it is not the same as approving the restaurant (A-15 R3), and that the action is
  audited under the admin's identity. Focus lands on Cancel (`04-accessibility.md:166`:
  "Focus lands on the **least destructive** action").
- **Reject keeps its reason code + ≥20 characters** but moves into the same `ConfirmDialog`
  shape, so the two decisions look and cost alike. The reason text is sent verbatim to the
  restaurant — say so in the dialog, not only in a helper line.
- **A `422 CHECK_FAILED` / `CHECKLIST_INCOMPLETE` response** highlights the named keys inline
  and moves focus to the first (`03-patterns.md:418`), instead of a toast.
- **Pass `readOnly`** when the viewer is a support agent or the certificate is decided, and
  render the support-agent view as what A-15 AC5 actually permits — status, expiry, issuing
  body, rejection reason — instead of an armed instrument full of em-dashes.

### 4.2 Halal queue — `/certificates` (new screen)

The missing front door. `DataTable` (not `KeysetGrid`), density `compact`, columns:
Restaurant · Issuing body · Certificate no. (`mono.md`) · Expires (with days remaining,
tabular) · Checks recorded (`3/7`) · Assigned to · Lock expires · Submitted. `FilterBar` with
`savedViews` for *Pending* / *Expiring within 30 days* / *Mine* / *Unassigned* — the component
already supports saved views (`FilterBar.tsx:60`). A primary **"Take next certificate"**
`Button`, and three distinct empty states including the drained one with the last-processed
timestamp. A link to the halal register.

### 4.3 Onboarding queue and rider queue

- **`DataTable`, not `KeysetGrid`** — for `aria-sort`, single tab stop, row actions menu, and
  loading/empty/error **inside the table body with the header retained**
  (`03-patterns.md:367`–`369`). `rowHeight` from `density.compact.rowHeight` (44), never a
  literal.
- **Primary action is "Take next application"** → `takeNextRestaurantApplication` /
  `takeNextRiderApplication`. Row click still opens a read view, but a row held by another
  admin says so and offers no decision.
- **Two new columns: Assigned to · Lock expires** (`assigned_admin_id`,
  `review_lock_expires_at`). A lock inside 10 minutes gets `Chip tone="warning"`.
- **SLA becomes time, not a boolean**: remaining/overdue, tabular, ticking — which needs the
  `Countdown` component that `02-components.md:555` specifies and `ui-web` does not have. Until
  it exists, one interval at the screen level driving `formatCountdown`, not a render-time
  `Date.now()`.
- **`FilterBar`** wired to the endpoint's real `state[]` and `sla_breached` params, plus the
  three empty states.
- **`409 REVIEW_LOCK_LOST`** gets a named `Banner`: who holds it now, and a re-take action.

### 4.4 Application detail (restaurant) and rider application detail

- **Two panes.** Start: `DocumentViewer` on the selected document, always visible. End:
  identity, premises, the document list, the halal summary, the decision.
- **Documents become reviewable**: `DataTable` with `rowActions` → Approve / Reject with the
  structured reason code (`reviewRestaurantDocument`, `reviewRiderDocument`), each through
  `ConfirmDialog`. Selecting a row loads it into the viewer.
- **Add the restaurant decision** (A-18): approve and reject, both through `ConfirmDialog`
  with a reason code — and approve must **not** send a hard-coded reason the way the rider
  screen does (`RiderApplicationDetailScreen.tsx:114`).
- **Surface `address_pin_warning`** as a `Banner variant="warning"`.
- **The halal card leads with `HalalBadge surface="operational"`** plus "checks recorded 3/7"
  and a primary link into the console. No `Chip` for a halal state, anywhere.
- **`PiiCell`** on the rider's email and any phone.
- Blockers stay a prominent `Banner`; they are the reason the reviewer is here.

### 4.5 Orders list and order detail

- **`FilterBar`** with search across code/phone/email (patterns §4.4), state multi-select,
  date range; the bespoke `.adm-nav-link` search button becomes a `Button`.
- **`DataTable`** with `aria-sort`, `stickyFirstColumn` on the order code, and **`PiiCell`**
  on customer name and phone with the justification capture A-42 requires and the app already
  claims to have.
- **Order detail:** the `DISPUTED` banner moves to `AppShell.systemBanner`, first in the DOM.
  Parties become real party cards with **phone numbers behind `PiiCell`** and call/message
  affordances, the restaurant's halal state via **`HalalBadge`**, the rider's vehicle, rating
  and current leg. The map gains its mandatory **text equivalent** — "Rider 1.2 km away,
  about 6 minutes; last position 14 s ago" — and its `stale` / `degraded` states. The
  deadline countdown ticks. The timeline shows dispatch waves and `NO_RIDER_FOUND`. A
  **seal / chain-of-custody block** renders `package_seal.status` and the `handoff_event`
  log, because a `HALAL_INTEGRITY` refund cannot be adjudicated without it. `Ledger residual`
  leaves the money grid and becomes an assertion: `$0.00` quiet, anything else a prominent
  `Banner`. **Cancel and refund both become `ConfirmDialog`s**, and the case-ID field moves
  into the dialog's `children` slot — the current arrangement is unusable.
- A **linked-conversations panel** in `AppShell.aside` when support-desk Phase 1 lands.

### 4.6 Refunds and disputes

- Keep the list, add **`FilterBar`** (state, reason, kind, amount band, date) and a **human
  order code** column — the UUID slice with a hover `title` is not a searchable identifier.
- **The `202` escalation becomes a row**, not a toast: approval requests belong in the table
  with their own state, or in a second tab. "The UI states plainly whether money moved"
  (`03-patterns.md:430`).
- The **amount field** gets `inputMode="decimal"`, a pattern, a max from the order total and
  the caller's cap, and validation before submit — and `PARTIAL_AMOUNT` must be *selectable*
  only where it is legal, not merely labelled.
- Show the signed-in admin's **authority cap** next to the amount field.
- Replace the hand-rolled prev/next with `Pagination`.

### 4.7 Staff, System

- **Staff:** sortable `DataTable`; `Chip tone="warning"` for `Not enrolled` MFA; `enumLabel`
  on role and status; and if it stays read-only, an `EmptyState`-style note saying so.
- **System:** out of the primary nav. It is a host-only diagnostic by design
  (`DependencyDashboardScreen.tsx:26`–`28`); make it a `/system` route linked from a footer,
  and retire `HealthPill` in favour of `Chip` + `Banner` so there is one status vocabulary.

### 4.8 Cross-cutting

- **`useLoad` gains a `revalidating` state** that keeps `data` while refetching. This one
  change fixes the note destruction on the halal screen, the "keep the header and the user's
  place" rule on every table, and the focus-on-refresh violation.
- **Add `apps/admin` to the L-4 lint target** (`"lint": "tsx
  ../../packages/ui-web/src/lint/run.ts src && tsc --noEmit"`), and tighten `isAllowedVar` so
  an unresolvable `--hg-color-halal-*` name is a violation rather than an exemption.
- **One enum formatter** (`enumLabel`) everywhere a state is printed; no raw
  `DOCUMENTS_REVIEW` in any cell.
- **One table component** (`DataTable`). Retire `KeysetGrid` or reduce it to a `DataTable`
  wrapper that supplies the cursor stack.
- Delete the duplicate local `formatTimestamp` in `StaffListScreen.tsx:28` and the duplicate
  `newIdempotencyKey` in four screens.

---

## 5. Divergence from the three existing admin design specs

### 5.1 `admin-order-detail.md`

| Spec requirement | Built | Evidence |
|---|---|---|
| Deep-linkable full detail view, two columns (left map + parties, right timeline/money/items/actions) | **Yes** | `OrderDetailScreen.tsx:219`–`341`, `styles.css:150`–`161` |
| Mapbox box with restaurant / rider / destination pins, expandable | **Partly** | `LiveMapBox.tsx`; expanding rebuilds the map (`:90`) |
| Only green on the map is the verified-halal restaurant pin | **Violated** | `LiveMapBox.tsx:66` paints `#067A55` — not a halal token — on every restaurant pin regardless of state |
| Rider live position over the WebSocket channel, last-known fallback | **No** | No WS/SSE/poll in `apps/admin/src`; one GET, no refetch (`lib/load.ts:68`) |
| Prominent ETA + `deadline_at` countdown | **Partly** | Rendered (`:223`–`224`) but frozen — `formatCountdown` never ticks (`lib/format.ts:29`) |
| All three parties with **phone**, address, history count / halal status / vehicle + rating + leg | **No** | `:228`–`263` shows city, name, first name + initial. No phone, no rating, no prep state, no history count |
| Contact affordances (call / message), proxy/click-to-call | **No** | None |
| Audited PII access, prefer proxy over raw numbers | **No** | No `PiiCell`, no justification, no reveal — while `OrdersAdminScreen.tsx:3`–`5` says there is |
| Header: code, state pill + dispatch sub-state, placed-at, countdown | **Yes** | `:205`–`217` |
| Timeline incl. dispatch waves/offers and `NO_RIDER_FOUND` escalation | **Partly** | `:271` keeps `to_state` + `at` only |
| Money breakdown to zero residual + payment status | **Yes**, weakly | `:289`–`309`; residual is one row among nine |
| Actions: contact, cancel/refund, reassign/re-dispatch, escalate | **Partly** | Cancel + refund only; **cancel is unusable** (`:374`–`383` behind the scrim). No reassign, no escalate, no contact |
| Every action audited; no direct `order.state` write (P-14) | **Yes** | Goes through `cancelOrderAdmin` / `issueRefund` |

**Verdict: the skeleton matches, the substance does not.** The two-column frame, the map box
and the money view were built; the three things the document argues *for* — reaching any
party, a genuinely live position, and audited PII — are all absent, and the map violates the
one colour rule the document calls out by name.

### 5.2 `support-desk.md`

**Verdict: nothing built. 0 of the document's asks are present.**

No Chatwoot integration, no inbox, no thread, no composer, no assignment, no SLA view, no
CSAT, no team dashboards, no softphone, no call logging, no `external_id` stitching. Phase 1
— which the document names as "highest value" because "support lives where the operational
work is" — is the in-context panel on the order/customer record, and `OrderDetailScreen`
has no such panel and no `aside` region to hold one (`App.tsx:184`–`189` never passes
`AppShell.aside`).

The document's own division of labour is *contradicted* in one place: "Dispute/refund cases
(A-33/A-35) — linked to conversations, **never re-implemented**" stays in the platform, and
`RefundCasesScreen` implements a refund list with no case object and no conversation link at
all (§1.8 problem 1). So the platform side of the division is also unbuilt. The document
does phase this to v1.x/v2, so absence is on-plan — but it should be recorded as absent
rather than assumed.

### 5.3 `handoff-verification.md`

**Verdict: nothing built on the admin surface.**

No `package_seal` state (`ISSUED → BOUND → PICKUP_VERIFIED → DELIVERY_VERIFIED |
TAMPER_REPORTED`), no `handoff_event` log, no seal-intact attestation, no scan history, no
photo evidence, no tamper report anywhere in `apps/admin/src`.

This matters more than its "v1 software / v1.x ops" phasing suggests, because the admin app
*already exposes the disputes that depend on it*: `OrderDetailScreen.tsx:76` offers
`HALAL_CONCERN` as a refund reason and `RefundCasesScreen.tsx:84`–`85` offers both
`HALAL_CONCERN` and `HALAL_INTEGRITY`. The document specifies `handoff_event` as
"the evidence trail for disputes" and routes a broken seal explicitly into A-33/A-35 "with
the scan history + photo as evidence". So the admin can today issue a halal-integrity refund
with no access to the evidence the design says that decision rests on. The document's
framing rule — never red, never haram language, "seal check failed, we'll make it right" —
is untested because no surface renders a seal state at all.

### 5.4 Divergence from the four foundation documents (summary)

- **Density.** `01-foundations.md:417` + `:288` and `03-patterns.md:356` say admin =
  `compact` (44/12/12). `themes.ts:1384`–`1394` ships `comfortable` (64/16/16) and
  `themeAttributes('admin')` stamps it on the app (`App.tsx:83`, `:183`). **Unreconciled;
  needs a decision doc.**
- **`03-patterns.md:387`–`411`** (§4.3's layout diagram: DocumentViewer | transcription | checklist
  | reject/approve) is the specification of the most important screen in the product, and
  **two of its four blocks do not exist**.
- **`03-patterns.md:367`–`369`** (table loading/empty/error keep the header) is inverted by
  `KeysetGrid.tsx:86`–`101` on all three queue screens.
- **`02-components.md:403`** designates `DataTable` as *the* admin table; three screens use a
  LyteNyte grid instead, losing `aria-sort`, row actions and single-tab-stop keyboard nav.
- **`02-components.md:440`** ("the map is never the only way to know where the order is")
  has no implementation — no text equivalent.
- **`04-accessibility.md:184`** ("Admin adds 'Skip to table'") — never added.
- **`04-accessibility.md:239`** (`aria-sort` on every sortable column) — no admin table is
  sortable, so the requirement is vacuously unmet everywhere.
- **`01-foundations.md:168`/`:170`/`:173`** (RULES H-1/H-2) — breached at
  `LiveMapBox.tsx:66` and side-stepped at `OrderDetailScreen.tsx:244` and
  `ApplicationDetailScreen.tsx:251`.
- **Document drift worth fixing while here:** `01-foundations.md:178` states the certified
  seal as `#04482A` and the brass ring as `#D4A72C`; the frozen tokens are
  `color.halal.certified.seal #0F7A43` and `certified.ring #C9A24B`. §11 still specifies
  **Lucide** as the icon set, while the app and `AGENTS.md` use the Solar subset
  (`App.tsx:42`, `solar-icon-map.json`). A designer working from the foundations document
  today would specify the wrong hexes and the wrong icon family.

---

## 6. What I could not determine, and what I would need

1. **Whether the built app has ever been used against real or fixture data.** I read source
   only — no running instance, no screenshots, no visual-regression output. So I cannot
   report actual rendered contrast, real column overflow, what the 72rem cap does at 1440px,
   or whether the LyteNyte grid inherits admin tokens at all (it imports its own
   `grid.css` + `light-dark.css` at `KeysetGrid.tsx:16`–`17`, which may or may not be
   overridden by the theme). **Need:** the console running against the mock
   (`pnpm mock` + `pnpm --filter @hg/admin dev`) with `VITE_MAPBOX_TOKEN` set, at 1280×800
   and 1440×900, light and dark, plus 200% zoom.
2. **Whether the compact-vs-comfortable contradiction is a decision or a drift.**
   `themes.ts:9`–`17` states the two-tier rule as though settled, but there is no entry in
   `docs/decisions/` and both design documents say otherwise. **Need:** the author's intent,
   then a decision doc. It changes every row height and card padding in the brief above.
3. **Where the transcribed fields currently come from.** The admin app never calls
   `transcribeHalalCertificate`, yet `HalalCertificate` has the fields populated in the
   fixtures. Are they written by the restaurant at upload? Seeded? Never populated in
   reality? **Need:** the backend's halal module behaviour (AGENTS.md says the seven domain
   modules are not started, so this may be fixture-only today). The answer decides whether
   §4.1's transcription block is *new* UI or a *missing* UI for an existing write path.
4. **Which roles actually reach this console, and how the client learns its own role.** There
   is no `/v1/me` call and no role in the client. Does the contract expose the session's role
   and permissions? **Need:** the session/me operation, so `readOnly` and the deny-by-default
   matrix can be reflected in the UI rather than discovered through 403s.
5. **Whether the WebSocket channel carries what the order-detail doc assumes.** I could not
   confirm from `contracts/` alone that a rider-position stream for an *admin* subscriber
   exists (the customer-scoped `getOrderTracking` shape is referenced at
   `OrderDetailScreen.tsx:13`–`17`). **Need:** the WS contract's admin channel/event list.
6. **The seal and handoff contract.** `handoff-verification.md` defines `package_seal` and
   `handoff_event` as a data model; I did not find corresponding API operations. **Need:**
   confirmation of whether the admin read model for the chain of custody exists, is planned,
   or needs contract work before §4.5's seal block is designable.
7. **Whether `Countdown` and `Sheet` are coming.** Both are specified in
   `02-components.md` (§38, §30) and neither exists in `ui-web`. Several items in this brief
   (ticking SLA, ticking `deadline_at`, admin row-detail side panel) assume one or the other.
   **Need:** a decision — build them, or accept `AppShell.aside` plus a screen-level interval
   as the permanent answer, in which case the component doc should be amended.
8. **What the halal register (A-10) is meant to be.** `03-patterns.md:414` and A-15 R5 both
   refer to it — override notes are "surfaced in the halal register report" — but I found no
   contract operation and no screen. **Need:** its shape, because it is where the audit value
   of every override note on the verification screen is actually realised.
9. **Cap values and configuration.** `RefundCasesScreen.tsx:180`–`182` hard-codes "CAD 50"
   in prose. **Need:** whether authority caps are readable per-admin from the API, so the
   figure can be rendered rather than asserted.
10. **Whether O-01 (HST) and O-03 (SMS/A2P) block any of this.** Both are open human
    blockers in `docs/decisions/README.md`. Neither obviously touches the halal console, but
    O-03 gates sign-in for other roles and may change what the admin console has to do about
    accounts that cannot authenticate. **Need:** confirmation that the admin path is
    unaffected.
