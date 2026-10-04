---
covers:
  - apps/marketing/experiments/**
  - apps/marketing/src/components/Hero.tsx
reviewed: 2026-09-28
---

# Decision: the hero direction — signed page or scroll-driven device sequence

_Sep 2026. **SETTLED — Option B, client-instructed.** Written while open; resolved the same
day. The record of the conflict is kept below because the conditions attached to Option B are
now committed work, and because the process failure that produced it is worth not repeating._

## The conflict, plainly

The client asked (verbatim, this session) for a hero built from **three.js iPhone models
with screen app mockups**, **two phones — one cropped from the top, one from the bottom**,
that **animate and rotate on scroll** across **multiple sections**.

`docs/design/landing-creative-direction.md` §7 forbids almost exactly that:

> **Explicitly forbidden:** any motion on the seal — ever (stamp, pulse, shimmer,
> ring-draw); Ken Burns / hero zoom; parallax; **scroll-scrubbed or pinned sequences**;
> marquees and infinite tickers; count-up numbers; word-by-word or letter-by-letter
> reveals; blur-in text; custom cursors; magnetic buttons; `animation-timeline: view()`
> as a visibility mechanism; and any dependency on GSAP, Lenis, Framer or Locomotive.

> **Total JS on `/`:** one `<head>` class-setter, one ~25-line observer module, one form
> island, one clipboard handler. Nothing else.

And §6 (line 624) bans, among the art direction's "never" list, **"any tilted phone
mockup."**

So the brief and the direction are not in tension at the margins. They are opposites. One
of them has to give, in writing, and this file is where that happens.

**This was found late.** The flipbook, Blender and live-WebGL experiments were built before
anyone read §7. That is a process failure, not an argument for either option — the work is
sunk either way, and it should not be allowed to vote.

## What was actually measured

Nothing below is an opinion about taste. These are the numbers the experiments produced.

| Thing | Measured |
|---|---|
| Pre-rendered flipbook, 60 frames @ WebP | 201 KB over the wire; 0.15–0.31 ms per scroll frame; 60/60 frames distinct and monotonic |
| Scrub controller for the flipbook | 0.36 KB gzipped |
| Baked hero ground (2-bit, 128px tile) | 7,317 B — and noise gzips *larger* than its raw PNG |
| Same ground, runtime WebGL2 shader | **1,807 B**, renders within 2/255 mean RGB of the bake |
| Live three.js device world | 14 draw calls, ~10.8k triangles; three.js r169 module ≈ 170 KB gz from CDN |
| Page as it stands today | ~230 KB gz JS total |

Two of these matter more than the rest:

1. **"Bake it, it's free" is false.** The runtime shader is 4× *smaller* than the baked
   tile, because noise is incompressible. The intuition that static assets are the cheap
   option did not survive measurement.
2. **The live version also communicated nothing extra.** The A/B renders were
   indistinguishable to the eye. That cuts against the WebGL option as much as the
   first number cuts against baking.

## The part that genuinely worries me

**Invariant 10 — "solid green is reserved to `color.halal.*`" — is enforced by lint rule
L-4, and L-4 reads text.** `packages/ui-web/src/lint/l4-no-green-solids.ts` branches on
`/\.css$/` for the rule that catches solid green backgrounds. It cannot read a fragment
shader, a uniform, or a canvas pixel.

The moment the hero becomes a canvas, invariant 10 stops being *enforced* and becomes
*hoped-for* — on the single surface whose whole job is the halal claim.

This is not hypothetical. **I shipped `#0F7A43` timeline dots into the flipbook experiment
by accident**, and only caught it by reading my own README afterwards. The live seal
experience written this session also rocks the seal ±2.5°, which §7 forbids *ever* — its
author knew, and recorded it as a deliberate departure. Two out of two 3D artefacts
breached a halal rule. A lint rule that could see them would have caught both.

**Any decision for the scroll/WebGL direction has to say how invariant 10 gets enforced
when lint cannot see inside a canvas.** Without that clause the decision is not
implementable and this file stays open.

## Option A — the creative direction governs

The hero stays type-led. §7's own M3 already specifies the seven checks as the only
motion, in SVG, at roughly 2 KB. The device work becomes a marketing asset elsewhere
(social, deck, app-store) rather than the hero.

- **For:** invariant 10 stays machine-enforced; the JS budget holds; "a page about careful,
  slow, human checking that scrolls calmly and refuses to perform *is itself the argument*"
  is a genuinely good argument, and it is the signed one.
- **Against:** it is not what the client asked for, and the client has seen the
  alternatives.

## Option B — the brief supersedes §7, explicitly

§7's forbidden list and JS cap are amended for `/` only. The device sequence ships.

This option is only viable with **all** of the following written into it:

1. **L-4 gains a rendered-pixel check.** A headless render of the hero at N scroll
   positions, sampled for saturated green outside the seal's own bounding box, run in CI.
   Without this, do not choose Option B.
2. **The seal itself never moves** — the §7 seal clause is *not* amended. It is the one
   line in §7 that is about the halal claim rather than about taste. The live seal page
   must lose its rocking before anything derived from it ships.
3. **A measured JS ceiling for `/`**, replacing "nothing else" with a number, so the cap
   is still falsifiable.
4. **The CC-BY credit ships with the render**, not after it (see below).
5. **Reduced motion is a real path, not a degraded one** — both experiments already do
   this; it becomes a requirement rather than a courtesy.

## Also outstanding either way

- **`#6E7C77` (`color.ink.muted`) fails AA on cream at ~4.2:1.** Two independent design
  agents found it. It is a live token defect in `docs/design/tokens.json`, unrelated to
  this decision, and it should be fixed regardless of which option wins.
- **The Sketchfab model's CC-BY attribution** must appear in the site footer before any
  render using it ships — the client agreed to this when supplying the model. Changes to
  indicate, per the licence: backdrop geometry removed, Apple logo repainted to the chassis
  colour, chassis recoloured to `#232323`.
- **Apple's Identity Guidelines** list "rendering in 3D or creating any simulation of an
  Apple product" among unauthorized uses. The artist's CC-BY grant covers their mesh, not
  Apple's design rights. This is a business-risk call the client took knowingly; it is
  recorded here so it is not rediscovered later.
- **§7 is partly stale independent of this decision.** It was written for the Astro app
  that has since been deleted, names `Faq.astro` / `SocialProof.astro`, and specifies Plus
  Jakarta Sans for headings — which the client superseded with Bricolage Grotesque at Gate
  F. Whichever option wins, the file needs a pass for that.

## Recommendation

**Option A, unless the client wants B knowing the clause in Option B.1 is the price.**

Not because the device work is bad — it measured well and it is built — but because the
enforcement gap is real, it has already caused two breaches in two artefacts, and the
surface in question is the only claim the product makes. Option B is legitimate and
implementable; it just costs a CI check that does not exist yet, and it should be chosen
with that cost visible rather than discovered afterwards.

## Resolution — Option B

The client chose Option B, in these instructions:

- Design all of G1, G3 and G4 as complete scroll-driven journeys covering the whole
  marketing site, as live prototypes to scroll and test.
- Then port the chosen one to a three.js landing page.
- **Use Lenis for smooth scroll** — named explicitly. §7's forbidden list names Lenis
  specifically, so this instruction is what settles the conflict rather than merely
  bending it.

The concern in **The part that genuinely worries me** was raised before the decision and
the client proceeded, which is their call. It does not go away by being overruled: the
conditions below are now scheduled work, not caveats.

### Amendments to `docs/design/landing-creative-direction.md`

§7 is amended **for `/` only**:

- "scroll-scrubbed or pinned sequences" — **permitted.** The page is a scroll journey.
- "parallax" — **permitted**, as a consequence of the above.
- "any dependency on GSAP, Lenis, Framer or Locomotive" — **Lenis permitted. The other
  three remain forbidden**; nothing has asked for them and each is far larger.
- "Total JS on `/`: … Nothing else." — **superseded.** Replaced by a measured ceiling
  once the direction is chosen, so the cap stays falsifiable rather than becoming "as much
  as it takes". Until that number exists this clause is open.
- **"any motion on the seal — ever" is NOT amended.** It is the one clause in §7 about the
  halal claim rather than about taste. It stands. `the-seal.html` breaches it today and
  must lose its rocking before anything derived from it ships.

§6's art-direction "never" list stands unamended, including "any tilted phone mockup" —
which is why G1 crops its devices and G4 removes them entirely.

### Conditions now owed

1. **L-4 gains a rendered-pixel check** before any canvas hero reaches `apps/marketing/src/`.
   A headless render at N scroll positions, sampled for saturated green outside the seal's
   own bounding box, in CI. Without it invariant 10 is unenforced on the one surface whose
   job is the halal claim, and two of two 3D artefacts have already breached a halal rule.
2. **A measured JS ceiling for `/`**, replacing §7's "nothing else".
3. **The CC-BY credit ships with the render**, not after it.
4. **The seal stops moving.**
5. **§7 and §6 get a staleness pass** — they still name `Faq.astro` and `SocialProof.astro`
   from the deleted Astro app, and still specify Plus Jakarta Sans for headings, which Gate F
   superseded with Bricolage Grotesque.

### Status of the work

The prototypes stay in `apps/marketing/experiments/` and in published review artifacts.
Nothing enters `apps/marketing/src/` until a direction is chosen **and** condition 1 is met.
