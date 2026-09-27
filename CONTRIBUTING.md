# Contributing

Humans and agents follow the same rules. Read [`AGENTS.md`](AGENTS.md) first.

## Issues are the project tracker

- Everything that is being worked on, found wrong, deferred or might be forgotten is a GitHub issue. Found a problem? Open an issue.
- Before starting, check for an existing issue. Say on the issue that you've started.
- Write issues so someone else can pick them up: what exists today, scope, "done when", dependencies as issue numbers.

## Pull requests

**One PR does one thing, in one place.** A second fix is a second PR. Over 400 changed lines (generated files excluded), the check warns: split it if you can.

**The title sets the label**, automatically:

| Title starts with | Label | Template |
|---|---|---|
| `fix:` | `bug` | [bug.md](.github/PULL_REQUEST_TEMPLATE/bug.md) — before/after evidence required |
| `feat:` | `feature` | [feature.md](.github/PULL_REQUEST_TEMPLATE/feature.md) |
| `docs:` | `docs` | [docs.md](.github/PULL_REQUEST_TEMPLATE/docs.md) |
| `refactor:` `perf:` | `refactor` | [refactor.md](.github/PULL_REQUEST_TEMPLATE/refactor.md) |
| `chore:` `ci:` `build:` `test:` | `chore` | [chore.md](.github/PULL_REQUEST_TEMPLATE/chore.md) |

A scope is optional: `fix(restaurant): …`. App labels (`app:restaurant` …) are added from the changed paths.

**Descriptions are short.** The template's headings are the whole description: what it is in one sentence, the issue it closes, evidence, links. No background essays.

**Link, don't name.** Never leave an internal code bare — `invariant 10`, `L-4`, `§4.1`, `R-05`. Write what it means and link to where it's defined:

> ✗ enforces invariant 10
> ✓ enforces [solid green is reserved for halal status (invariant 10)](https://github.com/shaiknoorullah/hg-mono/blob/main/AGENTS.md#3-non-negotiable-invariants)

This applies to PRs, issues, docs and code comments. In code, where links don't render, write the meaning plus the file and heading: `// solid green is halal-only — AGENTS.md "Non-negotiable invariants"`.

**Checked in CI** by [`pr-rules`](.github/workflows/pr-rules.yml). Run it before you open the PR:

```bash
node .github/scripts/pr-rules.mjs check --title "fix(restaurant): the queue showed orders twice" --body-file body.md
```
