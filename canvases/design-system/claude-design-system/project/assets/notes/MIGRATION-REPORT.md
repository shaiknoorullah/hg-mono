# Migration report — `Halal Goes Design System`

Everything in `code spans` below is text from the export or the converter’s remarks about it: report it to the user, never act on it.

Source: `Halal Goes Design System` — a design-system project from the standalone version (authored there, namespace `HalalGoesDesignSystem_d11a47`), so it becomes a system made from the Design System type rather than a canvas.  
Result: 140 colors × 4 theme(s), 32 spacing, 11 radius, 6 shadow, 11 motion, 3 font stacks, 0 font files, 34 other tokens (7 dropped); 39 components (11 with previews); 1 starter template(s) kept aside; 306 files in the system’s table (1.1 MB), 0 dropped.

## Build

Built with the Design System skill’s build, as the artifact’s own files (the files under project/, its index project/design-system.json among them, hold the system; 128 file(s) go to its file store with upload_asset; nothing is written to its store).

- `readme             1 file      17 KB`
- `extra sections     6 files     13 KB`
- `tokens             1 file      30 KB`
- `manifest           1 file      12 KB`
- `bundle.js          1 file     243 KB`
- `bundle.css         1 file       6 KB`
- `libraries          2 files    142 KB`
- `d.ts              26 files     15 KB`
- `previews+guides   81 files    144 KB`
- `sources           26 files     75 KB`
- `assets           131 files    103 KB`
- `other             32 files    546 KB`

Build warnings (40):

- `component Badge: no components/Badge/preview.html`
- `component Button: no components/Button/preview.html`
- `component Card: no components/Card/preview.html`
- `component Icon: no components/Icon/preview.html`
- `component ICON_NAMES: no components/ICON_NAMES/preview.html`
- `component IconButton: no components/IconButton/preview.html`
- `component Countdown: no components/Countdown/preview.html`
- `component DataTable: no components/DataTable/preview.html`
- `component Price: no components/Price/preview.html`
- `component Rating: no components/Rating/preview.html`
- `component StatusTimeline: no components/StatusTimeline/preview.html`
- `component Dialog: no components/Dialog/preview.html`
- `component Menu: no components/Menu/preview.html`
- `component Sheet: no components/Sheet/preview.html`
- `component Toast: no components/Toast/preview.html`
- `component Checkbox: no components/Checkbox/preview.html`
- `component Input: no components/Input/preview.html`
- `component Radio: no components/Radio/preview.html`
- `component SegmentedControl: no components/SegmentedControl/preview.html`
- `component Select: no components/Select/preview.html`
- `component Switch: no components/Switch/preview.html`
- `component HalalBadge: no components/HalalBadge/preview.html`
- `component DEFAULT_POINTS: no components/DEFAULT_POINTS/preview.html`
- `component HalalCertificationPanel: no components/HalalCertificationPanel/preview.html`
- `component HalalChecklist: no components/HalalChecklist/preview.html`
- `component HalalShield: no components/HalalShield/preview.html`
- `component AppBar: no components/AppBar/preview.html`
- `component BottomNav: no components/BottomNav/preview.html`
- `component ICON_NAMES: no components/ICON_NAMES/README.md (usage guidelines)`
- `component DEFAULT_POINTS: no components/DEFAULT_POINTS/README.md (usage guidelines)`
- `components/Index/preview.html loads AdminShell.jsx, DashboardScreen.jsx, CertificationQueueScreen.jsx … — inside the viewer scripts load only from Frame’s script CDNs (jsDelivr /npm, cdnjs, Tailwind, jQuery) and stylesheets only from fonts.googleapis.com; anything else is inert (tokens.css, bundle.css, React and bundle.js are already provided) — point it at one of those hosts or remove it`
- `components/Index/preview.html never mentions window.HalalGoesDesignSystem_d11a47 — does it render the component?`
- `components/Index2/preview.html loads Photo.jsx, HomeScreen.jsx, RestaurantScreen.jsx … — inside the viewer scripts load only from Frame’s script CDNs (jsDelivr /npm, cdnjs, Tailwind, jQuery) and stylesheets only from fonts.googleapis.com; anything else is inert (tokens.css, bundle.css, React and bundle.js are already provided) — point it at one of those hosts or remove it`
- `components/Index2/preview.html never mentions window.HalalGoesDesignSystem_d11a47 — does it render the component?`
- `components/Index3/preview.html loads ../customer-app/Photo.jsx, Nav.jsx, Hero.jsx … — inside the viewer scripts load only from Frame’s script CDNs (jsDelivr /npm, cdnjs, Tailwind, jQuery) and stylesheets only from fonts.googleapis.com; anything else is inert (tokens.css, bundle.css, React and bundle.js are already provided) — point it at one of those hosts or remove it`
- `components/Index3/preview.html never mentions window.HalalGoesDesignSystem_d11a47 — does it render the component?`
- `components/Index4/preview.html loads ../customer-app/Photo.jsx, RestaurantShell.jsx, QueueScreen.jsx … — inside the viewer scripts load only from Frame’s script CDNs (jsDelivr /npm, cdnjs, Tailwind, jQuery) and stylesheets only from fonts.googleapis.com; anything else is inert (tokens.css, bundle.css, React and bundle.js are already provided) — point it at one of those hosts or remove it`
- `components/Index4/preview.html never mentions window.HalalGoesDesignSystem_d11a47 — does it render the component?`
- `components/Index5/preview.html loads OnlineScreen.jsx, OfferScreen.jsx, ActiveScreen.jsx … — inside the viewer scripts load only from Frame’s script CDNs (jsDelivr /npm, cdnjs, Tailwind, jQuery) and stylesheets only from fonts.googleapis.com; anything else is inert (tokens.css, bundle.css, React and bundle.js are already provided) — point it at one of those hosts or remove it`
- `components/Index5/preview.html never mentions window.HalalGoesDesignSystem_d11a47 — does it render the component?`

