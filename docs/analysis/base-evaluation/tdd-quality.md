# TDD & Quality-Gate Evaluation — `ts-monorepo-template`

**Scope:** Can this base support *strict, enforceable* Test-Driven Development across a
polyglot codebase (Go primary + TS/Rust/Python) for a food-delivery migration?
**Focus:** testing & quality-gate infrastructure and how enforceable strict TDD is.
**Verdict up front:** The *scaffolding* for polyglot testing is genuinely good and well-shaped;
the *enforcement* is largely soft, aspirational, or missing. Out of the box this base does **not**
make TDD non-optional. It makes testing *possible and idiomatic*, not *mandatory*.

---

## 1. Test runners per language

| Lang | Runner | Wiring | Notes |
|------|--------|--------|-------|
| **TypeScript** | **Vitest 4** (`catalog:`) | Root `vitest.config.ts` uses `test.projects` (Vitest 3.2+ replacement for `vitest.workspace.ts`). Per-package `vitest.config.ts` files discovered via globs. Nx `@nx/vite/plugin` infers `test` target. | 105 `*.test.ts/spec.ts` files. Per-app configs use `include: ['src/**/*.test.ts']` + workspace aliases. |
| **Go** | `go test` via `@nx-go/nx-go` | `apps/go-hello/project.json` → `test` (`./...`) and `test:integration` (`-tags=integration ./test/integration/...`). Mirrored in `apps/go-hello/Taskfile.yml`. | Only **3** `_test.go` files total (handlers unit test, testcontainers PG integration, one generated contracts test). Go 1.24 in CI. |
| **Rust** | `cargo test` via `@monodon/rust` | `apps/rs-hello/project.json` → `test` (`@monodon/rust:test`), `test:integration` runs `--test store_integration_test -- --ignored`. | `handlers_test.rs` (axum health/readiness), `contracts-rs/tests/shape.rs`. Integration test is `#[ignore]` by default. Rust 1.83. |
| **Python** | `pytest` via `@nxlv/python` + `uv` | `apps/py-hello/project.json` `test` runs `uv run pytest tests/test_handlers.py` **(single file, not the dir)**; `test:integration` runs `test_store_integration.py`. `pyproject.toml`: `asyncio_mode=auto`, `pytest>=8.3`, `pytest-asyncio`. | mypy `strict=true`, ruff configured. |

**Discovery/run model:** Nx is the orchestrator. `pnpm test` = `nx run-many -t test`;
`pnpm test:affected` = `nx affected -t test --base=origin/main`. Taskfile `task test` = `nx affected -t test`.
Per-app Taskfiles are included into the root `Taskfile.yml` (`go-hello`, `py-hello`, `rs-hello`).
The four inference plugins (`@nx/vite`, `@nx-go/nx-go`, `@nxlv/python`, `@monodon/rust`) are all
registered in `nx.json`, so a single `nx affected -t test` fans out across all four languages.

**Shape quality (positive):** the reference apps deliberately implement the *same* service
(health/readiness handlers, user store round-trip) in all four languages with parallel test
structure. This is a strong template for "write the test, then the impl" in any language.

---

## 2. Coverage & mutation

### Line/branch coverage (Vitest / v8)
- `@vitest/coverage-v8@^4` present. Root `vitest.config.ts` coverage: provider `v8`, reporters
  `text/html/lcov/json-summary`, `all: true`, `include: ['apps/**/src/**/*.ts','packages/**/src/**/*.ts']`.
- **Thresholds are gutted:** `statements/functions/lines: 30`, `branches: 25`, with an explicit
  `TODO: ratchet back to 80/80/80/70 once test coverage catches up`.
- **Documentation contradicts reality:** `AGENTS.md` §"Coverage thresholds: lines/statements/functions ≥ 80%, branches ≥ 70%" — the *enforced* number is 30/25. A team reading the docs would believe an 80% gate exists that does not.
- **Coverage is TS-only.** The `include` globs never touch Go/Rust/Python. **There is no
  line-coverage gate for the primary Go backend, nor for Rust or Python** anywhere in the repo
  (no `-coverprofile`, no `cargo-llvm-cov`, no `pytest --cov`).
