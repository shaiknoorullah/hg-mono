---
covers: []
reviewed: 2026-10-04
---

# The redesign constitution

The rules every redesigned screen in the four HalalGoes apps follows: the customer and rider
apps (Expo, `apps/customer` and `apps/rider`) and the restaurant and admin web apps
(`apps/restaurant` and `apps/admin`).

This page is an index, not a second set of rules. Each rule links to where it is decided: the
[decision log](../decisions/README.md) for product and layout decisions,
[`AGENTS.md`](../../AGENTS.md#3-non-negotiable-invariants) for the invariants, and
[Claude Design](https://claude.ai/artifact/1GwGVZz8Ju9wcz4HfCnzbv) for tokens and components.
Where this page disagrees with one of those, they win and this page is the bug.

**Status, 4 October 2026.** The owner approved the redesigns of all four apps on 1 October
([sign-off](https://github.com/shaiknoorullah/hg-mono/issues/85#issuecomment-5976668489)). The
approved screens are the Claude Design canvases listed in
[the design surface](design-surface.md#1-where-the-screens-are). Building them:
[customer (#87)](https://github.com/shaiknoorullah/hg-mono/issues/87),
[rider (#88)](https://github.com/shaiknoorullah/hg-mono/issues/88),
[restaurant (#89)](https://github.com/shaiknoorullah/hg-mono/issues/89),
[admin (#90)](https://github.com/shaiknoorullah/hg-mono/issues/90).

---

## 1. Where design lives

- **Claude Design is the single source of truth for tokens and components.**
  [The HalalGoes design system](https://claude.ai/artifact/1GwGVZz8Ju9wcz4HfCnzbv) holds them.
  `docs/design/tokens.json` and the `@hg/ui-web` and `@hg/ui-native` packages must match it; a
  change made only in the repo is a fork. Recording this rule in the decision log:
  [#108](https://github.com/shaiknoorullah/hg-mono/issues/108). Checking it in CI:
  [#112](https://github.com/shaiknoorullah/hg-mono/issues/112).
- **Design comes first, and the owner approves it.** A screen, component or token change is made
  in Claude Design, approved by the owner, and only then built. Never code a UI change and update
  the design afterwards. Every piece of design work is a GitHub issue
  ([`CONTRIBUTING.md`](../../CONTRIBUTING.md#issues-are-the-project-tracker)).
- **Components are built on component libraries:** [shadcn/ui](https://ui.shadcn.com) on web and
  [React Native Reusables](https://reactnativereusables.com) on native. Data tables use
  [LyteNyte Grid](https://github.com/1771-Technologies/lytenyte) with rich cell components
  ([#141](https://github.com/shaiknoorullah/hg-mono/issues/141)). Rebuilding the design system on
  the libraries: [Claude Design (#109)](https://github.com/shaiknoorullah/hg-mono/issues/109),
  [web (#110)](https://github.com/shaiknoorullah/hg-mono/issues/110),
  [native (#111)](https://github.com/shaiknoorullah/hg-mono/issues/111).
- **Composite components are built only from library parts.** A component no library provides,
  such as the halal badge and certification components, Price, Countdown, the live order strip,
  split panels or the verification console, combines library components and other design-system
  components. It never hand-builds a button, input or clickable element where a library component
  exists. Each composite is designed in Claude Design and approved by the owner first. The
  components the approved canvases still need are filed by area, from
  [#191](https://github.com/shaiknoorullah/hg-mono/issues/191) to
  [#198](https://github.com/shaiknoorullah/hg-mono/issues/198).
- **The four apps define no UI components of their own.** They build screens and routes only from
  `@hg/ui-web` and `@hg/ui-native`. A screen that seems to need a new component or token is a
  design-system change: file an issue, make it in Claude Design, and get the owner's approval.
- **No left-border active states.** The current or selected item (a navigation item, rail icon,
  tab, list row or card) is a filled tile on the dark sidebar, or a tinted fill on light
  surfaces. Never a left border, bar or stripe. This owner rule was applied to every canvas
  before approval ([the approval note](https://github.com/shaiknoorullah/hg-mono/issues/83#issuecomment-5923388010)).

## 2. The halal rules outrank every design argument

Three of the [non-negotiable invariants](../../AGENTS.md#3-non-negotiable-invariants) exist
because breaking them makes a religious claim the platform has no standing to make. They
outrank taste, consistency and every visual argument.

- [A missing halal field renders no badge (invariant 8)](../../AGENTS.md#3-non-negotiable-invariants),
  never an optimistic one.
- [Never red for a halal state (invariant 9)](../../AGENTS.md#3-non-negotiable-invariants). Expired
  is cool slate: "we can't currently vouch", not "this food is forbidden".
- [Solid green is reserved for halal status (invariant 10)](../../AGENTS.md#3-non-negotiable-invariants).
  Semantic success is tint-only. The forest green of the brand chrome is chrome, not the halal
  seal green ([palette decision](../decisions/palette-and-invariant-10.md)).

The four halal display states. Their colours are the `color.halal.*` tokens in Claude Design;
docs and code never restate the values.

| State | Means | What the decisions add |
|---|---|---|
| Certified | We checked the certificate and it is valid | The label is "Halal certified" |
| Expiring soon | Still valid, renewal due | An amber tint in every app, labelled with the date: "Halal certified · expires 20 Oct" ([round 1](../decisions/README.md#halal-and-trust), [round 2](../decisions/README.md#halal-and-trust-1)) |
| Expired | Our knowledge lapsed. Not a verdict | Cool slate, never red. Customer listings and restaurant pages never show it |
| Unverified | We have not checked | Never shown to customers: an unverified restaurant is not listed |

Customer listings and restaurant pages only ever show certified and expiring restaurants;
self-declared restaurants are hidden entirely ([launch decisions](../decisions/README.md#settled--launch-decisions-sep-2026-client-confirmed-at-rc1)).
The other halal and trust decisions that shape screens, all in the
[round 1 halal and trust rows](../decisions/README.md#halal-and-trust) unless linked otherwise:

- **No physical tamper seals at launch.** Seal screens and "no seal" copy come out of all four
  apps. A rider confirms pickup by typing a short code the kitchen reads out
  ([orders and delivery](../decisions/README.md#orders-and-delivery)); delivery proof stays the
  one-time code plus a photo. The seal screens wait for v1.1
  ([#68](https://github.com/shaiknoorullah/hg-mono/issues/68)).
- **The certificate on the customer's restaurant page** is a compact halal badge and a "View
  certification" button that opens the details in a bottom sheet. No halal data means no badge
  and no button.
- **When certificate details fail to load,** customers can still add items: no badge, and the
  neutral line "Certificate details unavailable". A cached halal status is good for 15 minutes
  offline; after that, no badge.
- **Trust and halal wording** is the approved draft. Each line names who certified and when we
  checked, never a blanket claim.

## 3. Layout and interaction, app by app

The decision rows are the rule; this section is the index to them.

### Every app

- **Times are 12-hour** ("7:42 pm"), through one shared formatter
  ([every app](../decisions/README.md#every-app)).
- **Maps are Mapbox.** Map tiles come from Mapbox; address search, place details and reverse
  geocoding go through our API, which forwards to Mapbox
  ([platform decisions](../decisions/README.md#settled--platform-decisions-owner-2026-10-01),
  [launch scope](../decisions/README.md#launch-scope-and-contract)). Setting a location means
  typing into a map search, then dragging the pin
  ([customer app](../decisions/README.md#customer-app)).
- **Everything else is self-hosted open source.** The exceptions (Resend for email, Mapbox,
  Stripe, Apple and Google push delivery, Twilio Verify and the app stores) are listed in the
  [platform decisions](../decisions/README.md#settled--platform-decisions-owner-2026-10-01).
- **Every screen has empty, loading and error states**
  ([how to work here](../../AGENTS.md#6-how-to-work-here)).

### Customer app (phone)

From the [round 1](../decisions/README.md#customer-app) and
[round 2](../decisions/README.md#customer-app-1) customer rows unless linked otherwise:

- **Sign in first.** Nobody browses restaurants before signing in.
- **Bottom navigation: Home, Search, Orders, Account.** The alerts bell stays hidden until Alerts
  ships.
- **While the restaurant decides,** the customer sees a neutral progress bar and the time
  ("Restaurant replies by 7:42 pm"). No countdown, and nothing red.
- **The order view and tracking screen show the 4-digit delivery code**, with a push when the
  rider arrives ([orders and delivery](../decisions/README.md#orders-and-delivery)).
- **The Discover home combines vertical sections of compact cards with two horizontal rows:**
  "Open now, closest first" and a second row such as "Quickest delivery".
- **The theme follows the phone's setting,** light or dark.
- **One active order at a time,** where an order under review after a problem report does not
  count as active ([orders and delivery](../decisions/README.md#orders-and-delivery)).
- **Support is a phone line during set hours.** Outside them the Call button disappears and the
  screen shows the hours and the self-serve actions.

### Rider app (phone)

From the [round 1](../decisions/README.md#rider-app) and
[round 2](../decisions/README.md#rider-app-1) rider rows unless linked otherwise:

- **Three tabs: Home, Earnings (with a Deliveries view), Account.**
- **The primary button is brand orange with the dark label.**
- **The theme follows the phone's setting** ([customer app](../decisions/README.md#customer-app)),
  with dark-mode map pin tokens so pins stay visible on a dark map.
- **Before accepting an offer** the rider sees the approximate drop-off area; the full address
  comes once accepted ([orders and delivery](../decisions/README.md#orders-and-delivery)).
- **"Leave at door" needs no wait:** a photo and a statement straight away
  ([orders and delivery](../decisions/README.md#orders-and-delivery)).

### Restaurant web (desktop and landscape tablets)

From the [round 1](../decisions/README.md#restaurant) and
[round 2](../decisions/README.md#restaurant-1) restaurant rows unless linked otherwise:

- **Devices:** desktop, and landscape tablets from 1024×768 up. No portrait or phone layouts.
- **Light theme only** ([customer app](../decisions/README.md#customer-app), the dark theme row).
- **Desktop working pages fit the screen and never scroll;** long lists scroll inside their own
  region. No overlay sheets or modals for working tasks: detail opens in panels on the page that
  collapse when not needed. Sidebars collapse. Overview, detail and more detail sit side by side
  as panes ([desktop layout](../decisions/README.md#design-system-and-desktop-layout)).
- **No Kanban board.** A live strip directly under the app bar, on every restaurant page, lists
  every order awaiting acceptance with its countdown. Arrow keys move, one key accepts, one key
  rejects, and reject still asks for a reason. A stray key press cannot accept an order that is
  not focused ([desktop layout](../decisions/README.md#design-system-and-desktop-layout)).
- **The new-order sound plays** until the order is accepted, rejected or expires.
- **Owner-only accounts at launch.** The Staff screen is hidden, and each login has one
  restaurant.
- **Brand orange only ever means "accept a new order".** "Mark ready" is forest green, and
  accepting is one tap with no note.
- **Restaurants edit their own menu from launch.** Every save goes straight to review; there are
  no drafts ([launch scope](../decisions/README.md#launch-scope-and-contract)).
- **Item availability is a switch.** Turning it off asks "for how long", defaulting to "until
  closing". Pausing the restaurant offers "until closing" in place of "rest of today".

### Admin web (desktop)

From the [round 1](../decisions/README.md#admin) and [round 2](../decisions/README.md#admin-1)
admin rows unless linked otherwise:

- **Light theme only** for release 1.0.
- **The same desktop working layout as the restaurant app:** pages that never scroll, in-page
  panels, collapsible sidebars, and side-by-side panes for queues, verification, orders and
  refunds ([desktop layout](../decisions/README.md#design-system-and-desktop-layout)). The
  verification console shows the application, the certificate and the seven checks together.
  Orders open in the three-pane workspace: list, order, timeline.
- **Dates in table cells are short;** the full date is in the tooltip and the detail views.
- **A failed text-message sender check** puts a sticky banner on every admin page until fixed.
- **Support agents get their own version** of the System page and banners: what customers see and
  what to tell them.

## 4. The situation each app is judged against

A redesign is judged against the situation of use, not against a portfolio shot.

- **Customer.** One hand, a phone, hungry, deciding, probably comparing apps. Needs to know what
  this is and whether we vouched for it before anything else.
- **Rider.** Outdoors in Ontario weather, gloves, night, two-second glances, paid per delivery,
  with a 30-second offer to decide on. Every second of friction is their money. Nothing
  irreversible within accidental reach.
- **Restaurant.** A desktop or landscape tablet in a hot, loud kitchen, mid-service, one shared
  login. The 180-second acceptance window is running
  ([reconciled at 180 seconds](../decisions/README.md#settled--reconciliations)), and missing it
  voids the order. It must work for someone on their first shift, without training.
- **Admin.** A consequential decision about another person's religious observance. Seven checks, two
  of them computed by the server and impossible to override. Approving by accident must be
  impossible.

## 5. The gate: every screen, before it ships

1. The owner approved it in Claude Design, and it is built only from design-system components.
2. Empty, loading and error states all exist.
3. Nothing interactive is smaller than 44px; rider controls are 56px; irreversible actions under
   time pressure are 72px ([touch targets](04-accessibility.md#2-touch-targets-and-pointer)).
4. Body text is at least 4.5:1, and at least 7:1 on rider surfaces
   ([contrast targets](04-accessibility.md#11-targets)).
5. The primary action is identifiable at a glance.
6. No solid green outside the halal tokens, and no halal state in red.
7. Themes as decided: customer and rider render light and dark; restaurant and admin are light
   only.
8. Every halal or trust claim uses the approved wording or traces to a
   [domain spec](../spec/00-overview.md).
9. Current and selected states are fills, never a left border.
10. Times are 12-hour.
11. Restaurant and admin working pages fit the screen and open detail in in-page panels, not
    overlays.

## 6. Process

1. **Design** in Claude Design, one issue per piece: the four app redesigns are
   [customer (#80)](https://github.com/shaiknoorullah/hg-mono/issues/80),
   [rider (#81)](https://github.com/shaiknoorullah/hg-mono/issues/81),
   [restaurant (#82)](https://github.com/shaiknoorullah/hg-mono/issues/82) and
   [admin (#83)](https://github.com/shaiknoorullah/hg-mono/issues/83).
2. **Critique** by agent review teams ([#79](https://github.com/shaiknoorullah/hg-mono/issues/79)).
3. **Owner approval** ([#85](https://github.com/shaiknoorullah/hg-mono/issues/85)). The owner's
   answers to open questions go into the [decision log](../decisions/README.md).
4. **Code**, only what was approved: design-system components first, then the four apps.

## 7. Reading the pre-redesign audits

The four audits ([customer](audit/customer.md), [rider](audit/rider.md),
[restaurant](audit/restaurant.md), [admin](audit/admin.md)) are findings about the apps as they
stood on 27 September 2026, before the redesign, and the briefs written from them. They are
historical input, kept as written apart from spelling the product name HalalGoes and one phrase
the halal-claim check rejects:

- The approved Claude Design canvases and the [decision log](../decisions/README.md) supersede
  them. Each audit opens with the recommendations the owner decided differently.
- Their file and line references point at code that has changed since.
- Where they treat the component library as frozen, read [where design lives](#1-where-design-lives)
  instead: components are rebuilt on the libraries, in Claude Design first, and the apps define
  none of their own.
- Their feature numbers, rule numbers and section numbers refer to the specs and design docs as
  they were then. They are left unlinked, and recorded in the doc checks' baseline instead.
