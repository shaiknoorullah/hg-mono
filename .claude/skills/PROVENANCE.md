# Third-party skills — provenance

Three vendored skill packs. Packs 1 and 2 are MIT; pack 3 is Apache-2.0. All fetched
Sep 2026 from public sources with no repo attached to the session and no credentials —
packs 1 and 2 over `raw.githubusercontent.com`, pack 3 by anonymous git clone.

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
  Halal Goes design system artifact.
- **Do not carry the reference's palette into Halal Goes work.** `example.html` uses lime
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
