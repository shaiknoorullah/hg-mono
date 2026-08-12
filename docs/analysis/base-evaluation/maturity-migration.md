# Maturity & Migration Audit — `ts-monorepo-template`

**Target:** `/workspace/shaiknoorullah/ts-monorepo-template`
**Question:** Effort/risk of adopting this as the base for `hg-mono` (backend + 4 frontends + infra, one monorepo).
**Method:** Exhaustive read + grep. No repo files modified.
**Date of audit:** 2026-08-09.

---

## 0. Blunt verdict

This is an **ambitious, largely config-as-code scaffold that is real on paper and almost entirely unvalidated end-to-end.** It is a "reference implementation of a spec" more than a working platform.

- **~55–65% is "real"** in the sense that the files exist, are internally coherent, and pass *unit-level* tests (Helm renders, Crossplane compositions parse, CLI/recommender/cost-simulator have golden tests).
- **~10% is real end-to-end.** Every profile bring-up path is a stub. No cluster has ever been stood up in CI. The `task ci:bringup / smoke / claims / kargo / observability / evidence / teardown` verbs are literal `echo "::notice:: ... stub"` no-ops.
- **The two headline differentiators are the least real:** the agent-facing **MCP server is 8-of-18 tools stubbed** (`not_yet_implemented`), and the **SHA-256-chained audit log is a genesis-line-only demo** with no append tooling.
- **Documentation is severely drifted** — the agent-facing `AGENTS.md`/`CLAUDE.md` and the `README.md` describe a *different, simpler template* than what is on disk, with many dead ADR links.
- **Entire history is a single squashed commit** (1,524 files, 115,217 insertions, "Merge pull request #2", 2026-06-04) — no incremental history to review provenance or evolution.

For `hg-mono`, treat it as a **starter skeleton requiring a multi-month hardening project**, not a "Use this template → ship" base.

---

## 1. Real-vs-stub inventory

### 1.1 Marker counts (whole repo, excl. node_modules)

