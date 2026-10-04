# HalalGoes Frontend — `apps/web`, `apps/docs`, and Monorepo Root (`/home/user/halal-goes`)

Fleet analysis area: **halal-goes: web + docs apps and monorepo root**
Scope: `/home/user/halal-goes/apps/web`, `/home/user/halal-goes/apps/docs`, and repo-root files (`App.tsx`, `app.json`, `eas.json`, `turbo.json`, `package.json`, `tailwind.config.js`, `postcss.config.js`, `tsconfig.json`, commitlint, `.husky`, `.vscode`, `test/`, `README.md`, plus `.github`, `.prettierrc`, `.yarnrc.yml`, `.gitignore`, `.gitattributes`).

---

## 1. Purpose & Role in the Platform

- **Monorepo root**: The `halal-goes` repo is a **Turborepo + Yarn 4 workspaces** monorepo hosting the platform's entire frontend surface: three Expo mobile apps (`users`, `rider`, `restaurant`), two production Next.js webs (`admin-web`, `restaurant-web`), two scaffold Next.js apps (`web`, `docs`), and shared packages (`@repo/ui`, `@repo/eslint-config`, `@repo/typescript-config`, `@repo/tailwind-config`, `auth`). The root wires the developer workflow: turbo task graph, husky git hooks, commitlint/commitizen conventional commits, prettier, a root-level mocha test harness, and a GitHub Actions PR-validation pipeline.
- **`apps/web` and `apps/docs`**: Both are **completely unmodified `create-turbo` / `create-next-app` starter templates** (Next.js 15 + React 19, App Router). Neither contains a single line of HalalGoes business logic. They render the stock Turborepo landing page (Turborepo logo, "Deploy now" Vercel CTA, `@repo/ui` demo Button that fires `alert()`). They exist because the monorepo was bootstrapped with `npx create-turbo@latest` and the starter apps were never deleted. The root `README.md` is likewise the verbatim Turborepo starter README (it even says "maintained by the Turborepo core team" and uses `pnpm` in examples, while the repo actually uses Yarn 4).
- Practical role today: `web` and `docs` are **dead weight / placeholders** (a customer-facing marketing web and a docs site were presumably intended), but they still participate in `turbo run build/lint/check-types`, i.e. they cost CI time and can fail validation.

---

## 2. Complete Inventory

### 2.1 Repo root files

