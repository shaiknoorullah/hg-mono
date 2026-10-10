---
covers:
  - .github/workflows/ci.yml
  - .github/workflows/docs.yml
  - .github/workflows/migrations.yml
  - .github/workflows/claude.yml
  - .github/workflows/claude-code-review.yml
  - scripts/ci/**
reviewed: 2026-10-09
---

# CI on self-hosted runners

GitHub stopped starting hosted jobs on this private repository when the free Actions minutes ran
out ([#287](https://github.com/shaiknoorullah/hg-mono/issues/287)). Until hosted billing is back,
CI runs on the owner's own machines. One repository variable switches it; this page says which
jobs move, how to add a machine, and what the setup does and does not protect against.

## The switch

Every job that runs repository code reads its runner from the repository variable `HG_RUNS_ON`:

```yaml
runs-on: ${{ fromJSON(vars.HG_RUNS_ON || '"ubuntu-latest"') }}
```

| `HG_RUNS_ON` | Jobs run on |
|---|---|
| `["self-hosted","hg"]` | any of our runners (the workstation or the laptop) |
| `["self-hosted","hg","workstation"]` | the workstation only |
| not set | GitHub's runners (`ubuntu-latest`), as before |

```bash
gh variable set HG_RUNS_ON --body '["self-hosted","hg"]'   # move CI to our runners
gh variable delete HG_RUNS_ON                              # move it back to GitHub's
```

## Labels

| Label | Meaning |
|---|---|
| `self-hosted`, `Linux`, `X64` | added by GitHub to every Linux x64 self-hosted runner |
| `hg` | a HalalGoes CI runner, set up with the sandbox below. `HG_RUNS_ON` selects this |
| `workstation`, `laptop` | which machine, to pin a job to one when needed |

## Which jobs run where

Jobs that hold a secret or a write token never run on our machines.

| Workflow | On `HG_RUNS_ON` (read-only token, no secrets) | Always on GitHub's runners, and why |
|---|---|---|
| [`ci`](../../.github/workflows/ci.yml) | `changes`, `contract-kit`, `js`, `go`, `coverage`, `gate` | `coverage-comment`, `coverage-baseline`, `coverage-issues`: write tokens |
| [`docs`](../../.github/workflows/docs.yml) | `doc and PR checks` | `labels` and `weekly`: write tokens |
| [`migrations`](../../.github/workflows/migrations.yml) | `schema` | |

`contract-kit` also checks the device-lab missions (`pnpm e2e:missions:check`, [tools/e2e/native/README.md](../../tools/e2e/native/README.md)). It needs Node only: no emulator, no adb and no secret, so it stays on `HG_RUNS_ON`.

The `schema` job applies migrations, runs the invariant tests, proves a full rollback, then resets and checks the local persona database on that job's Postgres. The reset command itself refuses every environment other than local.
| any of the above, for an untrusted run | | `gate`, `doc and PR checks` and `schema` run only their first step, which fails (see below) |
| [`release-builds`](../../.github/workflows/release-builds.yml) | | every job: the release signing secrets never reach our machines |
| [`Claude Code`](../../.github/workflows/claude.yml), [`Claude Code Review`](../../.github/workflows/claude-code-review.yml) | | they need the Claude token |

The write-token jobs run no repository code: each takes a file a read-only job produced and calls
the GitHub API. While hosted billing is blocked they cannot start, so PR labels, the coverage
comment, the coverage baseline PR and the weekly issues pause; the checks themselves do not, and
the `gate` does not wait for them.

## Who can run CI

A run is trusted when all of these are in the repository variable `HG_CI_TRUSTED_ACTORS` (a JSON
list, default `["shaiknoorullah"]`; the owner and the owner's agents act as that account):

- `github.actor`, who caused the event (pushed, edited, labelled, merged, ran the workflow);
- `github.triggering_actor`, who started this attempt (differs on a re-run);
- for a pull request, its author, and its branch must be in this repository, not a fork.

Nothing else counts: not the branch name, the title, or a label. A label (`claude-review`) or an
`@claude` mention is only a trigger; the person behind it must still be trusted. Scheduled runs
use `main`'s code and are always trusted.

An untrusted run never reaches our runners. The jobs that check code (`changes`, `contract-kit`,
`js`, `go`, `coverage`) are skipped. The jobs a PR shows as its result, `gate`, `doc and PR
checks` and `schema`, run on GitHub's runners instead, check out nothing, and fail at their first
step with a message saying why. So an untrusted PR is red, never green with every check skipped.

```bash
gh variable set HG_CI_TRUSTED_ACTORS --body '["shaiknoorullah","someone-else"]'
```

The coverage baseline PR is opened by `github-actions[bot]`, so its checks fail as untrusted. Read
its one-line diff and merge it by hand.

### What happens when

| Case | Expected result |
|---|---|
| The owner pushes to a branch of this repository with an open PR the owner opened | every check whose paths changed runs on `HG_RUNS_ON`; `gate` and `doc and PR checks` pass or fail on the results |
| A PR from a fork | does not run at all while "Run workflows from fork pull requests" is off (it is, and must stay off). If it were on: nothing is checked out on our runners, the code-checking jobs are skipped, and `gate`, `doc and PR checks` and `schema` fail on GitHub's runners |
| The owner re-runs a run that an untrusted person started, or pushes to an untrusted person's PR | still untrusted (the original actor, or the author of the PR, is not in the list): fails as above. To run CI on that code, the owner opens a PR of their own from it |
| Someone outside the list adds a label (any label, `claude-review` included) to the owner's PR | `docs` runs for the label event and `doc and PR checks` fails as untrusted, until a trusted event (a push, an edit, a label by the owner) runs it again; the Claude review does not run. `ci` does not react to labels, so `gate` keeps its result |
| Someone outside the list comments `@claude` | the Claude job is skipped; nothing runs |

## Add a runner

On the new machine, as the user the runner should run as (not root), from a checkout of this
repository:

```bash
scripts/ci/setup-self-hosted-runner.sh --name hg-laptop --labels hg,laptop
```

It needs `gh` signed in with admin rights on the repository. It:

1. downloads the runner and checks its SHA-256 against the one in the release notes;
2. registers it with a token from `gh`, which it never prints;
3. writes the systemd user unit `~/.config/systemd/user/hg-actions-runner.service`;
4. starts it and checks, from inside the running service, that your home is hidden.

It is safe to run again: on a configured machine it only rewrites and checks the unit. The runner
then shows under the repository's Settings → Actions → Runners, and takes jobs while `HG_RUNS_ON`
is set.

To remove a machine: `systemctl --user disable --now hg-actions-runner.service`, then remove the
runner in Settings → Actions → Runners.

### What a runner machine needs

- Linux, x64 or arm64, with a systemd user manager and unprivileged user namespaces.
- **Docker**, usable by the runner's user. The `migrations` job and the `go` job each use a
  Postgres service container (the `go` job's is the seeded database behind `HG_TEST_POSTGRES_DSN`,
  on port 55433 so the two jobs can run side by side), and the Go tests also start Postgres with
  testcontainers: in the `go` job, or in `coverage` for the weekly scan. Without Docker those
  jobs fail.
- No `psql`, Go, Node or Python setup is needed: jobs install Go and Node into the runner's own
  tool cache, use the machine's `python3` in a private venv, and run `psql` from the Postgres image.
- **No KVM on the workstation** (`/dev/kvm` is missing), so it cannot boot an Android emulator.
  Jobs that need an emulator must not use `HG_RUNS_ON`: they stay on GitHub's runners or a runner
  that has KVM.

## The sandbox

The runner runs as an ordinary user, so a job could read anything that user can. The unit stops
that:

| Unit setting | Effect |
|---|---|
| `ProtectHome=tmpfs`, `BindPaths=%h/actions-runner` | every home directory is an empty tmpfs; only `~/actions-runner` is visible. SSH keys, `gh` and Claude credentials, browser profiles are hidden |
| `Environment=HOME=…` and `XDG_CACHE_HOME=…` under `~/actions-runner/home` | jobs' caches (Go modules and builds, the pnpm store, npm, Vale and gitleaks) land there, not in your home |
| `PrivateTmp=yes` | jobs get their own `/tmp` |
| `PrivateUsers=yes` (laptop script) | the runner runs in its own user namespace |
| `NoNewPrivileges=yes` | no `sudo`, no setuid programs |
| `Nice=10`, `CPUWeight=50`, `MemoryMax=6G` | CI yields to your own work |
| `Restart=always`, `KillMode=mixed` | the runner comes back after a crash, and stopping it stops its jobs |

## Rules for workflow authors

- `runs-on` is the switch above, unless the job needs a secret or a write token: then
  `ubuntu-latest`, with no checkout of repository code if it holds a write token.
- Every job that can run on our runners carries the trust check from "Who can run CI" in its `if:`,
  or, if it reports the result of a PR, picks GitHub's runners for an untrusted run and fails at its
  first step. Never use `pull_request_target` or `workflow_run` to run PR code.
- No `${{ }}` of PR or event fields inside `run:`: pass them through `env:`.
- `permissions:` read-only (`contents: read`, plus `issues: read` or `pull-requests: read` where a
  check reads them). No `secrets.` in a job on `HG_RUNS_ON`.
- Every job has `timeout-minutes`.
- `actions/checkout` with `clean: true` and `persist-credentials: false`. Every action pinned to a
  commit SHA.
- No `sudo` and no `apt-get` on our runners: use a `setup-*` action, the job's temp folder, or a
  container. Write only inside the workspace, `$RUNNER_TEMP` or the runner's own home.
- Containers: label any container a step starts with the job, and remove it in an `if: always()`
  step (see the `migrations` job). Never turn off the testcontainers reaper. Publish ports other
  than the defaults (Postgres on 55432 and 55433, the mock on 54010): a developer's own stack may hold 5432
  and 4010.
- Caches: on GitHub's runners, the Actions cache (keyed by `pnpm-lock.yaml` and `go.sum`); on ours,
  the runner's own home, never uploaded. Release builds run on GitHub's runners and restore no
  cache, so nothing a PR job built on our machines can reach a release.
- Artifacts: an upload from our runners goes to GitHub's storage at home-upload speed, so upload
  only small results, never build output or caches. The `go` and `js` jobs hand `coverage` their
  numbers as a JSON file of a few KB (`coverage-slice-go`, `coverage-slice-js`), not the raw
  coverage profiles ([#374](https://github.com/shaiknoorullah/hg-mono/issues/374)).

## What is still at risk

Plainly: **the sandbox does not stop a malicious job.** The runner's user is in the `docker` group,
and Docker access is root on that machine: a job can start a container that mounts the real home
directory or the whole disk. It can also leave poisoned build caches in `~/actions-runner/home` for
later jobs.

What keeps that from happening is who can run a job at all:

- only trusted accounts (`HG_CI_TRUSTED_ACTORS`) on branches of this repository;
- the repository is private, and its "Run workflows from fork pull requests" setting stays off.
  The fork check above lives in the workflow file, which a fork could edit, so this setting is
  what actually keeps fork code off our machines;
- jobs on our runners get no secrets and only a read-only token;
- every action and tool is pinned (actions to a commit, Vale, gitleaks and the runner by SHA-256,
  npm packages by lockfile).

The fully isolated setup is a dedicated machine or VM, or at least a dedicated user without the
owner's files, that holds nothing else. **If outside contributors are ever added, move CI to a
separate low-cost box first**, or back to GitHub's runners, before trusting their PRs.
