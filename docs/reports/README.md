# Reports

Standalone HTML briefs produced during the planning phase. Each was published as a private artifact on claude.ai; these are the sources, kept so they can be regenerated or edited. Open any of them directly in a browser.

| File | What it argues |
|---|---|
| `01-legacy-system-atlas.html` | Full architecture map and defect inventory of the three repos being replaced |
| `02-base-decision-brief.html` | Why `ts-monorepo-template` was harvested rather than forked |
| `03-operating-model.html` | The winning operating model ("Front Door Factory") from a six-way tournament |
| `04-simplified-architecture.html` | The collapse from eight microservices to one Go binary, with diagrams |
| `05-scope-and-versions.html` | 198 features cut into V0/V1/V2/V3, and the money model |
| `06-build-completion.html` | **Build completion report (Sep 2026)** — technical whole-tree audit from a 5-way code scout: backend, apps, design system, launch readiness, v2 deferrals. PDF alongside. |
| `07-feature-readiness.html` | **Feature readiness report (Sep 2026)** — stakeholder view: the full 191-feature matrix with a build-status and a verified/not-tested column, grouped by area. PDF alongside; matrix data in `feature-matrix.json`. |

**Caveat on `03`**: its strangler-fig spine was later invalidated — it assumed a live production system to strangle, and there wasn't one. Its verification mechanisms survived; its migration strategy did not.

`06`/`07` are point-in-time status at `v1.0.0-rc1`. Regenerate a PDF from either HTML with `node tools/verify/render-pdf.mjs <in.html> <out.pdf>`.
