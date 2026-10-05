---
covers:
  - tools/e2e/api/**
reviewed: 2026-10-05
---

# API journey runner

This runner drives the HalalGoes launch path against the staging API. The request shapes come from the [API contract](../../../contracts/openapi.yaml).

Run it with Node 22:

```bash
node tools/e2e/api/run.mjs
```

It is not part of `pnpm test`. The machine that starts it needs the staging login file and a test-mode payment key under the halalgoes secrets directory. The runner reads those files and does not print them.

Created names start with "E2E ". A failed step exits non-zero and names the request that failed.

Do not point the runner at a production API. The default base is the staging host set in the runner.