| Marker | Count | Notes |
|---|---|---|
| `stub` | 281 | 168 in `docs/superpowers` (the spec/plan), 53 in `internal/mcp-server`, rest scattered |
| `follow-up` | 65 | 51 in `docs`, 8 are the Taskfile CI stubs |
| TODO | 45 | |
| placeholder | 42 | includes `REPLACE_ORG`/`REPLACE_REPO` in Kargo/infra (56 hits infra-wide) |
| "not yet" | 38 | includes MCP `not_yet_implemented` |
| "not implemented" | 20 | **mostly benign** — generated gRPC stubs in `packages/contracts*/gen/**` |
| `::notice::` | 17 | CI/Taskfile no-op markers |
| skeleton | 19 | |
| FIXME | 1 | |
| aspirational / "coming soon" | 0 | (the word isn't used; the behavior is) |

### 1.2 Taskfile CI stubs (confirmed, `Taskfile.yml` lines ~55–101)

Eight verbs are explicit stubs that echo a `::notice::` and exit 0 so downstream `if: always()` steps don't error:

- `ci:bringup` — "k3d + Crossplane + ESO + ArgoCD ... in a follow-up PR"
- `ci:smoke` — "smoke pack S-01..S-10 ... follow-up PR"
- `ci:observability:assert` — "Layer 5 parity check ... follow-up PR"
- `ci:claims:assert` — "XR claim readiness assertions ... follow-up PR"
- `ci:image-updater:assert` — "Image Updater smoke ... follow-up PR"
- `ci:kargo:assert` — "Kargo promotion assertion ... follow-up PR"
- `ci:evidence:collect` — writes `STATUS.txt` saying "no artifacts produced yet"
- `ci:teardown` — "k3d cluster teardown ... follow-up PR"

**Consequence:** the three e2e workflows (`e2e-p-solo.yml`, `e2e-p-hobby.yml`, `e2e-p-startup-small.yml`) run green but assert *nothing*. The entire "profile bring-up validates end-to-end" claim is unproven.

### 1.3 `.audit/` — governance demo, not a feature

- `.audit/decisions.jsonl` = **one line, the genesis record only** (`sha256_prev` = 64 zeros).
- `.audit/__tests__/genesis-chain.test.ts` validates **only the genesis line** (prev-hash zeros, actor/system, self-hash recompute). No test for a chain of length > 1.
- No append/verify tooling is wired into the CLI or Taskfile (grep for `appendDecision`/audit-append finds nothing that writes to the log). Spec §15.10 describes a live chain; reality is an initialized-but-empty ledger.

### 1.4 MCP server (`internal/mcp-server`, ~1,517 LOC) — Layer 0b, half-stubbed

18 tools; **8 return `stub(...)` → `{status:'not_yet_implemented', tracking_issue, expected_milestone:'v0.2'|'v0.3'}`**:

- Stubbed: `nx_cloud_cache_hit_rate`, `nx_cloud_recent_runs`, `nx_cloud_status`, `nx_cloud_estimate_savings_usd`, `validate_plan`, `propose_change`, `claim_infra`, `add_app`.
- Real: `describe_app`, `describe_profile`, `describe_xrd`, `explain_tradeoff`, `list_apps`, `list_profiles`, `list_xrds`, `nx_cloud_recommend_backend`, `recommend_profile`, `simulate_cost` (these are read/query tools backed by the real recommender/cost-simulator).

So the agent surface can **describe/recommend** but cannot **act** (`propose_change`, `claim_infra`, `add_app` are all no-ops). This is the product's stated #2 surface.

### 1.5 Seven-layer infra — how much is skeletal?

`infra/` is **449 files** and is the *most substantial* part of the repo. Depth varies sharply:

| Layer / area | State | Evidence |
|---|---|---|
| **Crossplane compositions** | **Real.** 18 core compositions with genuine `function-go-templating` pipelines (e.g. CNPG cluster render), plus obs-identity, schema-gov (Kroxylicious/Apicurio), cloud-bootstrap bundles. XRDs, providers, provider-configs, functions all present. Chainsaw render tests + per-dir `*_test.sh`. | `compositions/core/xpostgrescluster-cnpg-singlenode.yaml` (99 lines, real templating) |
| **Crossplane claims** | Real but demo-scoped — only for the three hello apps × {dev,staging,prod}. | `claims/{dev,staging,prod}/{go,py,rs}-hello-*` |
| **Kargo pipelines** | **Skeletal + placeholder.** Only 3 pipelines (go/py/rs-hello, ~200 lines each), all containing `REPLACE_ORG`/`REPLACE_REPO`. AnalysisTemplates (smoke/slo) are real-shaped. No pipeline for actual apps. | `kargo/pipelines/*.yaml` |
| **ArgoCD** | Present: root-app, appset-apps, appset-platform, appprojects, sync-windows, image-updater, notifications. Not runtime-verified. | `argocd/` |
| **Terraform modules** | **Split.** `hetzner-cloud` real (81 lines). `aws`/`gcp`/`azure` are ~8-line scaffolds ("Scaffolded — nightly smoke only per spec §9.14"). `ovh`/`proxmox`/`hetzner-robot` 3–12 lines. `contabo` is a **guarded stub** ("UNDER DEVELOPMENT — provider pre-v0.1.0, not published"). | `terraform/modules/*/main.tf` |
| **Ansible roles** | **Real-looking, most complete infra area.** Full roles: common (auditd/chrony/fail2ban/sysctl/sshd), cni_install (calico/cilium/flannel), container_runtime, kubeadm_install, kubernetes_join, longhorn_prep, wireguard_mesh, observability_agents, arc/uems enroll. Molecule scenarios + Python tests. | `ansible/roles/**` |
| **Helm lib-chart** | **Real.** 24 templates / 618 lines (deployment, rollout, hpa, pdb, networkpolicy, servicemonitor, otel sidecar, externalsecret, routes, presync migration job) + `values.schema.json` + 6 test scripts. App charts only for go/py/rs-hello. | `helm/lib-chart/templates/` |

**Net:** infra-as-code is genuinely built and unit/render-tested, but every "does it actually stand up and pass smoke" gate is stubbed, and app-specific wiring exists only for the three polyglot hello-world demos.

### 1.6 Apps — mostly scaffolds

Non-test source LOC per app:

| App | LOC | Character |
|---|---|---|
| marketing | 536 | Astro, real-ish (Hero/FeatureGrid/ConsentBanner, jsonld) |
| cms | 392 | Payload CMS 3 scaffold (collections, access) |
| go-hello | 284 | polyglot demo (handlers/store/events/telemetry) |
| rs-hello | 222 | polyglot demo |
| py-hello | 178 | polyglot demo |
| docs-public | 146 | Astro Starlight |
| api-gateway | 121 | **hello-world scaffold** |
| worker | 119 | **hello-world scaffold** |
| web-app | 115 | Expo scaffold |
| mobile-customer | 30 | **near-empty** |
| mobile-admin | 30 | **near-empty** |

The "backend" (`api-gateway`, `worker`) is ~120 LOC of scaffold each. The two mobile apps are 30 LOC. For a food-delivery consolidation, essentially **none of the business apps exist** — you bring your own.

---

## 2. Documentation accuracy / drift (severe)

`CLAUDE.md` is a **symlink to `AGENTS.md`** (`CLAUDE.md -> AGENTS.md`), so both agent-facing files carry identical drift.

### 2.1 Workspace layout: agent docs describe a different, smaller repo

`AGENTS.md`/`CLAUDE.md` §2 "Workspace layout" claims:
- `apps/`: **api-gateway, worker** (2)
- `packages/`: **logger, config, db-client, types** (4)
- `internal/`: test-utils, scripts, eslint-config, tsconfig (4)

**Reality on disk:**
- `apps/`: **11** (api-gateway, cms, docs-public, go-hello, marketing, mobile-admin, mobile-customer, py-hello, rs-hello, web-app, worker)
- `packages/`: **17** (api-client, auth-client, cms-client, config, consent, contracts, contracts-py, contracts-rs, db-client, forms, logger, seo, tenancy-client, tracking, types, ui, ui-nativewind)
- `internal/`: **14** (cli, cost-simulator, errors, eslint-config, glossary, helm, mcp-server, recommender, schemas, scripts, templates, test-utils, tsconfig, + AGENTS.md)

### 2.2 ADR system is broken/drifted

Active `docs/adrs/` contains **only ADR-0001** (`0001-default-profile-p-hobby.md`) + README + template. ADRs **0006–0013 live in `docs/adrs/_legacy/`**. ADRs 0002–0005 **do not exist anywhere**.

But the docs link to a *completely different ADR set* (inherited from a generic TS-library template):

- `AGENTS.md` §"Foundational choices" and its ADR index (lines 361–371) + `README.md` (lines 243–247) claim:
  - ADR-0001 = "tsdown over tsup", 0002 = "Changesets over release-please", 0003 = "ESLint over Biome", 0004 = "Nx over Turborepo", 0005 = "SHA-pinned GitHub Actions".
  - **All five files (`0001-tsdown-over-tsup.md` … `0005-sha-pinned-github-actions.md`) are MISSING entirely.** The real ADR-0001 is about the p-hobby default profile — a title collision, not the documented content.
- `README.md` inline links that resolve to `_legacy` (i.e. **dead at the linked path**): ADR-0006 (`0006-yaml-config-with-c12`), ADR-0007 (`0007-repo-cli-as-dev-interface`), ADR-0010 (`0010-eliminating-or-limiting-nextjs`), ADR-0011 (`0011-cloudflare-edge-deployment`), ADR-0013 (`0013-payload-cms-self-hosted`).
- ADR-0001's own body claims "auto-emits ADR-0001 through ADR-0012 on the first run" — that chain does not exist.

The task's specific callouts (README/CLAUDE reference 0007 and 0013; only 0001 active; rest in `_legacy`) are **confirmed**.

### 2.3 Other confirmed drifts

- **Taskfile includes** point to non-existent dirs: `apps/api`, `apps/web`, `apps/worker-py` (all `optional: true`, so they silently no-op). Actual apps are `api-gateway`, `web-app`, `worker`.
- **Workflow count:** `AGENTS.md` says ".github/workflows (12 workflows)". Reality: **~30 workflow YAMLs** (ci, release, codeql, sbom, dependency-review, terraform, ansible, argo-validate, chaos-nightly, recommender, xp-claims, 3× e2e, lighthouse, mobile-build, marketing/web/docs/site-build+deploy, etc.).
- **Docs framework confusion:** `AGENTS.md`/`README.md` call `docs/` a "VitePress site". Root `package.json` does have `vitepress` dep + `docs:*` scripts, but `docs/` has no `.vitepress` config; the actual customer docs app (`apps/docs-public`) is **Astro Starlight**. Mixed/contradictory story.
- **Dead link:** `README.md` links `docs/architecture/research-summary.md` — **MISSING**.
- **`TODO.md` is stale in reverse:** it lists "Batch A — 11 GitHub Actions workflows still deferred (blocked on API 529s)" and a "pnpm install bug: `@vitest/eslint-plugin@^2.0.0` doesn't exist" — **both already resolved** (all workflows present; `package.json` now pins `^1.6.0`). It also lists ADR-0012/0013 as "to be created" — they exist (in `_legacy`).
- **License inconsistency:** root `LICENSE` = **MIT** (© 2026 Shaik Noorullah), `package.json` `"license": "MIT"`, but **`Cargo.toml` declares `license = "Apache-2.0"`**. Confirmed.

---

## 3. Governance machinery — working vs demo

| Component | Verdict |
|---|---|
| **`repo` CLI** (`internal/cli`, ~3,822 LOC) | **Working feature.** ~24 commands (build/test/lint/format/type-check/ci/dev/clean/db/env/release/doctor/version/completion + `new {app,package,adr,changeset,workflow,runbook}`), `--json` mode, extensive `__tests__` (taskfile, profile-validate, profile-diff, profile-fork, config-loader, templates, etc.). This is the most solid part. |
| **Recommender** (`internal/recommender`) | **Working.** `rubric.yaml` + score/rubric logic, golden tests with input/expected fixtures for all 5 profiles. |
| **Cost-simulator** (`internal/cost-simulator`) | **Working.** resource-shapes + prices + simulate, with tests; feeds MCP `simulate_cost`. |
| **ADR system** | **Broken/demo** — scaffolding (`repo new adr`, index generator, frontmatter test) exists, but only 1 real ADR and the docs point at a phantom ADR set (see §2.2). |
| **SHA-256 audit chain** | **Demo only** — genesis line + genesis-only test; no live append path. |
| **`GOVERNANCE.md` + `docs/specs/governance-saas/`** | **Real docs** — GOVERNANCE.md is a coherent pointer to 6 governance specs (repo-governance, temporal, saas-commons, package-architecture-rules, multi-tenancy-isolation, governance-process). Prose, not enforced machinery. |

So: **decision tooling (CLI/recommender/cost-sim) is real and tested; the governance-as-enforcement story (audit chain, ADR chain) is aspirational.**

---

## 4. The authoritative spec vs implementation

- **Spec:** `docs/superpowers/specs/2026-06-03-platform-foundation-design.md` — **5,061 lines, 18 sections, `status: draft (pending review)`**, "drafted with claude-opus-4-7 + a 15-agent parallel workflow". Covers profiles, polyglot Nx, Nx Cloud, devenv, container build, Helm lib-chart, promotion+Kargo, Crossplane, Terraform+Ansible, secrets, launcher CLI + MCP, reference apps, PR sequencing, e2e test plan, docs surface, sibling OSS providers, risks.
- **Plan:** `docs/superpowers/plans/2026-06-03-platform-foundation.md` — **39,104 lines** (implementation plan / task decomposition).
- **Implemented vs planned:** The *structural* surface of the spec is largely materialized (all seven layers have directories with real files; CLI/recommender/MCP-read/compositions/helm/ansible exist). The *behavioral* surface is not: the e2e validation plan (§14) is entirely stubbed, MCP mutations (§11) are stubbed, the audit chain (§15.10) is genesis-only, Terraform cloud modules (§9) are nightly-smoke scaffolds, and it remains a **draft** spec. Estimate: **structure ~70% present, validated behavior ~10–15%.**
- **History:** **single squashed commit** (`e5d203f`, 1,524 files, +115,217, 2026-06-04). No incremental commit history — provenance and review trail are opaque; hard to tell hand-written from agent-generated per file.

---

## 5. Adoption cost for `hg-mono`

### 5.1 What "Use this template" gives you *today, working out of the box*

- A well-wired **pnpm + Nx polyglot workspace** (TS/Go/Python/Rust all in `nx graph`).
- A genuinely useful **`repo`/`task` dev-verb layer** for build/lint/test/format/type-check/new-scaffolding (well tested).
- **Profile recommender + cost simulator** (real, tested) and a **read-only MCP + query surface**.
- A large **library of infra-as-code** you can crib from: real Crossplane compositions/XRDs, a solid Helm library chart, extensive Ansible cluster roles, ArgoCD appsets — all unit/render-tested.
- ~30 **CI workflows** (lint/type/test/build/codeql/sbom/dependency-review/terraform/ansible validation) that run on PRs.
- Good **governance/spec documentation** as reference.

### 5.2 What a team must finish/fix before production

**Blocking / high effort:**
1. **Build the actual product.** `api-gateway`/`worker` are ~120-LOC scaffolds; mobile apps are 30 LOC; there are zero food-delivery domain apps. All 4 frontends + backend are net-new work — the template only provides shared packages (ui, auth-client, api-client, tenancy, consent, tracking, forms, seo) as scaffolds.
2. **Implement all 8 Taskfile CI e2e stubs** (bringup/smoke/claims/kargo/observability/image-updater/evidence/teardown) — nothing is validated end-to-end today.
3. **Implement the 8 stubbed MCP tools** if the agent surface matters (propose_change, claim_infra, add_app, all nx_cloud_*).
4. **Wire the audit chain** (append/verify) if governance-by-audit is a requirement; today it's genesis-only.
5. **Fill in Kargo pipelines and Crossplane claims for real apps** (currently only go/py/rs-hello) and replace all `REPLACE_ORG`/`REPLACE_REPO` placeholders (56 infra placeholders).
6. **Finish cloud Terraform modules** (aws/gcp/azure are 8-line scaffolds; contabo blocked on an unpublished external provider) — only hetzner-cloud is usable.

**Documentation remediation (do first — it's cheap and the drift will actively mislead an AI-assisted team):**
7. Rewrite `AGENTS.md`/`CLAUDE.md` §2 layout, §"Foundational choices", and ADR index to match reality (11 apps/17 packages/14 internal, correct ADR set).
8. Fix all dead ADR links in `README.md`/`AGENTS.md`; reconcile `_legacy` vs active ADRs; either write 0002–0005 or stop referencing them.
9. Fix Taskfile `includes` (`apps/api`→`api-gateway`, etc.).
10. Delete/rewrite the stale `TODO.md`.
11. Resolve the **MIT vs Apache-2.0** license conflict (`Cargo.toml`) — a real legal/compliance item before consolidating a commercial project.
12. Reconcile the VitePress-vs-Astro docs story.

### 5.3 Rough migration effort characterization

- **Not** a low-risk "adopt and go" base. It's a **skeleton + reference library** that assumes a platform team.
- Realistic path: treat it as **a source of patterns to copy selectively** rather than a wholesale base. Adopting it *whole* means owning ~1,500 files (many stubs/placeholders you didn't write, one squashed commit, drifted docs) plus building the entire food-delivery product on top.
- **Effort:** documentation cleanup = days; making one profile actually bring up + smoke-pass in CI = weeks; wiring the 5 real apps through Kargo/ArgoCD/Crossplane + finishing MCP/audit = **multi-month platform initiative** before "production-usable".
- **Risk drivers:** unvalidated e2e (green CI that asserts nothing is worse than no CI), doc drift misleading AI agents, single-author/single-commit provenance, external-dependency stubs (contabo provider), and license inconsistency.

---

## Appendix — quick evidence index

- Taskfile stubs: `Taskfile.yml:55–101`
- MCP stubs: `internal/mcp-server/src/tools/_stub.ts`, 8× `tools/*.ts` importing `_stub`
- Audit genesis-only: `.audit/decisions.jsonl` (1 line), `.audit/__tests__/genesis-chain.test.ts`
- ADR drift: `docs/adrs/` (only 0001) vs `docs/adrs/_legacy/0006–0013`; `README.md:243–247`, `AGENTS.md:361–371`
- Layout drift: `AGENTS.md:22–48` vs `ls apps packages internal`
- License: `LICENSE` (MIT) + `package.json` (MIT) vs `Cargo.toml` (`license = "Apache-2.0"`)
- Terraform scaffolds: `infra/terraform/modules/{aws,gcp,azure}/main.tf` (~8 lines), `contabo/main.tf` (guard)
- Kargo placeholders: `infra/kargo/pipelines/*.yaml` (`REPLACE_ORG`)
- Single commit: `git log` → `e5d203f` (1,524 files, +115,217)
- Spec: `docs/superpowers/specs/2026-06-03-platform-foundation-design.md` (5,061 lines, status: draft)