- A **second** coverage config exists at `internal/mcp-server/vitest.config.ts` with real
  80/75/80/80 thresholds — but the `mcp-validate` CI job runs `nx test` / `vitest run test/contract`
  **without `--coverage`**, so that 80% threshold is never actually evaluated in CI.

### Type coverage
- `type-coverage` configured hard: `typeCoverage.atLeast: 95, strict: true` in `package.json`;
  CI runs `type-coverage --at-least 95 --strict --detail` as a **hard gate** (not soft-failed).
  This is real and enforced — but it measures *type* soundness (absence of `any`), **not test coverage**.

### Mutation testing (Stryker)
- **Declared but non-functional.** `@stryker-mutator/core`, `@stryker-mutator/typescript-checker`,
  `@stryker-mutator/vitest-runner` are all in devDependencies (`^9.6.0`), **but there is no
  Stryker config file anywhere** (`stryker.conf.*` / `.stryker*` — none found).
- `knip.json` explicitly `ignoreDependencies: ['@stryker-mutator/*']`, i.e. the tooling knows they
  are unused and suppresses the dead-dependency warning. There is **no `mutation` npm script, no Nx
  target, and no CI job** invoking Stryker. Mutation testing is aspirational only.

---

## 3. Integration / e2e / contract testing

### testcontainers — real, but off the default path
- Go `test/integration/user_pg_test.go` spins up `postgres:16-alpine` via
  `testcontainers-go/modules/postgres` and does a genuine create/get round-trip. Good test.
- Python `tests/test_store_integration.py` and Rust `tests/store_integration_test.rs`
  (`testcontainers[postgres,redis,kafka]` in `pyproject.toml`) exist.
- **All are behind separate `test:integration` targets / build tags / `#[ignore]`** and are **not**
  part of `nx affected -t test`, so they do **not** run in `ci.yml` or `pr.yml`. No CI job invokes
  any `test:integration` target. Integration coverage is present as capability, absent as gate.

### Playwright / msw — declared, zero usage
- `@playwright/test` + `playwright@^1.50` in devDeps, but **no `playwright.config.*` and no e2e
  specs exist** (grep found none). knip ignores `playwright`.
- **msw is not present at all** (no dependency, no `setupServer` usage). The prompt's mention of msw
  does not correspond to anything in the repo.

### The many `__tests__` dirs — mostly *structural conformance*, not behavioral
There are ~45 `__tests__` directories. A representative sample shows they overwhelmingly assert
**file/shape/metadata conformance**, not runtime behavior:
- `tests/apps/go-hello-metadata.test.ts` — asserts `project.json` has the right target names,
  `META.yaml` matches schema and lists `XPostgresCluster/XRedisCluster/XKafkaTopic` needs, and that
  `AGENTS.md/README.md/values*.yaml/Taskfile.yml` exist. (No code is executed.)
- `tests/smoke/cross-lang.test.ts` — the live cross-language parity suite (create/read round-trip,
  JSON-log `trace_id`, Prometheus metrics) is **`describe.skipIf(!SMOKE)`** — skipped unless
  `SMOKE=1`. Only the "offline shape check" (3 endpoints, port shape) runs by default.
- `data/cloud-prices/__tests__/schema.test.ts`, `.audit/__tests__/genesis-chain.test.ts`,
  `docs/__tests__/glossary.test.ts`, `tests/nx/polyglot-plugins.test.ts`, `tests/ci/pr-workflow.test.ts`
  — schema validation, doc-glossary, and CI-config assertions.
- `internal/mcp-server/test/contract/*` (`deferred_stub_conformance`, `schema_completeness`) — the
  only "contract" tests actually run in CI (via `pr.yml` `mcp-validate`).

These are useful *guardrails on the template's own structure*, but a team should not mistake them
for behavioral test coverage of application logic.

---

## 4. Quality gates & enforcement

