# Third-party skills — provenance

Two vendored skill packs. Both MIT. Fetched Sep 2026 over public
`raw.githubusercontent.com` (no repo attached to the session, no credentials).

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
