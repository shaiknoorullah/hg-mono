# Plan A — Contracts-First Spec Pyramid + Walking Skeleton + Adversarial Verification

> This is the incumbent plan (authored by the lead agent). It competes on equal terms with all alternatives.

## Core thesis
The scarce resource is **human verification bandwidth**, not agent typing speed. An agent that writes 50 files/hour can write 50 subtly-wrong files/hour. Every named risk (hallucination, blind spots, mis-design, rewrites) has one root cause: **unverified work accumulating faster than anyone catches it.** Therefore: make every increment machine-verifiable and small enough to discard. Optimize for *reviewer-trust per PR*.

## 1. Planning system — frozen spec pyramid, expanded just-in-time
Three levels; each reviewed and frozen before the next expands.
1. **Spec-of-record**: bounded contexts, domain model, event catalog, API contracts as `.proto`. Nothing downstream may contradict it. Small, highest-leverage, hard human review once.
2. **Milestone slices**: vertical, releasable, dependency-ordered. Each is a thin end-to-end path, not a horizontal layer.
3. **PR-sized work units**: one behavior each, max one contract change, red-green-refactor.

Only expand one level at a time. Milestone N in full detail; N+1 stays a sketch (reality invalidates far-future detail).

## 2. Walking skeleton before features
First deliverable is not a feature: the thinnest slice through the *real* target — one proto → one Go service (from golden-path template) → one client call → deployed behind Traefik in docker-compose, with health checks, tracing, CI green, TDD gates live. De-risks integration (the #1 blind spot) before features exist. Every later service is the same shape, so structure cannot be hallucinated per-service.

## 3. Execution loop (async factory; author never approves)
- **Lead agent** writes a small work-order: context, contract, acceptance tests, boundaries. Lead's main job is decomposition/sequencing, not writing most code.
- **Implementer agent**: red-green-refactor in an isolated git worktree.
- **Independent adversarial verifier(s)**: prompted to *refute*, not bless.
- **CI gates**: contract-drift gate, diff-coverage (no untested new line merges), integration tests vs real deps (testcontainers), lint-as-error.
- **Then** a small PR with plain-English summary reaches the human. PRs stack (N+1 on N's branch) so the factory never blocks on review.

## 4. Risk → structural prevention
- **Hallucination** → contracts-first + generated code + CI drift gate; tests-first means invented behavior has no green test to hide behind.
- **Blind spots** → independent adversarial verification + integration tests vs real Postgres/Redis + per-milestone "what's missing?" completeness critic.
- **Mis-design** → design frozen in reviewed spec before code; every reversible decision behind a small port/adapter.
- **Big bugs/rewrites** → small reversible PRs + delivery-first + **every HalalGoes bug encoded as a permanent regression test** (server-authoritative pricing, auth required, private KYC buckets).

## 5. Orchestration (Temporal replacement)
Do not adopt another heavy engine. Put orchestration behind an internal `Saga`/`Orchestrator` **port**; implement with the simplest Go-native durable primitive: **transactional outbox + explicit saga state machine in Postgres + River (Go-native Postgres-backed queue) for retries/timers/async steps.** Zero new infra, pure Go, trivially unit-testable. If outgrown, **Restate** swaps in behind the port. Default: outbox + River.

## 6. Deployment
compose + Traefik from the walking skeleton onward; routing/LB/TLS via labels; one compose service per service. e2e tests run against the *composed* stack in CI, so "it deploys" is proven continuously.

## 7. UI/UX overhaul
Design as an upstream frozen spec: design-system + user-flows + wireframes reviewed *before* implementation. Build the design-system package first (tokens + primitives); every screen consumes it. Prevents the divergence seen in HalalGoes (four regional configs, mock screens).

## 8. Start sequence
1. Spec-of-record (bounded contexts + event catalog + first protos + encoded-invariants list) — one hard human review.
2. Walking-skeleton PR — one service through Traefik/compose with all gates live.

## Known weaknesses (self-critique)
- "Freeze the spec" can become a mini-waterfall; if the domain model is wrong, everything downstream inherits it.
- Adversarial verification cost scales linearly with PR count; may become the bottleneck.
- Diff-coverage gates measure *that* tests exist, not that they are meaningful.
- Assumes the human reviewer can meaningfully judge a small PR without whole-system context.
- Big-bang rewrite risk: nothing ships to real users until many milestones land.