| File | Purpose | Notes |
|---|---|---|
| `/home/user/halal-goes/package.json` | Workspace root manifest | name `halal-goes`, private, `"type": "module"`, workspaces `apps/*` + `packages/*`, `packageManager: yarn@4.9.2`, engines `node >= 18` |
| `/home/user/halal-goes/turbo.json` | Turborepo task graph | tasks: `build` (dependsOn `^build`, inputs `$TURBO_DEFAULT$` + `.env*`, outputs `.next/**` excluding `.next/cache/**`), `lint`, `check-types`, `test` (each dependsOn their `^` upstream), `dev` (cache false, persistent). `ui: "tui"` |
| `/home/user/halal-goes/App.tsx` | **Stray/broken RN entry at repo root** | Imports `NavigationContainer` from `@react-navigation/native`, `AddressProvider` from `./apps/users/contexts/AddressContext` (exists), and `RootNavigator` from `./apps/users/navigation/RootNavigator` — **that path does not exist** (`apps/users` has no `navigation/` dir; it uses Expo Router via `app/`). Dead, non-compiling code. |
| `/home/user/halal-goes/app.json` | Expo config at root | Literally `{ "expo": {} }` — empty stub |
| `/home/user/halal-goes/eas.json` | EAS Build config at root | cli `>= 16.6.2`, `appVersionSource: remote`; profiles: `development` (developmentClient, internal distribution), `preview` (internal), `production` (autoIncrement). `submit.production` empty. Note each mobile app also has its own `eas.json` |
| `/home/user/halal-goes/tailwind.config.js` | Root Tailwind config (CommonJS) | content globs `./apps/*/App.*`, `./apps/*/components/**`, `./apps/*/pages/**`, `./apps/*/screens/**`; empty theme/plugins; comment says "Add other paths as needed". Notably does **not** include `./apps/*/app/**`, which is where Expo Router screens actually live — stale |
| `/home/user/halal-goes/postcss.config.js` | Root PostCSS (CommonJS) | tailwindcss + autoprefixer |
| `/home/user/halal-goes/tsconfig.json` | Root tsconfig | `extends: "expo/tsconfig.base"`, empty compilerOptions — root is typed as an Expo project even though it also hosts Next.js apps |
| `/home/user/halal-goes/commitlint.config.js` | Commitlint | extends `@commitlint/config-conventional` (ESM export) |
| `/home/user/halal-goes/.husky/pre-commit` | Git hook | runs `yarn validate` (= `yarn lint && yarn check-types`) — full-monorepo lint+typecheck on every commit; `lint-staged` is a devDependency but is **never configured/used** |
| `/home/user/halal-goes/.husky/commit-msg` | Git hook | `yarn commitlint --edit $1` |
| `/home/user/halal-goes/.vscode/settings.json` | Editor config | `eslint.workingDirectories: [{ mode: "auto" }]` only. (`.gitignore` ignores `.vscode/` yet this file is checked in) |
| `/home/user/halal-goes/test/example.test.js` | Root mocha test | Toy `add(a,b)` suite demonstrating chai + sinon spies/stubs on `console.log`. No connection to any product code. Run via `yarn test:root` (`mocha`) |
| `/home/user/halal-goes/README.md` | Root README | Verbatim Turborepo starter README; references pnpm, `@repo/ui` stub, remote caching via Vercel. No HalalGoes content |
| `/home/user/halal-goes/.prettierrc` | Prettier | `endOfLine: lf`, `semi: true`, `singleQuote: true`, `tabWidth: 2`, `trailingComma: es5` |
| `/home/user/halal-goes/.yarnrc.yml` | Yarn 4 config | `compressionLevel: mixed`, `enableGlobalCache: true`, `nodeLinker: node-modules`, `yarnPath: .yarn/releases/yarn-4.9.2.cjs` (vendored binary present) |
| `/home/user/halal-goes/.gitattributes` | Line endings | `* text=auto eol=lf`; explicit `eol=lf` for js/jsx/ts/tsx/json/md/yml/yaml |
| `/home/user/halal-goes/.gitignore` | Ignores | node_modules, `.env*` local files, coverage, `.turbo`, `.vercel`, `.next/`, `out/`, `build`, `dist`, `*.apk`, `.expo`, `android`, `.claude/`, `.vscode/`, `*.pem`, `.yarn/*` with keep-exceptions |
| `/home/user/halal-goes/.github/PULL_REQUEST_TEMPLATE.MD` | PR template | Generic template — still contains embedded-firmware fields ("Firmware version / Hardware / Toolchain / SDK"), clearly copy-pasted |
| `/home/user/halal-goes/.github/workflows/pr-workflow.yml` | CI | See §6 |

### 2.2 Root scripts (`package.json`)

| Script | Command |
|---|---|
| `build` | `turbo run build` |
| `build:packages` | `turbo run build --filter="./packages/*"` |
| `dev` | `turbo run dev` |
| `lint` / `lint:fix` | `turbo run lint` / `turbo run lint:fix` (note: `lint:fix` is not declared as a task in `turbo.json`) |
| `test` | `turbo run test` |
| `test:root` | `mocha` (runs `test/example.test.js`) |
| `format` | `prettier --write "**/*.{ts,tsx,md}"` |
| `check-types` | `turbo run check-types` |
| `prepare` | `husky` |
| `commit` | `cz` (commitizen, cz-conventional-changelog) |
| `validate` | `yarn lint && yarn check-types` |
| `clean` | rm -rf node_modules/.turbo recursively + all nested `node_modules`, `.turbo`, `dist` |
| `install:all` | `yarn install && yarn build:packages` |
| `reset` | `yarn clean && yarn install:all` |

### 2.3 Root devDependencies & resolutions

devDependencies: `@commitlint/cli` ^19.8.0, `@commitlint/config-conventional` ^19.8.0, `chai` ^5.2.0, `commitizen` ^4.3.1, `cz-conventional-changelog` ^3.3.0, `husky` ^9.1.7, `lint-staged` ^15.4.3 (unused — no config anywhere), `mocha` ^11.1.0, `prettier` ^3.5.3, `sinon` ^19.0.2, `turbo` ^2.4.4, `typescript` ~5.8.3.

`resolutions` (pin the Expo SDK 53 toolchain across the workspace): `typescript ~5.8.3`, `expo ~53.0.0`, `expo-modules-autolinking ~2.1.0`, `@expo/cli ~0.24.0`, `@expo/config ~11.0.0`, `@expo/config-plugins ~10.1.0`, `@expo/prebuild-config ~9.0.0`, `@expo/metro-config ~0.20.18`, `metro ~0.82.0`, `metro-resolver ~0.82.0`, `metro-config ~0.82.0`.