### Git hooks (`lefthook.yml`)
- **pre-commit** (parallel): `eslint --fix` on staged TS/JS, `prettier --write`, `tsc -b` (types).
- **commit-msg**: `commitlint --edit` (conventional commits; `commitlint.config.cjs`).
- **pre-push**: `nx affected -t test --base=origin/main` (this *does* run tests including Go/Rust/Py
  before push) + `knip` **soft** (`|| true`).
- Local only, bypassable with `--no-verify`. Not a server-side guarantee.

### ESLint (`eslint.config.mjs`)
- Impressively broad stack: `strictTypeChecked` + `stylisticTypeChecked` + unicorn + sonarjs +
  perfectionist + import-x + promise + security + vitest plugin.
- **But almost every rule with teeth is downgraded to `warn`** (all `no-unsafe-*`, `no-explicit-any`,
  `no-non-null-assertion`, `no-unnecessary-condition`, deprecation, whole perfectionist family off,
  import-x resolver rules off). Dozens of `TODO: re-enable` comments.
- **CI runs `eslint . --quiet`**, which *suppresses warnings entirely* — so the lint gate only fails
  on the handful of remaining `error`-level rules. As a correctness gate for TDD it is nearly toothless.

### CI workflows — what actually blocks a PR
`ci.yml` jobs (on PR + push to main):
| Job | Blocks? |
|-----|---------|
| **lint**: `eslint --quiet` | Blocks only on `error`-level rules (few). Prettier `--check` **hard**. markdownlint hard. cspell/yamllint/shellcheck all `continue-on-error`. |
| **type-check** (Node 20 + 22) | **Hard** — `nx run-many -t type-check`. |
| **test**: `pnpm test:coverage` | **Hard** — runs Vitest with the **30/25** coverage threshold (TS only). Codecov upload `fail_ci_if_error: false`, no `codecov.yml` ⇒ informational. |
| **build**: `nx run-many -t build --exclude=py-hello` | Hard, but py-hello excluded (documented `@nxlv/python` regression). |
| **deps**: syncpack lint **hard**, manypkg check **hard**, type-coverage ≥95 **hard**; knip/attw/publint all **soft** (`|| true` + `continue-on-error`). |

`pr.yml` jobs:
- **nx-affected**: `nx affected -t lint test build` — this is the job that actually exercises
  **Go/Rust/Python tests** (setup-go 1.24, uv, rust 1.83). If a language test fails, this job fails.
- **polyglot-typecheck**: `tsc --noEmit`, `mypy src`, `cargo check --all-targets`, `go build ./...` — hard.
- **mcp-validate**: builds + tests `mcp-server`, then contract suite. Hard.
- Crossplane / terraform / claims validation jobs.
- **Caveat:** several jobs carry `continue-on-error: ${{ github.event.pull_request.number == 2 }}`
  (the foundation PR) and the e2e workflows are soft.

**Branch protection:** No `CODEOWNERS`, and branch-protection rules live in GitHub settings (not in
repo), so *whether these "hard" jobs are required to merge cannot be confirmed from the repo*. Nothing
in-tree guarantees they block merge.

### The e2e / bringup pipeline is stubbed
`Taskfile.yml` `ci:bringup`, `ci:smoke`, `ci:observability:assert`, `ci:claims:assert`,
`ci:image-updater:assert`, `ci:kargo:assert`, `ci:evidence:collect`, `ci:teardown` are **all stubs**
that `echo "::notice:: ... is a stub"` and exit 0. The `e2e-p-{solo,hobby,startup-small}.yml`
workflows call these verbs, so the entire profile-based e2e/smoke gate is a no-op today.

### Is anything tests-first? 
**No.** Nothing enforces (a) that a test exists before code, (b) new-code/patch coverage, or (c)
that behavior is pinned by tests (no mutation gate). The only floor forcing tests to *exist at all*
is the **30% TS line/statement threshold**, and it doesn't touch the Go primary backend.

---

## 5. Honest real-vs-stub ledger