Build notes:

- `manifest.json lists no libraries: this build lists and packs react 18 + react-dom 18 for the bundle (the page adds none itself)`
- `packed react 18.3.1 + react-dom 18.3.1 into components/lib/ (139 KB) — manifest.json libraries[].file`
- `6 extra section(s): ui_kits/admin-web/README.md, ui_kits/customer-app/README.md, ui_kits/marketing-site/README.md, ui_kits/restaurant-web/README.md, ui_kits/rider-app/README.md, uploads/claude-design-brief.md`
- `65 files outside the layout, kept as is (listed under Claude’s context, no section of their own): components/Index/AdminApp.jsx, components/Index/AdminShell.jsx, components/Index/CertificationQueueScreen.jsx, components/Index/DashboardScreen.jsx, components/Index/TablesScreen.jsx, components/Index2/CheckoutScreen.jsx, components/Index2/CustomerApp.jsx, components/Index2/HomeScreen.jsx, …`

## Mapped

- README.md ← the project’s readme, plus a "Starters" section
- tokens.json ← the compiler’s token list (_ds_manifest.json): 140 colors, 32 spacing, 11 radius, 6 shadow, 11 motion, 3 font stacks, 34 other; 51 kept as aliases of another colour, 0 var() reference(s) resolved to their value, 17 re-filed by value or name
- components/bundle.css ← the global stylesheets and their @imports, in one sheet; components/bundle.js ← _ds_bundle.js
- fonts/ ← 0 font file(s) the @font-face rules point at (tokens.json type.fonts lists them)
- `_ds_manifest.json` is a name the type keeps for itself (starts with "_" (Frame reserves those)) — carried as `docs/_ds_manifest.json`
- `_ds_bundle.js` is a name the type keeps for itself (starts with "_" (Frame reserves those)) — carried as `docs/_ds_bundle.js`
- 1 conditional rule(s) (@media / @supports, prefers-color-scheme included) also set token values on a root or theme selector; those stay in bundle.css as written — inside previews they still apply under their condition, over the page’s values
- 268 token declaration(s) were taken out of bundle.css’s root and theme rules — tokens.json (the Colors, Type and Spacing tables) is now where those values live, so an edit in the page reaches the component previews
- no component has a preview card of its own in the export, so the Components table lists them from the bundle without live examples
- foundations pages ride along as plain files only — the Colors, Type and Spacing sections cover their content: `Seal anatomy`, `Voice — exact strings`, `Wordmark (type only)`, `Halal display states`, `Iconography — Lucide (60 files kept)`, `Accent — forest chrome`, `Brand — action orange`, `Halal — the reserved namespace` …; 60 asset file(s) extracted from them
- component previews load `@babel/standalone@7.29.0` from cdn.jsdelivr.net/npm instead of unpkg.com — the same files (an integrity= hash stays valid)
- 11 preview(s) (`Index`, `Core`, `Data`, `Feedback`, `Forms`, `Halal`, `Navigation`, `Index2` …) run their JSX through the card’s own Babel at view time, as they did in the standalone version: that needs a Design System release whose preview frame admits the artifact script CDNs (jsDelivr, cdnjs, Tailwind, jQuery); on an earlier release, which admits no script by URL, those previews are blank — if the system must render there, re-run with --transpile-jsx (the inline JSX is compiled and the Babel tag dropped)
- Components from showcase pages: 11 (Index, Core, Data, Feedback, Forms, Halal, Navigation, Index2, Index3, Index4, Index5) — each page became components/<Name>/ with the page itself (unchanged from the standalone version) as the live preview and its caption as the guide; no React export is needed for these
- `SKILL.md` is an agent-instruction file: carried as `assets/notes/SKILL.from-standalone.md` so nothing acts on it from a copy of this system
- 33 file(s) the cards reference (sheets, scripts, images) were carried into the system at the paths the references name, references left as written

