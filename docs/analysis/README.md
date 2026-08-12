# Analysis

Research that informed this rebuild. None of it is a specification — the specs live in `docs/spec/`.

## `legacy-system/`
Forensic analysis of the three repos being replaced (`hg-api`, `halal-goes`, `hg-docker`), produced by a 19-agent fleet. Read `crosscut-order-flow.md` and `gap-realtime-dispatch.md` first — they explain most of the invariants in `AGENTS.md`.

Load-bearing findings:
- The published backend was **not** the one serving production; ~60 called endpoints had no handler in the source.
- Checkout charged a client-supplied price, and because the pricing endpoint was broken, orders persisted **all-zero** monetary fields.
- Live MinIO credentials were committed in cleartext; the rider KYC bucket was world-readable **and** world-writable.
- Rider earnings were never credited and ratings were never submitted — with no invariant, no diff, no dead code and no runtime symptom. This is why the Closure Ledger exists.

## `base-evaluation/`
Whether to build on `ts-monorepo-template`. Conclusion: **harvest, do not fork** — take the contracts pipeline and Nx/tooling patterns, leave the multi-tenant SaaS spine and the stubbed platform layers.

## `../planning/`
Six competing operating models, judged on delivery risk, correctness and review bandwidth, then synthesised into one winner (`WINNER.md` — "Front Door Factory"). Note that its strangler-fig spine was later invalidated: it assumed a live production system to strangle, and there wasn't one. The verification mechanisms survived; the migration strategy did not.