| Gate / capability | Status |
|---|---|
| Vitest multi-project runner | **REAL**, well-configured (Vitest 4, `test.projects`). |
| Go/Rust/Python test targets via Nx | **REAL** — run in `pr.yml` `nx affected`. |
| `nx affected` test fan-out across 4 langs | **REAL**. |
| type-coverage ≥ 95% | **REAL & hard** (types, not tests). |
| prettier `--check`, markdownlint, syncpack, manypkg, type-check (20+22) | **REAL & hard**. |
| ESLint strict stack | **DECLARED, defanged** — most rules `warn`, CI `--quiet` drops warnings. |
| Vitest line coverage | **REAL but 30/25**, TS-only; docs claim 80/70 (**doc≠reality**). |
| Codecov | **INFORMATIONAL** — `fail_ci_if_error:false`, no `codecov.yml`, no status checks. |
| mcp-server 80% coverage threshold | **DEAD** — job runs test without `--coverage`. |
| Stryker mutation testing | **STUB** — deps only, no config, no script, no CI, knip-ignored. |
| Playwright e2e | **STUB** — dep only, no config, no specs. |
| msw | **ABSENT**. |
| testcontainers integration (Go/Rust/Py) | **REAL code, NOT in CI** — separate targets/`#[ignore]`/tags. |
| Go/Rust/Python coverage gates | **ABSENT**. |
| e2e `ci:*` bringup/smoke verbs | **STUBS** (echo `::notice::`, exit 0). |
| Cross-lang smoke parity suite | **SKIPPED** unless `SMOKE=1`. |
| Branch protection requiring the gates | **UNVERIFIABLE** from repo (no CODEOWNERS, settings off-tree). |
| Tests-first / patch-coverage enforcement | **NONE**. |

Grep evidence: `stub|TODO|continue-on-error|\|\| true` is pervasive in `.github/workflows/*` and
`Taskfile.yml`; `@stryker-mutator/*` appears only in `package.json` + `knip.json` (never a config);
Playwright/msw have no config or specs.

---

## 6. What a team must add to make TDD non-optional (Go-first)

1. **Add a Go coverage gate** (the primary backend has none): `go test -coverprofile` + a
   threshold check (e.g. `go-test-coverage` action or a script), wired into `pr.yml` as a hard,
   required check. Do the same for Rust (`cargo-llvm-cov`) and Python (`pytest --cov --cov-fail-under`).
2. **Restore real Vitest thresholds** (raise 30/25 → 80/70 as the TODO intends) and put them per-project,
   not just root.
3. **Enforce patch/new-code coverage** (the actual lever for TDD): add a `codecov.yml` with
   `patch: target 100%` (or a diff-coverage tool per language) and make it a required status check —
   this is what forces a test to accompany each change.
4. **Run integration tests in CI**: add a job that invokes the `test:integration` targets (they use
   testcontainers, which works on GH runners) so DB/round-trip behavior is actually gated.
5. **Turn on the lint teeth**: drop `--quiet`, and promote the `no-unsafe-*` / `no-explicit-any` /
   `no-floating-promises` family from `warn` to `error`.
6. **Either configure Stryker or remove it.** If mutation testing is wanted, add `stryker.conf.mjs`
   + an Nx target + a nightly job with a mutation-score gate; otherwise delete the dead deps.
7. **Configure Playwright** (config + at least smoke e2e specs) or remove the dependency.
8. **De-stub the e2e/bringup Taskfile verbs** or explicitly mark the e2e workflows non-required.
9. **Commit branch-protection-as-code** (or document required checks) so the "hard" jobs actually
   block merge — today nothing in-repo proves they do.
10. **Reconcile docs with reality** (AGENTS.md 80/70 vs enforced 30/25) to avoid false confidence.

## Bottom line
This template is an excellent *starting skeleton* for polyglot testing: idiomatic runners for all
four languages, parallel reference apps, real testcontainers examples, and a broad Nx/Taskfile
orchestration layer. But as shipped it is **permissive, not strict**: the only test-existence floor
is a 30% TS threshold, the Go primary backend has **no** coverage gate, mutation/e2e/msw are
stubs or absent, integration tests don't run in CI, lint warnings are suppressed, and nothing
enforces tests-first. A team wanting *strict TDD* would treat this as ~40% done on enforcement and
would need items 1–5 above (per-language + patch coverage gates, integration-in-CI, lint teeth) before
TDD could be called non-optional.