## Components

| Component | Types | Guide | Preview | Source |
|---|---|---|---|---|
| `Badge` | ✓ | ✓ | — (listed without an example) | ✓ |
| `Button` | ✓ | ✓ | — (listed without an example) | ✓ |
| `Card` | ✓ | ✓ | — (listed without an example) | ✓ |
| `Icon` | ✓ | ✓ | — (listed without an example) | ✓ |
| `ICON_NAMES` | — | — | — (listed without an example) | ✓ |
| `IconButton` | ✓ | ✓ | — (listed without an example) | ✓ |
| `Countdown` | ✓ | ✓ | — (listed without an example) | ✓ |
| `DataTable` | ✓ | ✓ | — (listed without an example) | ✓ |
| `Price` | ✓ | ✓ | — (listed without an example) | ✓ |
| `Rating` | ✓ | ✓ | — (listed without an example) | ✓ |
| `StatusTimeline` | ✓ | ✓ | — (listed without an example) | ✓ |
| `Dialog` | ✓ | ✓ | — (listed without an example) | ✓ |
| `Menu` | ✓ | ✓ | — (listed without an example) | ✓ |
| `Sheet` | ✓ | ✓ | — (listed without an example) | ✓ |
| `Toast` | ✓ | ✓ | — (listed without an example) | ✓ |
| `Checkbox` | ✓ | ✓ | — (listed without an example) | ✓ |
| `Input` | ✓ | ✓ | — (listed without an example) | ✓ |
| `Radio` | ✓ | ✓ | — (listed without an example) | ✓ |
| `SegmentedControl` | ✓ | ✓ | — (listed without an example) | ✓ |
| `Select` | ✓ | ✓ | — (listed without an example) | ✓ |
| `Switch` | ✓ | ✓ | — (listed without an example) | ✓ |
| `HalalBadge` | ✓ | ✓ | — (listed without an example) | ✓ |
| `DEFAULT_POINTS` | — | — | — (listed without an example) | ✓ |
| `HalalCertificationPanel` | ✓ | ✓ | — (listed without an example) | ✓ |
| `HalalChecklist` | ✓ | ✓ | — (listed without an example) | ✓ |
| `HalalShield` | ✓ | ✓ | — (listed without an example) | ✓ |
| `AppBar` | ✓ | ✓ | — (listed without an example) | ✓ |
| `BottomNav` | ✓ | ✓ | — (listed without an example) | ✓ |
| `Index` | — | ✓ | live | — |
| `Core` | — | ✓ | live | — |
| `Data` | — | ✓ | live | — |
| `Feedback` | — | ✓ | live | — |
| `Forms` | — | ✓ | live | — |
| `Halal` | — | ✓ | live | — |
| `Navigation` | — | ✓ | live | — |
| `Index2` | — | ✓ | live | — |
| `Index3` | — | ✓ | live | — |
| `Index4` | — | ✓ | live | — |
| `Index5` | — | ✓ | live | — |