Version-skew note: root resolution forces TS `~5.8.3` while `web`/`docs`/`@repo/ui` declare `typescript: 5.8.2` (exact) — the resolution wins.

### 2.4 `apps/web` inventory (Next.js 15 App Router, port 3000)

| File | Content |
|---|---|
| `apps/web/package.json` | name `web` v0.1.0, ESM; scripts: `dev` = `next dev --turbopack --port 3000`, `build`, `start`, `lint` = `next lint --max-warnings 5`, `check-types` = `tsc --noEmit`. Deps: `@repo/ui workspace:*`, `next ^15.2.1`, `react`/`react-dom ^19.0.0`. DevDeps: `@repo/eslint-config`, `@repo/typescript-config`, `@types/node ^22.13.9`, `@types/react 19.0.10`, `@types/react-dom 19.0.4`, `eslint ^9.21.0`, `typescript 5.8.2` |
| `apps/web/next.config.js` | Empty `nextConfig = {}` |
| `apps/web/tsconfig.json` | extends `@repo/typescript-config/nextjs.json` (base → module ESNext, moduleResolution Bundler, jsx preserve, noEmit) + `next` TS plugin |
| `apps/web/eslint.config.js` | re-exports `nextJsConfig` from `@repo/eslint-config/next-js` |
| `apps/web/tailwind.config.js` | ESM named exports (`content`/`theme`/`plugins`) — non-standard shape Tailwind won't read as a config object; content globs app/pages/components. **No Tailwind dependency is installed in this app and globals.css has no `@tailwind` directives — config is inert** |
| `apps/web/postcss.config.js` | ESM named export `plugins = { tailwindcss, autoprefixer }` — would fail if actually processed since tailwindcss isn't a dependency here (Next only runs PostCSS config it detects; may break builds if picked up — apparently builds because Next accepts object form and packages hoist from root) |
| `apps/web/app/layout.tsx` | RootLayout loading local Geist Sans/Mono `.woff` via `next/font/local` as CSS vars `--font-geist-sans`/`--font-geist-mono`; metadata title **"Create Next App"** |
| `apps/web/app/page.tsx` | Stock Turborepo starter Home: `ThemeImage` light/dark logo swapper, Vercel deploy CTA link, `Button` from `@repo/ui/button` with `appName="web"` |
| `apps/web/app/globals.css` | Starter CSS vars `--background`/`--foreground` with `prefers-color-scheme: dark` override; imgLight/imgDark swap classes |
| `apps/web/app/page.module.css` | Starter page grid/CTA/footer styles |
| `apps/web/public/*` | Starter SVGs: `next.svg`, `vercel.svg`, `globe.svg`, `window.svg`, `file-text.svg`, `turborepo-light.svg`, `turborepo-dark.svg` |
| `apps/web/app/fonts/` | `GeistVF.woff`, `GeistMonoVF.woff` |
| `apps/web/README.md`, `.gitignore` | Stock create-next-app versions |

Routes: exactly one — `/` (static). No API routes, no middleware, no env usage, no data fetching.

### 2.5 `apps/docs` inventory (Next.js 15 App Router, port 3001)

Byte-for-byte the same starter as `apps/web` with three deltas:

1. `package.json`: name `docs`, `dev` runs on **port 3001**, and adds `"installConfig": { "hoistingLimits": "workspaces" }` (Yarn hoisting limited to this workspace — the only app in scope with this).
2. `app/layout.tsx`: contains a stray literal text node **`hello`** rendered after `{children}` inside `<body>` — someone's test edit left in the tree (only substantive diff from the template).
3. `app/page.tsx`: edits `apps/docs/app/page.tsx` in the copy text and `Button appName="docs"`.

Everything else (next.config, tsconfig, eslint, tailwind/postcss ESM-named-export configs, globals.css, page.module.css, public SVGs, Geist fonts, README, .gitignore) is identical to `apps/web`.

### 2.6 Shared-package touchpoints (context only)

- `@repo/ui` (`packages/ui`): exports via `"./*": "./src/*.tsx"`; `button.tsx` is a `'use client'` component whose only behavior is `alert('Hello from your ${appName} app!')`. Used solely by `web` and `docs`.
- `@repo/typescript-config/nextjs.json`: base + `next` plugin, ESNext/Bundler/preserve-jsx/noEmit.
- `@repo/eslint-config/next-js`: flat-config for Next used by both apps.

