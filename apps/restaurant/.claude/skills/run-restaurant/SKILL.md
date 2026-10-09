---
name: run-restaurant
description: Run, start, launch, drive, smoke-test or screenshot the HalalGoes restaurant operator web app (apps/restaurant, Vite on :5183) against the contract mock API (:4010) — sign in, view the live order queue, accept an order, open Menu/Hours/Payouts, capture screenshots and console errors.
---

# run-restaurant

The restaurant operator console (`@hg/restaurant`) is a Vite + React SPA. Locally it runs
against the contract mock server (`tools/mock-server`, :4010) by default, or against the local Go stack with `--backend local`.
You drive it headlessly with **`agent-browser`** through `driver.sh`. That script starts both
servers, signs in, takes screenshots, clicks Accept and dumps the network calls and console
errors.

Paths below are relative to `apps/restaurant/`.

## Prerequisites

- Node 20 (`/usr/bin/node`, v20.20.2 verified) and an installed workspace (`node_modules/` present at the root, in `apps/restaurant` and in `tools/mock-server`).
- `agent-browser` on PATH (0.26.0 verified). It brings its own Chrome, headless, with no xvfb needed.
- **`pnpm` is not required.** It was missing from PATH on this machine, so the driver calls the local `node_modules/.bin` binaries directly.

## Run (agent path)

```bash
D=.claude/skills/run-restaurant/driver.sh
$D smoke                           # start mock + vite if down, sign in, screenshot orders/menu/hours, click Accept, print network + console errors
$D --backend local smoke           # local Go stack on :8080: `make up` if it is down, then `make dev-reset`, sign in as bismillah-grill
RESET=0 $D --backend local up      # same, but keep the current dev world (e.g. mid-journey)
$D shot /payouts                   # screenshot any route with the signed-in session (/staff, /settings, /onboarding, /login ...)
$D up                              # only start the servers (the browser part is yours: agent-browser --session hg-restaurant ...)
$D down                            # close the browser, kill whatever listens on 4010 and 5183
```

- Screenshots and logs go to `/tmp/hg-restaurant-run/` (override with `OUT=...`): `orders.png`, `menu.png`, `hours.png`, `mock.log`, `vite.log`. **Open the PNGs and look at them.**
- A cold `smoke` run takes about 20s.
- For ad-hoc interaction, reuse the same browser session:
  ```bash
  agent-browser --session hg-restaurant open http://localhost:5183/menu
  agent-browser --session hg-restaurant snapshot -i          # refs like @e7
  agent-browser --session hg-restaurant find role button click --name "Add item"
  agent-browser --session hg-restaurant network requests     # what the click sent to :4010
  agent-browser --session hg-restaurant console              # React warnings/errors
  ```

Expected `smoke` tail:
```
--- network after Accept
POST http://localhost:4010/v1/restaurant/orders/face3cd1-.../accept (Fetch) 200
GET  http://localhost:4010/v1/restaurant/orders?state=RESTAURANT_PENDING&state=PREPARING&state=READY_FOR_PICKUP (Fetch) 200
--- console errors
  12 [error] Encountered two children with the same key ... c622bd1b-...
   6 [error] Encountered two children with the same key ... face3cd1-...
```

## Run (human path)

Run `./node_modules/.bin/vite` here and `./node_modules/.bin/tsx src/index.ts` in `tools/mock-server`, then open http://localhost:5183 and sign in with any email and password.

## Test

```bash
./node_modules/.bin/vitest run     # 3 files / 7 tests in smoke/, ~5s
./node_modules/.bin/tsc --noEmit
```

## Gotchas

- **The mock accepts any credentials.** No TOTP step appears, and the session is stored in `localStorage` (`hg_restaurant_session_v1`). `driver.sh` skips sign-in when `/login` isn't where it lands. To test the login screen itself, `agent-browser --session hg-restaurant close` first, or use a fresh `--session`.
- **The mock doesn't save state.** Accept returns 200 with a `PREPARING` order, then the queue re-fetches and the same `RESTAURANT_PENDING` card is still there. The network log is the only proof the click worked. The UI shows no toast.
- **Duplicate order cards come from the mock, not the app.** `GET /v1/restaurant/orders?state=...` returns `face3cd1` twice and `c622bd1b` three times, because each state-variant fixture is served separately. Hence the React duplicate-key errors. Don't chase them in `OrdersPage` without first checking with `curl` that the real backend would dedupe.
- **The sidebar role label differs by page.** It says "CUSTOMER" on /orders but "Restaurant operator" elsewhere. Seen in screenshots, cause not investigated.
- **`/login` still renders when signed in.** It doesn't redirect, so `shot /login` gives the sign-in form.
- **Killing the servers by command name fails.** tsx re-execs as `node --require .../tsx/dist/preflight.cjs ... src/index.ts` and vite as `node ./node_modules/.bin/../vite/bin/vite.js`, so `pkill -f "<launch cmd>"` matches nothing. `down` kills by listening port (`ss -ltnp`) instead.
- **zsh doesn't word-split variables.** `A="agent-browser --session x"; $A open ...` fails with "command not found". Use a function (`ab(){ agent-browser --session x "$@"; }`) or the driver.
- The API base is `VITE_API_BASE_URL` (default `http://localhost:4010`). `--backend local` points it at `http://localhost:8080`, starts the Go stack with `make up` in `services/hg` when `/health/ready` does not answer, and runs `make dev-reset` (which also applies the migrations). Logs go to `$OUT/stack.log` and `$OUT/dev-reset.log`. `down` stops only vite and the mock; the Go stack keeps running (`make down` in `services/hg`). A fresh `deploy/.env` needs `HG_OTP_PEPPER`, `HG_AUTH_SIGNING_KEY_SEED` and `HG_APP_DATA_KEY` set before the API boots and the admin persona can sign in.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `nohup: failed to run command 'pnpm'` | pnpm isn't on PATH. Use `driver.sh up`, which runs local binaries. |
| `(eval):1: command not found: agent-browser --session hgr` | zsh word-splitting, see Gotchas. |
| `smoke` reuses stale servers after `down` | Old `pkill` version. The current `down` prints `4010: 000, 5183: 000` when both are really stopped. |
| `mock did not come up` | Read `/tmp/hg-restaurant-run/mock.log`. Something else may own :4010 (`ss -ltnp 'sport = :4010'`). |
