# Third-party skills — provenance

Seven vendored skill packs, 44 skills. Packs 1, 2, 4 and 5 are MIT; packs 3, 6 and 7 are
Apache-2.0 under three different copyright holders, so each carries its own licence text. All fetched
Sep 2026 from public sources with no repo attached to the session and no credentials — packs 1
and 2 over `raw.githubusercontent.com`, packs 3 to 6 by anonymous git clone. Packs 4 and 5 come
from the same upstream repo and share one licence file.

Packs 1 and 2 are marketing and landing-page diagnosis; packs 3 to 6 are 3D, WebGL and
scroll-driven rendering, added Sep 2026 while exploring a hero treatment for
`apps/marketing`. Pack 6 is vendor API documentation rather than technique guidance — see its
section.

## Pack 1 — marketing (5 skills)

Source: **coreyhaines31/marketingskills**, branch `main`, path `skills/<name>/`.

| Skill | Upstream version | Files |
|---|---|---|
| marketing-psychology | 2.0.0 | SKILL.md |
| content-strategy | 2.1.1 | SKILL.md + references/ (2) |
| community-marketing | 2.0.1 | SKILL.md + references/ (1) |
| copywriting | 2.0.2 | SKILL.md + references/ (2) |
| programmatic-seo | 2.0.0 | SKILL.md + references/ (1) |

