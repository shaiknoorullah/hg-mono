# Live WebGL hero experiments

**Status: experiments. Nothing here ships, and under the open decision nothing here *may*
ship.** Outside `src/` and `public/`, so Next never builds them. Each file is one
self-contained page — open it in a browser directly.

> **Read `docs/decisions/hero-motion-and-the-creative-direction.md` first.** The repo
> carries a signed creative direction (`docs/design/landing-creative-direction.md` §6–§7)
> that forbids scroll-scrubbed sequences, parallax, tilted phone mockups and any JS on `/`
> beyond four small islands. These pages are all three. That conflict is **open and needs
> the client**; it was found after these were built.

## The pages

| File | What it is |
|---|---|
| `device-world.html` | Two unbranded handsets, A bleeding past the top edge and B past the bottom, carrying an order from a verified listing to the door across five keyframes. The brief as given. |
| `the-seal.html` | The seal as real geometry — LatheGeometry brass bezel, sage plate, the brand shield and check extruded from the exact SVG path — struck onto the certificate it vouches for. |
| `ink-field.html` | The type-led treatment: paper as a halftone screen rather than a gradient. The closest of the three to what §7 actually specifies. |

All three: three.js r169 from cdnjs, one persistent scene, native scroll as the conductor
(exact progress owns DOM state, a damped copy owns the camera), reduced motion as a real
path rather than a degraded one, `document.hidden` pauses rendering, and a visible fallback
with the full ordered story when WebGL 2 is unavailable.

## Known defects, recorded rather than hidden

1. **`the-seal.html` rocks the document ±2.5°, and the seal rides with it.** §7 forbids
   motion on the seal *ever*. Its author recorded this as a deliberate marketing-page
   departure from the product rule. It is a breach either way and must be removed before
   anything derived from this page ships.
2. **Invariant 10 is unenforceable here.** L-4
   (`packages/ui-web/src/lint/l4-no-green-solids.ts`) branches on `/\.css$/` for the solid-
   green rule — it reads text, so it cannot see a fragment shader, a uniform or a canvas
   pixel. The hero-ground flipbook experiment shipped `#0F7A43` timeline dots by accident
   for exactly this reason. Two of two 3D artefacts breached a halal rule before review.
3. **Frame rates are unmeasured on real hardware.** Both pages were verified only under
   headless SwiftShader (1–12 fps, software). `device-world.html` is 14 draw calls /
   ~10.8k triangles and should sit at refresh rate on any GPU, but that is an expectation,
   not a measurement.

## Claims

Every factual assertion on these pages comes from `apps/marketing/src/lib/claims.ts`. The
seven checks were **corrected** after the fact: the first draft said the issuer was "an
accredited Canadian authority" (HFSAA is American, and the register flags that explicitly),
that a certificate number is "verified against the issuing body's own record" (H7 is
computed against *our* database, not the issuer's), and that "an admin reviewed all six"
(H5 and H7 are server-computed and not overridable). All three are fixed; both the DOM list
and the printed 3D sheet now carry the register's own wording.

Values that would be real data — restaurant names, certificate numbers, dates, addresses —
are ruled blanks, per the register's rule that no listing exists yet.

## Attribution

`device-world.html` uses procedurally generated slabs, not the Sketchfab model, so it
carries no third-party attribution. The Blender pipeline in `../hero-blender/` does — see
that README for the CC-BY credit that must reach the site footer before any render using
it ships.