---

## 3. Data Models & Types

None. The only types in scope are:
- `Props = Omit<ImageProps, 'src'> & { srcLight: string; srcDark: string }` (ThemeImage helper, duplicated in both apps' `page.tsx`).
- `ButtonProps { children: ReactNode; className?: string; appName: string }` in `@repo/ui`.

No entities, enums, schemas, or API models exist in `web`/`docs` or at root (root `App.tsx` only references types from `apps/users`).

---

## 4. State Management, Caching, Queues, Events

- **App-level state**: none in `web`/`docs` (pure static server components + one client Button). Root `App.tsx` references `AddressProvider` (React Context from `apps/users/contexts/AddressContext.tsx`) but is itself dead code.
- **Build caching**: Turborepo local cache (`.turbo/`, gitignored). `build` outputs cached as `.next/**` minus `.next/cache/**`; `.env*` files are cache inputs so env changes bust the build cache. `dev` is uncached/persistent. Remote caching is described in the README but not configured (no `turbo login/link` artifacts in-repo).
- **CI cache**: GitHub Actions caches `.turbo` keyed `${{ runner.os }}-turbo-${{ github.sha }}` with prefix restore-keys — effectively always a cache miss on save-key, restored from most recent previous run.
- No Redis, queues, websockets, Temporal, or event mechanisms anywhere in this area.

---

## 5. Integration Points

- **With the rest of the platform: effectively none.** `apps/web` and `apps/docs` make zero HTTP calls, reference no `hg-api` endpoints, no env vars, no auth. Their only integration is workspace-internal: `@repo/ui`, `@repo/eslint-config`, `@repo/typescript-config`.
- **Ports**: web dev on `3000`, docs dev on `3001` (via `--turbopack`). Note admin-web/restaurant-web (out of scope) also occupy dev ports; the port split here avoids collision between the two starters.
- **Root App.tsx → apps/users**: imports `./apps/users/contexts/AddressContext` (real) and `./apps/users/navigation/RootNavigator` (**nonexistent** — `apps/users` is Expo Router-based with an `app/` directory). This file is a leftover from a pre-Expo-Router navigation layout and would fail compilation if included by any build; no tsconfig/entry references it (root tsconfig has no `include`, but nothing builds the root as an app).
- **CI branches**: PR validation targets `main` and `frontend-merging` — the latter matches merge commit `b7a57cd "Merge pull request #135 from shaiknoorullah/frontend-merging"`, indicating an integration-branch workflow.
- **EAS**: root `eas.json` + empty root `app.json` suggest EAS builds were at some point attempted from the repo root; mobile apps carry their own `eas.json`, so the root copies are vestigial or a fallback.

---

## 6. Configuration & Environment Variables

- **Env vars consumed in scope: none.** No `process.env` usage in `web`, `docs`, or root files. `.gitignore` excludes `.env`, `.env.local`, `.env.development.local`, `.env.test.local`, `.env.production.local`; app-level `.gitignore`s exclude `.env*` entirely. `turbo.json` lists `.env*` as build inputs (cache correctness only).
- **CI workflow** (`.github/workflows/pr-workflow.yml`, name "PR Validate"): on PRs to `main`/`frontend-merging`; ubuntu-latest; checkout@v3 `fetch-depth: 0`; setup-node@v3 Node **18**; `corepack enable` + `corepack prepare yarn@4.9.2 --activate`; cache `.turbo`; `yarn`; `yarn validate` (lint + typecheck across the whole monorepo, including web/docs); final step: `yarn turbo run build --filter="./packages/*" --filter="!./packages/auth" --filter="!./apps/users" --filter="!./apps/rider" --filter="!./apps/restaurant"` — builds packages **excluding `packages/auth`** (implying it doesn't build cleanly) and explicitly excluding mobile apps (redundant with the `./packages/*` filter). `web`/`docs` are *not* built in CI, only linted/type-checked.
- **Lint budget**: both apps use `next lint --max-warnings 5` — up to 5 warnings tolerated per app.
- **EAS profiles** (root): development (dev client, internal), preview (internal), production (autoIncrement, remote version source).
- **Yarn**: v4.9.2 vendored, node-modules linker (required for React Native/Metro), global cache enabled.

---

## 7. Auth / Security Model

- No authentication, authorization, session handling, or secrets in `web`, `docs`, or root files. No hardcoded credentials found in this area.
- The only auth-adjacent artifact is the CI filter `--filter="!./packages/auth"` proving a broken/excluded shared `auth` package exists (out of scope).
- `web`/`docs` pages are fully public static pages; external links use `rel="noopener noreferrer"` correctly.
- Supply-chain posture: yarn binary is vendored and pinned; `packageManager` field enforces yarn@4.9.2 via corepack.

---

## 8. Code-Quality Observations

**Dead / vestigial code**
1. `apps/web` and `apps/docs` are 100% unmodified starter templates (metadata still "Create Next App", Turborepo marketing page) — candidates for deletion or actual implementation; they add CI lint/typecheck time.
2. Root `App.tsx` is broken dead code: imports nonexistent `./apps/users/navigation/RootNavigator`; `apps/users` migrated to Expo Router (`app/` dir) and has its own `App.tsx`.
3. Root `app.json` (`{"expo":{}}`) and root `eas.json` are vestigial — each mobile app owns its Expo/EAS config.
4. Root `README.md` is the stock Turborepo README (pnpm instructions, "maintained by the Turborepo core team") — misleading for onboarding.
5. Root `test/example.test.js` is a chai/sinon tutorial file testing a toy `add()`; the only root test. `chai`, `sinon`, `mocha` exist solely for it.
6. `lint-staged` is installed but never configured; pre-commit instead runs full-repo `yarn validate` (slow on every commit).
7. Root `tailwind.config.js` content globs reference `screens/`/`pages/` dirs and miss the `app/` dirs actually used by Expo Router apps — stale; each app ships its own tailwind config anyway.

**Bugs / inconsistencies**
8. `apps/docs/app/layout.tsx` renders a stray literal `hello` inside `<body>` after `{children}` — accidental commit visible on every docs page.
9. `apps/web`/`apps/docs` `tailwind.config.js` & `postcss.config.js` use ESM *named* exports (`export const content = ...`) rather than default-exported config objects — Tailwind/PostCSS expect a default export; combined with tailwind not being a dependency of either app and no `@tailwind` directives in their CSS, Tailwind is entirely non-functional in both apps (they style via CSS modules).
10. TypeScript version skew: apps pin `5.8.2` exact; root resolution forces `~5.8.3`.
11. Root `package.json` declares `lint:fix` mapping to `turbo run lint:fix`, but `turbo.json` defines no `lint:fix` task (works only because Turbo ≥2 permits undeclared tasks to error; any app lacking the script breaks it).
12. `.gitignore` ignores `.vscode/` but `.vscode/settings.json` is committed (pre-existing before ignore rule).
13. PR template retains firmware/hardware/toolchain checklist items — copy-paste from an embedded project.
14. CI uses aging action versions (checkout@v3, setup-node@v3) and Node 18 (EOL April 2025) while engines allow `>=18`.
15. CI turbo-cache save key includes `github.sha`, so the exact key never hits; only prefix restores work — functional but noisy.
16. ThemeImage light/dark srcs are swapped-looking by design (`srcLight="turborepo-dark.svg"`) — from the template, correct because logo color inverts, but confusing naming; also duplicated verbatim across both apps instead of living in `@repo/ui`.
17. `apps/docs` alone sets `installConfig.hoistingLimits: "workspaces"` — an unexplained one-off inconsistency with `apps/web`.
18. Git history for `web`/`docs` shows essentially no feature commits (only a root babel/metro fix touched them), confirming abandonment since scaffold.

**TODO-style comments**: only the template comment in root `tailwind.config.js` ("Add other paths as needed"; "you might need to conditionally load presets"). No TODO/FIXME markers in scope otherwise.

**Hardcoded values**: dev ports 3000/3001; `--max-warnings 5` lint budgets; Vercel/Turborepo marketing URLs in both pages. No secrets.

---

## 9. Summary Table — What This Area Contributes

| Concern | Reality |
|---|---|
| Product functionality | None (`web`/`docs` are starter stubs) |
| Platform integration | None (no API calls, env vars, auth) |
| Real value delivered | Monorepo tooling: turbo pipeline, yarn 4 workspaces, husky+commitlint+commitizen conventional commits, prettier, CI validation on PRs to `main`/`frontend-merging` |
| Risk items | Broken root `App.tsx`; stray `hello` in docs layout; unused lint-staged; `packages/auth` excluded from CI build; Node 18 CI; misleading starter README |