Upstream `evals/` not vendored (author's test suite; not needed to run the skills).

## Pack 2 — landing-page diagnosis (26 skills)

Source: **mardab96/landing-pages-claude-skills**, branch `main`, skills at repo root.
MIT © 2026 AdLume — full text in `LICENSE-landing-pages-AdLume`.

`landing-page-triage` is the entry point: it runs no diagnosis itself, it names at most
three other skills to run and in what order. Start there rather than firing all 26.

Remaining 25: above-the-fold-clarity-review · accessibility-conversion-blocker-check ·
comparison-page-positioning-review · conversion-leak-finder · cta-clarity-check ·
form-friction-finder · google-ads-landing-page-experience-review · hero-section-diagnosis ·
landing-page-ab-test-readout · landing-page-copy-readability-pass ·
landing-page-scale-readiness-check · lead-form-sales-handoff-check · mobile-conversion-review ·
objection-map-builder · offer-clarity-diagnosis · page-length-fit-check ·
page-speed-impact-review · paid-traffic-message-match-audit · popup-and-overlay-timing-review ·
pricing-page-clarity-review · social-proof-strength-audit · thank-you-page-opportunity-audit ·
traffic-temperature-match-review · trial-vs-demo-path-decision · trust-signal-audit

Upstream `scripts/`, `references/`, `examples/`, `evals/` not vendored — the skills are
self-contained (verified: zero relative file references across all 26).

## Review before install

These files are instructions that shape agent behaviour, so all 31 were reviewed, not just
downloaded. Across both packs: no prompt injection, no network or shell instructions, no
credential access, no executable payloads, no hidden/bidi unicode, no HTML comments, no
base64 blobs. Every `name:` matches its directory. All 37 files verified byte-identical to
upstream by SHA-256 re-fetch. **Re-review on any upstream bump.**

## Known caveats

- Pack 1 skills opportunistically read `.agents/product-marketing.md` or
  `.claude/product-marketing.md` if present. Neither exists in this repo. Note that
  creating a file at either path later makes it standing agent input.
- `content-strategy/references/headless-cms.md` has 3 dead links into
  `../../../tools/integrations/` — an artifact of extraction from the 60-skill bundle.
- Pack 1 cross-references sibling skills that are NOT installed (cro, pricing, seo-audit,
  emails, popups, offers, ab-testing, schema, social, copy-editing, site-architecture,
  competitors). Prose references only; they degrade gracefully.
- `marketing-psychology` advises opt-out subscription defaults ("pre-select the plan you
  want customers to choose"). That conflicts with repo invariant #8 (silence is never
  consent) and with Canadian negative-option billing rules. **Not applicable to this
  project** — disregard that section.
- `community-marketing/references/community-models.md` is a chapter-level condensation of a
  commercial book. Attribution is present; no separate licence ships with it.

## Correction — helper scripts, added Sep 2026

The first install vendored only `SKILL.md` files. That was wrong for three skills, whose
`SKILL.md` instructs running a sibling Python helper rather than estimating by eye — the original
vetting looked for markdown relative links and did not catch a script reference:

| Skill | Helper |
|---|---|
| landing-page-copy-readability-pass | `readability_report.py` |
| accessibility-conversion-blocker-check | `contrast_check.py` |
| landing-page-ab-test-readout | `significance.py` |

Without them those three skills produce guessed numbers, which is the opposite of their purpose.
Fetched from the same upstream and reviewed as executable code, a higher bar than the markdown:
stdlib imports only (argparse, math, re, sys, dataclasses, collections), no subprocess, no
network, no eval/exec, no writes; the only file I/O is reading the input file. Verified by running
`readability_report.py` against real copy and checking its output against the source.

---

## Pack 3 — webgl-experience (1 skill), added Sep 2026

Source: **nexu-io/open-design**, commit `053abdc1b750a41477010fee76a98c0f103cf32e`
(2026-09-19), path `design-templates/webgl-experience/`. Fetched by anonymous public
clone through the session's git proxy — no repo attached, no credentials.

**Licence differs from packs 1 and 2: Apache-2.0**, not MIT. "Copyright 2026 Open Design
contributors". Full text in `LICENSE-open-design-Apache-2.0`. Upstream ships no NOTICE
file. No changes were made to any vendored file — all three are byte-identical to
upstream, so Apache-2.0 §4(b) (state significant changes) has nothing to record.

| File | SHA-256 |
|---|---|
| `webgl-experience/SKILL.md` | `afc943af0c7e497bf5231208636275cbd39da5fa4586da363a05e95371ebb37a` |
| `webgl-experience/example.html` | `6a33b96490ee993f2237fdd2b1700e373dd302addf2db13c94f5df954158cbbb` |
| `webgl-experience/craft/animation-discipline.md` | `075273e8404f7931adfe196d508461efdd303b54e0d9a9ef3f642a682c12a760` |

`craft/animation-discipline.md` is not part of the upstream skill folder — it lives at the
repo root upstream. It is vendored because `SKILL.md`'s frontmatter declares
`craft: requires: [animation-discipline]`, which is a real dependency this pack would
otherwise be missing. **It is not referenced by any relative path, so nothing will lead a
reader to it — read it alongside `SKILL.md` deliberately.** It is the best short reference
in this repo on when motion earns its place, and it is sourced (Tversky/Morrison/Bétrancourt
2002, Heer & Robertson 2007, M3 tokens, WCAG 2.2.2/2.3.1/2.3.3).

### Review before install

Both skill files were read in full, as instructions that shape agent behaviour. No prompt
injection, no network or shell instructions, no credential access, no hidden/bidi unicode,
no base64 blobs. `example.html` is a self-contained WebGL2 fragment-shader demo: inline
GLSL, no external requests, no eval, no storage or network access. `name:` matches the
directory.

### Known caveats

- **The `od:` frontmatter block is inert here.** `mode`, `platform`, `scenario`, `preview`,
  `design_system` and `craft` are OpenDesign platform directives. Claude Code reads `name`
  and `description`; the rest is documentation.
- **"Powered preview" does not exist in this repo.** The skill's premise is that OpenDesign
  serves the file in a cross-origin-isolated iframe with `allow-same-origin`, so
  `SharedArrayBuffer` and real Workers are available. Nothing here does that. Plain WebGL2
  works anywhere; `SharedArrayBuffer` needs COOP/COEP response headers, which
  `apps/marketing` does not set. Do not assume the isolated context.
- **There is no `DESIGN.md`.** Step 3 says to map accents to "the active DESIGN.md". This
  repo's equivalents are `docs/design/tokens.json` (system of record),
  `apps/marketing/src/styles/marketing-tokens.css` (marketing type and colour), and the
  HalalGoes design system artifact.
- **Do not carry the reference's palette into HalalGoes work.** `example.html` uses lime
  `#63fe13` as a full-bleed accent. Invariant 10 reserves solid green to `color.halal.*`
  and lint rule L-4 enforces it, so that accent would fail the gate. The example also uses
  `backdrop-filter: blur(6px)`, which the design system rules out ("No backdrop blur; no
  frosted glass"), and a dark ground, where the marketing site is cream.
- **Weigh it against the measured cost.** Research in this repo (Sep 2026) measured a
  runtime three.js/R3F hero at 155-271 KB gzipped against a ~230 KB page, and found Apple
  ships pre-rendered scroll-scrubbed frames rather than WebGL. A live GPU canvas is the
  right tool for a shader field that cannot be pre-rendered; it is the wrong tool for a
  fixed animation that can be. `craft/animation-discipline.md` makes the same point from
  the craft side: "Don't animate to teach, decorate, signal 'premium', or fill silence."

---

## Pack 4 — build-threejs-scroll-worlds (1 skill), added Sep 2026

Source: **mengto/skills**, commit `5f47e389dac337a1bca5cddf376419248b3010f6` (2026-09-17),
path `agent-skills/web-design/build-threejs-scroll-worlds/`. Fetched by anonymous public clone
through the session's git proxy — no repo attached, no credentials.

Licence: **MIT, "Copyright (c) 2026 Meng To"** — full text in `LICENSE-mengto-skills-MIT`.
No file was modified; all seven are byte-identical to upstream.

| File | SHA-256 |
|---|---|
| `build-threejs-scroll-worlds/SKILL.md` | `bb36c79ff435045f57a7f3ec3f50c27d37087c2e5a5ab1b17b6ba219d3f2c091` |
| `build-threejs-scroll-worlds/references/kage-anatomy.md` | `0f14a21eef2fcac4d9e43be42ca93c049d82e2fdf3430857d7fe5b0d8080651e` |
| `build-threejs-scroll-worlds/references/quality-and-qa.md` | `4f422973f46d4ec3a9eead3e4816998a33fd5ba78ddff0c3dbd17b5ebf204eaf` |
| `build-threejs-scroll-worlds/references/realtime-architecture.md` | `1f4bcb2ed0f1bbf5f48d8b7372e1296894f1e99148b5376455eada0c51ad5c63` |
| `build-threejs-scroll-worlds/references/scroll-conductor.js` | `d72cb6da9f4ad5cdfb1ea42678a073a74f590154f639cf66737d194d1d63c103` |
| `build-threejs-scroll-worlds/references/world-bible.md` | `292600301358e93e20794eae093f539348358aa0db433fab84633fdae9d08f65` |
| `build-threejs-scroll-worlds/agents/openai.yaml` | `e02a650cc1806a10b257a6efba4bc9e7a591ed511ed4e7bcd5903bdd116890a5` |

### Review before install

`SKILL.md` and `references/scroll-conductor.js` were read in full; the four reference documents
were read and scanned. No prompt injection, no network or shell instructions, no credential or
env access, no `eval`/`Function`, no storage or cookie access, no base64 blobs, no hidden or
bidi unicode. `scroll-conductor.js` reads `scrollY` and element geometry and writes to a state
object — nothing else. `name:` matches the directory.

### What was NOT vendored, and why

Upstream ships a `demo/` folder — the "Kage" reference build — at **3.4 MB**: a 238 KB
`index.html`, a second bundled copy of `three.min.js` (608 KB), a 99 KB `fonts.css`, sixteen
WebP textures of a Japanese shrine, and a preview JPEG. It is a sample output, not instruction,
and none of its subject matter is reusable here. Left out, consistent with packs 1 and 2 where
upstream `examples/` and `evals/` were also skipped.

**Consequence: SKILL.md's link to `demo/index.html` is dead in this checkout.** Its own text
says the demo "is staging, not a mandatory subject or layout" and routes detail through
`references/kage-anatomy.md`, which IS vendored — so the skill stands without it. Re-fetch the
folder from upstream if a visual reference for the quality bar is ever wanted.

### Known caveats

- **It routes to four sibling skills that are not installed** — `threejs`,
  `scroll-world-storytelling`, `scroll-scrubbed-visual-sequence`, and
  `cinematic-scroll-storytelling`. All four exist upstream in the same directory. The routing
  block is the first section of SKILL.md, so the dead ends are load-bearing rather than
  cosmetic. **`scroll-scrubbed-visual-sequence` in particular is the technique this repo's own
  research and POC converged on** (`apps/marketing/experiments/hero-flipbook/`), and SKILL.md
  explicitly hands off to it for "a video or image sequence whose time is scrubbed by scroll".
  Installing it would close the most important gap; it is 148 KB across 6 files.
- **"Use the Codex browser for visual and interaction verification"** names a tool that does not
  exist here. The equivalent is Playwright with the pre-installed Chromium at
  `/opt/pw-browsers/chromium` — which is what the hero-flipbook experiment uses.
- **Its performance envelopes are far above this site's budget.** SKILL.md proposes a critical
  initial transfer of 3-6 MB on mobile and 5-10 MB on desktop. The marketing site currently
  ships ~230 KB gzipped in total, and the measured flipbook alternative is 201 KB for 60 frames.
  Those envelopes are honest for an immersive 3D world; they are not a budget this page can
  adopt. Treat them as the cost of the technique, and decide accordingly.
- `agents/openai.yaml` is an OpenAI Codex interface manifest (display name, default prompt). It
  is inert in Claude Code and vendored only for completeness.
- The skill is written for building a whole scroll-driven world, not a hero element. Its
  strongest transferable parts for this repo are the scene-ledger-as-data pattern, the
  separation of exact scroll progress from smoothed render progress, and
  `references/quality-and-qa.md`'s verification list.

---

## Pack 5 — 3D rendering (8 skills), added Sep 2026

Source: **mengto/skills**, commit `5f47e389dac337a1bca5cddf376419248b3010f6` (2026-09-17),
path `agent-skills/3d/`. Same repo and licence as pack 4: **MIT, "Copyright (c) 2026 Meng To"**,
text in `LICENSE-mengto-skills-MIT`. Nothing was modified.

`3d-falling-leaves` · `3d-four-seasons` · `3d-high-poly-models` ·
`3d-high-resolution-textures` · `3d-retina-resolution` · `3d-sky-background` ·
`3d-sky-rays` · `3d-virtual-tour`

Each is `SKILL.md` + `REFERENCES.md` + `agents/openai.yaml`. All 24 files verified
byte-identical to upstream. Rather than 24 rows, the manifest hash is recorded — reproduce it
from `.claude/skills/` with:

```bash
find 3d-falling-leaves 3d-four-seasons 3d-high-poly-models 3d-high-resolution-textures \
     3d-retina-resolution 3d-sky-background 3d-sky-rays 3d-virtual-tour -type f \
  | sort | xargs sha256sum | sha256sum
# 54194e43885eb381c2f47c341ad0e2d54290b90c087fb07848e648849cc0c378
```

Upstream's `agent-skills/3d/README.md` (the index) is not vendored — it is a directory listing
whose relative links would all be wrong here.

### Review before install

**All eight `SKILL.md` files were read in full**, plus a `REFERENCES.md` sample, plus an
automated scan across all 24 files for network/shell instructions, `eval`/`Function`,
`child_process`, `process.env`, cookie and storage access, credential patterns, base64 blobs,
and bidi/zero-width unicode. Nothing found. Each `REFERENCES.md` is a link list only — pinned
GitHub permalinks into `MengTo/seijaku` plus three.js documentation. Every `name:` matches its
directory.

Quality note, since it bears on whether to trust them: these are unusually careful. They
repeatedly separate a reference implementation's choices from requirements ("Seijaku's reference
uses 72 samples, which is a reference choice rather than a required quality floor"), and they
warn against overclaiming ("Claim ultra-realistic appearance only when the rendered result
supports it"). That posture matches this repo's own.

### Which of these actually bear on this project

Three do:

- **`3d-retina-resolution`** — directly applicable. The hero-flipbook experiment
  (`apps/marketing/experiments/hero-flipbook/`) currently renders at `setPixelRatio(1)`; any
  real build needs 2×, and this covers the renderer/composer double-ratio trap that silently
  allocates 4× targets.
- **`3d-high-resolution-textures`** — the POC puts the app UI on a `CanvasTexture`. This covers
  texel density against projected pixel coverage, sRGB vs data maps, mip and anisotropy
  behaviour, and the GPU-memory arithmetic (a 4096² RGBA8 map with mips is ~85 MiB resident,
  regardless of how small the download was).
- **`3d-high-poly-models`** — LOD and instancing guidance, marginally relevant.

Five do not, and are installed for completeness rather than use: `3d-sky-rays`,
`3d-sky-background`, `3d-falling-leaves`, `3d-four-seasons`, `3d-virtual-tour`. They assume an
atmospheric outdoor world — sun shafts, seasons, foliage, architectural walkthroughs. This site
is a phone on a flat cream ground. Do not reach for them here.

### Known caveats

- **Their performance framing assumes a live runtime scene.** This repo's measured position is
  that the sequence should be pre-rendered (201 KB for 60 frames, vs 155–271 KB gz of JS for a
  runtime three.js hero). Most of what these skills optimise — LOD thresholds, shadow-casting
  light counts, texture streaming, startup stalls — does not apply when frames are rendered
  offline. `3d-retina-resolution` and `3d-high-resolution-textures` still do, because they
  govern the offline render's output quality.
- **`3d-falling-leaves` routes to a `falling-leaves` skill** (2D canvas overlay) that is not
  installed. Same class of dead end as pack 4's routing block.
- `agents/openai.yaml` in each is an OpenAI Codex interface manifest, inert in Claude Code.
- These skills reference Seijaku by pinned commit. Those links are upstream's, not verified here.

---

## Pack 6 — react-three-fiber (1 skill), added Sep 2026

Source: **vercel-labs/json-render**, commit `3ad381881194e7011ad3ccd6d668033495a06c29`
(2026-09-18), path `skills/react-three-fiber/`. Anonymous public clone, no credentials.

Licence: **Apache-2.0, "Copyright 2025 Vercel Inc."** — text in
`LICENSE-json-render-Apache-2.0`. It is a *different* copy from pack 3's Apache text (different
copyright holder and appendix), so it ships as its own file rather than sharing one. No NOTICE
file upstream. The single vendored file is byte-identical to upstream:

| File | SHA-256 |
|---|---|
| `react-three-fiber/SKILL.md` | `f1120aeaf7cf695838b4daa37879403b007014babaf7ec3fed1eaafc7fb61593` |

Reviewed in full: no prompt injection, no network or shell instructions, no credential access,
no hidden unicode. It contains only TypeScript/JSON usage examples.

### This one is a different kind of thing from packs 3-5, and the difference matters

Packs 3, 4 and 5 are **technique guidance** — they teach how to do something and apply to any
codebase. This is an **API reference for one npm package**, `@json-render/react-three-fiber`.
It documents that package's 19 components, its catalog/registry pattern, its JSON spec format
and its Zod material schema. It is useful only if this repo adopts `json-render`, a Vercel Labs
library for rendering UI from JSON specs (its usual purpose is model-generated UI).

**This repo does not use json-render, and nothing here proposes to.** As installed, the skill is
reference material for a dependency we do not have.

### Known caveats

- **It mandates the runtime path this repo's measurements argue against.** Its peer dependencies
  are `@react-three/fiber >= 8`, `@react-three/drei >= 9`, `three >= 0.160` — measured at
  264-271 KB gzipped, against a marketing page that ships ~230 KB gz in total. The measured
  alternative, pre-rendering frames offline, is 201 KB for 60 frames and puts three.js in
  devDependencies (`apps/marketing/experiments/hero-flipbook/`). A JSON-spec runtime renderer
  adds nothing when the frames are rendered ahead of time.
- **Its stated React range is wider than R3F actually supports.** The skill says `react ^19.0.0`;
  react-three-fiber 9.7.0 peers `react >=19 <19.3` (scheduler ^0.27 against React 19.3's 0.28).
  This repo pins react 19.1.0, so it installs today, but adopting it pins us out of 19.3.
- It names sibling `@json-render/*` skills (`core`, `react`, `next`, `shadcn`, and ~27 others in
  the same upstream folder) that are not installed. Without at least `core` and `react`, the
  catalog/registry examples here have no counterpart to read.
- Nothing in it is specific to this project's constraints — no halal invariants, no contrast
  floor, no reduced-motion guidance. Treat it as vendor documentation, not craft guidance.

---

## Pack 7 — Blender (2 skills), added Sep 2026

Source: **TerminalSkills/skills**, commit `511ec2060fe9e1b95a42ae042964f56d777b6c9b`
(2026-09-13), paths `skills/blender-render-automation/` and `skills/blender-scripting/`.
Anonymous public clone, no credentials.

Licence: **Apache-2.0, "Copyright 2025 Terminal Skills"** — text in
`LICENSE-terminalskills-Apache-2.0`. A third distinct Apache copy (packs 3 and 6 have their
own holders), so it ships as its own file. No NOTICE upstream. Both files byte-identical:

| File | SHA-256 |
|---|---|
| `blender-render-automation/SKILL.md` | `3a63d3ca037cb11bd9d70e7dad6cfd03afeaaec078980d2221e7c392e444fbbe` |
| `blender-scripting/SKILL.md` | `2a944c129418472c0a21adafb47ad1e1ed6e5884854a7345ea7f170dfdd124d6` |

Upstream's `_scores.json` is not vendored — it is the publisher's own ranking metadata.

### Review before install

Both read in full and scanned: no prompt injection, no network or shell instructions beyond
the documented `blender --background --python` invocation, no `eval`/`exec`/`subprocess`, no
credential or env access, no hidden unicode. They are `bpy` API guidance with worked examples.

### Why these two, out of the dozen found

A web sweep found roughly a dozen repositories publishing Blender skills. Most are unusable
here for one of three reasons, and the reasons are worth recording so nobody re-evaluates them:

- **They require a Blender GUI.** The two largest collections (arjun988/blender-skills, 94
  skills; kevinbadi/blender-skills, 16) drive everything through **BlenderMCP**, whose addon
  opens a TCP socket from Blender's N-panel. Its own troubleshooting says commands *"never
  execute when Blender is running in headless mode"*. Useless without a display server.
- **The licence does not permit this use.** TMHSDigital/Blender-Developer-Tools'
  `headless-batch-scripting` is the best-written of the lot, and it is **CC-BY-NC-ND-4.0** —
  non-commercial, no derivatives. Not usable on a commercial product.
- **They are about export, not rendering.** freshtechbro's `blender-web-pipeline` covers glTF
  export for three.js and does no rendering.

These two are Apache-2.0 and headless-native (`blender --background --python`, args after `--`).

### Known caveats

- **Blender is NOT preinstalled.** It was installed for this repo from the official tarball —
  4.5.14 LTS at `/opt/blender`, which runs `--background` with no GPU and no display server.
  See `apps/marketing/experiments/hero-blender/README.md` for the command. That install does
  not survive a fresh container.
- **`blender-render-automation` leads with GPU configuration** (`cycles.device = 'GPU'`,
  CUDA/OptiX/HIP). There is no GPU here. Use `cycles.device = 'CPU'`; everything else applies.
- It also suggests `EEVEE` for previews. **EEVEE needs a GL context** and will not run
  headless without xvfb; only Cycles renders with no display server. Use Cycles.
- `blender-scripting`'s compatibility note suggests `apt install blender`, which would fetch
  Ubuntu's 4.0.2. The tarball is newer and self-contained; prefer it.
- Its advice to render animations as PNG sequences rather than straight to video is right, and
  doubly so here: there is no ffmpeg in this environment, so video encoding is not available
  at all. Frames are encoded to WebP with Pillow instead.

### A correction, recorded because the numbers were measured

The research that surfaced these skills recommended **against** installing Blender, estimating
30–120 s/frame and concluding the three.js pipeline was sufficient. Measured on this container
(4 cores, Cycles CPU, denoised, 720×960, 32 samples): **~6.5 s/frame**, about 5–18× faster than
the estimate. Its samples and resolution were higher, so the figures are not contradictory —
but the conclusion drawn from them was wrong for this case, and Blender resolved a model
orientation problem that three.js could not (see the hero-blender README). Prefer the
measurement.