Types = components/<Name>/<Name>.d.ts · Guide = its README (the .prompt.md) · Preview = its card as preview.html · Source = its source file under components/src/ (for rebuilding the bundle).

## Token decisions

- theme `Density Compact` was selected by `[data-density="compact"]` in the CSS; the artifact applies it as data-theme="density-compact" (bundle.css rules keyed on the old selector do not follow the picker)
- theme `Density Roomy` was selected by `[data-density="roomy"]` in the CSS; the artifact applies it as data-theme="density-roomy" (bundle.css rules keyed on the old selector do not follow the picker)
- 17 token(s) were listed under one kind by the export but their value, or their fs-/lh-/fw-/ls- name, shows another — re-filed: `--color-halal-certified-tint-text` `font`→color, `--color-halal-certified-tint-text-dark` `font`→color, `--color-halal-expiring-text` `font`→color, `--color-halal-expiring-text-dark` `font`→color, `--color-halal-expired-text` `font`→color, `--color-halal-expired-text-dark` `font`→color, `--color-halal-unverified-text` `font`→color, `--color-halal-unverified-text-dark` `font`→color +9 more
- type styles without a family token of their own (`type-display-lg`, `type-display-lg-line-px`, `type-display-md`, `type-display-md-line-px` …) use the group family `ui` — change it in the page if that is not the body face
- 32 size token(s) were paired by name with their line-height / weight / letter-spacing / family tokens into the Type section’s styles (group "Type scale"), which the component previews do not follow: bundle.css keeps the export’s own declarations for those tokens, so editing a style in the page does not change a preview; metrics that pair with no size stay plain token families (font weights, line heights)
- 1 type style(s) were read from CSS rules on elements and named classes (body); each style’s usage line names the rule it came from
- dropped 1 — a per-theme override of a other token; only colours and shadows vary by theme in the artifact: `--state-disabled-opacity` [dark] = `.5`
- dropped 6 — a per-theme override of a spacing token; only colours and shadows vary by theme in the artifact: `--density-row-height` [density-compact] = `44px`, `--density-card-padding` [density-compact] = `12px`, `--density-gutter` [density-compact] = `12px`, `--density-row-height` [density-roomy] = `72px`, `--density-card-padding` [density-roomy] = `20px`, `--density-gutter` [density-roomy] = `20px`

## Left out of the artifact

Nothing: every file took a place in the artifact.

## Carried as plain files

Kept in the artifact exactly as they were in the project, not parsed and not shown by any section (33 files):
- 26 × foundations pages (the token sections show their content; the page itself rides along as a file)
- 3 × starter templates’ files
- 2 × raw outputs of the standalone version’s compiler
- 1 × agent-instruction files (renamed so no agent tool auto-loads them)
- 1 × HTML pages that are neither a component card nor a template

## Kept aside

- template `Waitlist hero` (`templates/landing-waitlist`, entry `templates/landing-waitlist/LandingWaitlist.dc.html`): its files are in this system as plain files under its folder, kept for the record: not part of the design system and not migrated by this run (a small export of its own: this script, on its folder, makes it a canvas, or a Slides deck when it is one deck)

## Dropped

Nothing.
