# HalalGoes — Frontend Monorepo Shared Packages (`/home/user/halal-goes/packages/*`)

Analysis date: 2026-08-09. Scope: `packages/auth`, `packages/ui`, `packages/eslint-config`, `packages/tailwind-config`, `packages/typescript-config` in the `halal-goes` Turborepo (yarn 4.9.2 workspaces `apps/*` + `packages/*`, turbo `^2.4.4`/`^2.5.5`).

---

## 1. Purpose & Role

The `packages/` directory holds the five shared workspace packages of the Turborepo frontend monorepo. Only one of them — **`@halal-goes/auth`** — is substantive product code: a shared phone-OTP authentication SDK (Supabase session management + axios calls to the HalalGoes backend API) consumed by the three Expo mobile apps (`users`, `rider`, `restaurant`). The other four are scaffolding:

- **`@repo/ui`** — leftover `create-turbo` starter React component library, consumed only by the starter Next.js apps `web` and `docs` (not by any real product app).
- **`@repo/eslint-config`** — shared flat-config ESLint presets (base / next-js / react-internal).
- **`@repo/typescript-config`** — shared `tsconfig` presets (base / nextjs / react-library).
- **`@halal-goes/tailwind-config`** — an essentially empty Tailwind preset used by `rider` and `restaurant` tailwind configs.

There are **two package namespaces** in use: real product packages use `@halal-goes/*` while starter-derived packages use `@repo/*` — an inconsistency worth noting.

Root `package.json` scripts relevant to packages: `build:packages` (`turbo run build --filter="./packages/*"`), `install:all` (`yarn install && yarn build:packages`), `reset`, `validate` (`lint` + `check-types`). Turbo tasks: `build` (dependsOn `^build`, outputs `.next/**`), `lint`, `check-types`, `test` (each dependsOn `^`), `dev` (no cache, persistent). Root `resolutions` pin `typescript ~5.8.3`, `expo ~53.0.0`, metro `~0.82.0`, etc.

---

## 2. Package Inventory

| Package | npm name | Version | Entry | Files | Consumers |
|---|---|---|---|---|---|
| auth | `@halal-goes/auth` | 0.1.0 | `src/index.ts` (raw TS, `main` & `types` both point at source) | 18 TS files | `apps/rider` (declared dep), `apps/restaurant` (declared dep), `apps/users` (**undeclared** — imports it but package.json only lists `@repo/eslint-config`) |
| ui | `@repo/ui` | 0.0.0 | `exports: {"./*": "./src/*.tsx"}` | `button.tsx`, `card.tsx`, `code.tsx` + turbo generator | `apps/web`, `apps/docs` (starter apps only) |
| eslint-config | `@repo/eslint-config` | 0.0.0 | `./base`, `./next-js`, `./react-internal` exports | `base.js`, `next.js`, `react-internal.js`, README | `apps/web`, `apps/docs` (via `eslint.config.js` → `next-js`), `apps/users` (declared dep, but no eslint.config file found in users app), `packages/ui` (react-internal) |
| tailwind-config | `@halal-goes/tailwind-config` | 1.0.0 | `tailwind.config.js` | 1 file | `apps/rider/tailwind.config.js`, `apps/restaurant/tailwind.config.js` (both `require('@halal-goes/tailwind-config')` — **not declared** in either app's package.json) |
| typescript-config | `@repo/typescript-config` | 0.0.0 | `base.json`, `nextjs.json`, `react-library.json` | 3 json | `apps/web`, `apps/docs` (tsconfig extends `nextjs.json`), `packages/ui` (react-library), `packages/auth` (extends `../typescript-config/base.json` by relative path, not by package name). Expo apps extend `expo/tsconfig.base` instead; `admin-web`/`restaurant-web` have standalone tsconfigs and use **no** shared packages at all. |

---

## 3. `@halal-goes/auth` — Deep Dive

### 3.1 File map

```
packages/auth/
├── package.json                      # deps: @supabase/supabase-js ^2.55.0, axios ^1.13.3,
│                                     #       expo ^54.0.10, expo-secure-store ~14.0.1,
│                                     #       react 18.3.1, zod ^4.0.15, zustand ^5.0.7
│                                     # (supabase-js/secure-store/zod/zustand doubled as peerDeps)
├── tsconfig.json                     # extends ../typescript-config/base.json; ES2020, outDir dist
└── src/
    ├── index.ts                      # barrel — full public API
    ├── createAuth.ts                 # factory: supabase client + service + store
    ├── createAppAuth.ts              # zero-config factory (env vars + DEFAULT_AUTH_CONFIG)
    ├── config/constants.ts           # DEFAULT_AUTH_CONFIG, getEnvVariables()
    ├── clients/supabase.ts           # createSupabaseClient (SecureStore-backed)
    ├── services/authService.ts       # createAuthService — OTP/register/logout/session ops
    ├── store/createAuthStore.ts      # zustand store factory
    ├── storage/authStorage.ts        # SecureStore key/value wrapper
    ├── hooks/usePhoneInput.ts        # createPhoneValidationService
    ├── hooks/useAuthStoreHook.ts     # createUseAuthStore (non-reactive wrapper)
    ├── schemas/phone.ts              # zod schemas: phoneInput, phoneSubmission, otp
    ├── utils/phoneUtils.ts           # formatPhoneNumber / isValidPhoneNumber / cleanPhoneNumber
    ├── types/index.ts                # AuthState, AuthActions, DTOs
    └── lib/apis/
        ├── logout/logout.ts          # POST {BASE}/auth/logout
        ├── user/{index.ts, register/index.ts, otp/requestOtp.ts, otp/verifyOtp.ts}
        └── rider/{index.ts, register/index.ts, otp/requestOtp.ts, otp/verifyOtp.ts}
```

### 3.2 Public API surface (from `src/index.ts`)

- Clients: `createSupabaseClient`
- Services: `createAuthService`, types `AuthService`, `AuthServiceDependencies`
- Storage: `authStorage`, type `AuthStorage`
- Schemas: `phoneInputSchema`, `phoneSubmissionSchema`, `otpSchema` + inferred types `PhoneInputData`, `PhoneSubmissionData`, `OtpData`
- Types: `AuthState`, `AuthActions`, `AuthStoreState`, `UsePhoneInputReturn`, `PhoneInputScreenProps`, `AuthStoreConfig`, `OtpVerificationResult`, `PhoneInputOptions`, `UserDetailsUpdate` (note: `RiderDetailsUpdate` exists in types but is **not** re-exported from the barrel)
- Hooks/factories: `createPhoneValidationService` (+ `PhoneValidationService`), `createUseAuthStore`, `createAuthStore` (+ `CreateAuthStoreOptions`, `AuthStore`)
- Utils: `formatPhoneNumber`, `isValidPhoneNumber`, `cleanPhoneNumber`
- Composition: `createAuth`, `createAppAuth` (default export re-exported), `DEFAULT_AUTH_CONFIG`, `getEnvVariables`

### 3.3 Backend HTTP integration (axios, `EXPO_PUBLIC_BASE_API_URL`)

All API modules build URLs as `` `${process.env.EXPO_PUBLIC_BASE_API_URL}/...` `` with plain `axios.post` (no shared axios instance, no interceptors, no timeout):

| Function | Method & Path | Payload | Auth header |
|---|---|---|---|
| user `requestOtp` | POST `/auth/otp/request` | `{ phone }` | none |
| user `verifyOtp` | POST `/auth/otp/verify` | `{ phone, otp }` | none |
| user `register` | POST `/auth/register` | `{ first_name, last_name, email }` | optional `Bearer <onboarding_token>` |
| rider `requestOtp` | POST `/auth/rider/otp/request` | `{ phone }` | none |
| rider `verifyOtp` | POST `/auth/rider/otp/verify` | `{ phone, otp }` | none |
| rider `register` | POST `/auth/rider/register` | `{ email }` | required `Bearer <onboarding_token>`; returns `{ success: true, data }` (shape differs from user register, which returns `response.data` directly) |
| `logout` | POST `/auth/logout` | none | none (relies on nothing; swallows the real error into `new Error('Logout failed')`) |

The `onboarding_token` pattern implies the backend issues a short-lived token after OTP verification which the register call presents as a Bearer token. Note: **these `/auth/*` routes do not exist in the local `hg-api` snapshot** (`hg-api/api/src/features` contains only `carts` and `users`); the package targets the deployed API (`https://api.halalgoes.com` per app `.env.example` files).

### 3.4 Supabase client (`clients/supabase.ts`)

`createSupabaseClient({supabaseUrl, supabaseAnonKey})` → throws if either missing. Config: on non-web platforms, `auth.storage` is backed by `expo-secure-store` (`getItemAsync`/`setItemAsync`/`deleteItemAsync`); `autoRefreshToken: true`, `persistSession: true`, `detectSessionInUrl: false`, `lock: processLock`. Registers a React Native `AppState` listener that calls `supabase.auth.startAutoRefresh()` when app becomes `active` and `stopAutoRefresh()` otherwise (listener never removed — one leak per client created).

### 3.5 Auth service (`services/authService.ts`)

`createAuthService({ supabase })` returns:

- `sendOtp(phone, userType)` — dispatches to user vs rider `requestOtp`; throws `Invalid userType` otherwise. **No 'restaurant' branch** even though the restaurant app instantiates this service.
- `verifyOtp(phone, otp, userType)` — same dispatch.
- `verifyProfileOtp(phone, token)` — Supabase `auth.verifyOtp({phone, token, type: 'sms'})` (direct Supabase SMS OTP path, distinct from the backend OTP endpoints). No consumer found in apps.
- `signOut()` — calls backend `logout()` (does NOT call `supabase.auth.signOut()`; local Supabase session is not cleared here).
- `getSession()` — `supabase.auth.getSession()`.
- `updateUserMetadata(metadata)` — `supabase.auth.updateUser({ data })`. No consumer found.
- `updateUserDetails(data: UserDetailsUpdate)` — wraps user `register`; returns `{data, error}` envelope; extracts `error.response?.data?.message`.
- `updateRiderDetails(data: RiderDetailsUpdate)` — wraps rider `register`; error message copy-pasted as "Error updating user details".

### 3.6 Zustand store (`store/createAuthStore.ts`)

`createAuthStore({ authService, config })` — `defaultCountryCode` defaults `'+91'`. State: `isAuthenticated`, `userPhone`, `user` (Supabase `User`), `session` (Supabase `Session`), `isLoading` (initial `true`). Actions: `checkAuthStatus` (via `getSession`), `sendOtp`, `verifyOtp`, `logout`, `setLoading`, `setUserPhone` (refuses empty or unauthenticated; contains a commented-out "backup" block that would push phone into user metadata), `updateUserMetadata(metadata, email?, password?)` → delegates to `authService.updateUserDetails({email, password, metadata})`.

**Apparent bugs (stale vs. service signature):**
1. Store calls `authService.sendOtp(formattedPhone)` and `authService.verifyOtp(formattedPhone, otp)` **without the required `userType` argument** → at runtime the service throws `Invalid userType: undefined`; also a TS arity error, so `tsc` on this package should fail.
2. Store destructures `{ data, error }` / `{ session, error }` from service calls that return raw backend `response.data` — the `session?.user` branch will practically never be hit via the backend OTP path.
3. `updateUserDetails({email, password, metadata})` doesn't match `UserDetailsUpdate` (`first_name`, `last_name`, `email`, `onboarding_token` required) — another type mismatch; `password` isn't part of any DTO.
4. `AuthStore` exported type is `ReturnType<ReturnType<typeof createAuthStore>>` — i.e. the *state* type, not the store type (misleading name).

Because of this, all three mobile apps implement their **own** zustand auth stores (`apps/users/stores/useAuth.tsx`, `apps/rider/store/useAuth.ts`) that call `authService.sendOtp(phone, 'user'|'rider')` correctly — the shared store is effectively dead weight that `createAppAuth()` still constructs on every startup.

### 3.7 `createAuth` / `createAppAuth`

- `createAuth({supabaseUrl, supabaseAnonKey, config?})` → `{ supabase, authService, authStore }`.
- `createAppAuth()` → reads env via `getEnvVariables()` (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, both defaulting to `''` — which makes `createSupabaseClient` throw at import time if unset), builds `createAuth` with `DEFAULT_AUTH_CONFIG` (`defaultCountryCode: '+91'`, `phoneNumberLength: 10`), wraps store with `createUseAuthStore`. Quirk: `createAppAuth.ts` imports from `'@halal-goes/auth'` (its own package name) rather than relative paths — works only via workspace self-resolution.

### 3.8 Hooks

- `createUseAuthStore(store)` (`hooks/useAuthStoreHook.ts`): despite the `use` prefix, this is **not reactive** — it returns `store.getState()` snapshots plus a `subscribe` and `getState`; components using it won't re-render on store changes unless they wire `subscribe` manually. It also omits `updateUserMetadata` from the returned actions.
- `createPhoneValidationService(authService)` (`hooks/usePhoneInput.ts`): pure validation service — `validatePhoneInput`, `validatePhoneSubmission` (both zod-based, generic "Invalid phone number" message), `sendOtp(phoneNumber, countryCode='+91')` (**same missing-`userType` bug** as the store), plus re-exposed `formatPhoneNumber`/`cleanPhoneNumber`/`isValidPhoneNumber`. No app consumer found (apps have their own `utils/inputUtitls.ts` [sic] hooks).

### 3.9 Schemas & utils

- `phoneInputSchema` / `phoneSubmissionSchema`: `phoneNumber` must be exactly 10 digits (India-centric; `phoneSubmissionSchema` has a redundant `.refine` length check on top of the regex). `otpSchema`: exactly 6 digits.
- `formatPhoneNumber(phone, countryCode='+91')` → E.164-ish: strips non-digits; if digits already start with the country code digits, prefixes `+`, else prepends countryCode. Edge case: a 10-digit number starting with "91..." would be misinterpreted as already having the country code.
- `isValidPhoneNumber`: exactly 10 digits after stripping. `cleanPhoneNumber(phone, maxLength=10)`: digits only, truncated.

### 3.10 SecureStore persistence (`storage/authStorage.ts`)

Keys: `otp_verified` (bool JSON), `user_phone` (string), `user_data` (JSON `any`). Methods: `setOtpVerified/getOtpVerified`, `setUserPhone/getUserPhone`, `setUserData/getUserData`, `clearAll()` (deletes all three). Re-exported verbatim by `apps/rider/utils/storage.ts` and `apps/restaurant/utils/storage.ts` as `storage`. This is separate from the Supabase session storage (which uses Supabase's own SecureStore keys).

### 3.11 Consumers of `@halal-goes/auth` (exact usage)

| App | File | Usage |
|---|---|---|
| users | `apps/users/lib/auth.ts` | `createAppAuth()` → exports only `{ authService, supabase }` |
| users | `apps/users/app/account-settings.tsx` | imports `createAppAuth`, `UserDetailsUpdate` |
| users | `apps/users/stores/useAuth.tsx` | own zustand store; calls `authService.sendOtp(phone,'user')`, `verifyOtp(...,'user')`, `updateUserDetails` |
| rider | `apps/rider/lib/auth.ts` | `createAppAuth()` → exports `{ authService, supabase, authStore, useAuthStore }` |
| rider | `apps/rider/services/authService.ts` | `createAuthService({ supabase })` with app-local supabase client (`apps/rider/lib/supabase.ts` duplicates `clients/supabase.ts` logic) |
| rider | `apps/rider/utils/storage.ts` | re-exports `authStorage` |
| rider | `apps/rider/schema/phone.ts` | re-exports `phoneInputSchema`, `phoneSubmissionSchema` + types "for backwards compatibility" |
| rider | `apps/rider/store/useAuth.ts` | own store; `sendOtp(phone,'rider')`, `verifyOtp(...,'rider')`, `updateRiderDetails({ email, onboarding_token })` |
| restaurant | `apps/restaurant/lib/auth.ts` | `createAppAuth()` |
| restaurant | `apps/restaurant/services/authService.ts` | `createAuthService({ supabase })` — but the service has no 'restaurant' userType branch |
| restaurant | `apps/restaurant/utils/storage.ts` | re-exports `authStorage` |

`apps/users/package.json` does **not** declare `@halal-goes/auth` (phantom dependency working via hoisting).

---

## 4. `@repo/ui`

`create-turbo` starter library, React 19, `"type": "module"`, per-file exports (`"./*": "./src/*.tsx"`). Scripts: `lint` (`--max-warnings 5`), `generate:component` (`turbo gen react-component`), `check-types`. No build step — consumed as TSX source.

- `src/button.tsx` — `'use client'`; props `{children, className?, appName}`; onClick shows `alert("Hello from your ${appName} app!")` (pure starter demo code).
- `src/card.tsx` — anchor card appending `?utm_source=create-turbo&utm_medium=basic&utm_campaign=create-turbo"` (note the stray trailing `"` in the template literal — starter bug). **No consumers.**
- `src/code.tsx` — trivial `<code>` wrapper. **No consumers.**
- `turbo/generators/config.ts` + `templates/component.hbs` — Plop generator "react-component": creates `src/{{kebabCase name}}.tsx` and appends an export entry to package.json (append is pointless given the wildcard exports).

Only `apps/web/app/page.tsx` and `apps/docs/app/page.tsx` import `@repo/ui/button`. No real product app (users/rider/restaurant/admin-web/restaurant-web) uses this package. React version conflict with `@halal-goes/auth` (react 18.3.1) and root Expo resolution (expo pinned ~53 at root vs ^54.0.10 in auth package).

---

## 5. `@repo/eslint-config`

Flat-config presets, ESLint 9, exports `./base`, `./next-js`, `./react-internal`. README still titled "`@turbo/eslint-config`". Oddity: `turbo ^2.5.5` is in `dependencies` while everything else is devDeps.

- **`base.js`** (`export const config`): `@eslint/js` recommended + prettier + `typescript-eslint` recommended + `eslint-plugin-turbo` (`turbo/no-undeclared-env-vars: warn`) + `eslint-plugin-unused-imports`. Ignores: `dist/`, `node_modules/`, `build/`, `*.d.ts`, `.turbo/`, `out/`, `.next/`. Custom rules: `unused-imports/no-unused-imports: error`, `unused-imports/no-unused-vars: error` (args/vars `^_` ignored), `no-explicit-any: warn`, `no-console: warn`, `no-alert: warn`, `no-debugger: warn`, `no-var: error`, `prefer-const: warn`, `eqeqeq: warn always`, `no-duplicate-imports: error`, `no-const-assign: error`, `max-len: off`, etc. **Bug/irony:** line 6 has a dead import `import { unchangedTextChangeRange } from 'typescript';` — an unused import in the very config that errors on unused imports. Also `eslint-plugin-only-warn` is a devDep but never wired into any config.
- **`next.js`** (`export const nextJsConfig`): spreads `baseConfig` then **re-adds** js.recommended/prettier/tseslint.recommended (duplicated), adds `eslint-plugin-react` flat recommended with `globals.serviceworker`, `@next/eslint-plugin-next` (recommended + core-web-vitals rules), `react-hooks` recommended, `react/react-in-jsx-scope: off`. Consumers: `apps/web/eslint.config.js`, `apps/docs/eslint.config.js`.
- **`react-internal.js`** (`export const config`): same duplication pattern; uses `createRequire` to load CJS plugins (`@eslint/js`, prettier, react, react-hooks) alongside ESM imports; adds `globals.serviceworker + globals.browser`. Consumer: `packages/ui/eslint.config.mjs`.

Notably, `admin-web` and `restaurant-web` do NOT use this package — they run their own `FlatCompat`-based configs extending `next/core-web-vitals` + `next/typescript`. The Expo apps have no eslint config files at all (though `users` declares `@repo/eslint-config` as a dep).

---

## 6. `@halal-goes/tailwind-config`

Single file `tailwind.config.js`: `{ content: [], theme: { extend: {} }, plugins: [] }` — an **empty placeholder preset** (no brand colors/tokens whatsoever). Version 1.0.0, devDep `tailwindcss ^3.4.17`. Consumed by `apps/rider/tailwind.config.js` and `apps/restaurant/tailwind.config.js`, which spread `sharedConfig.theme` under their own `theme` with `nativewind/preset` — spreading an empty object, i.e. functionally a no-op. Neither consumer declares it in package.json (phantom dep). The `users` app and web apps don't use it.

---

## 7. `@repo/typescript-config`

Three JSON presets, no code. package.json declares `"license": "MIT"` and `publishConfig.access: "public"` despite `"private": true`.

- **`base.json`**: strict, `target ES2022`, `lib es2022/DOM/DOM.Iterable`, `module NodeNext`, `moduleResolution NodeNext`, `moduleDetection force`, `noUncheckedIndexedAccess: true`, `isolatedModules`, `declaration` + `declarationMap`, `incremental: false`, `skipLibCheck`.
- **`nextjs.json`**: extends base; `plugins: [{name: "next"}]`, `module ESNext`, `moduleResolution Bundler`, `allowJs`, `jsx preserve`, `noEmit`.
- **`react-library.json`**: extends base; `jsx react-jsx`.

Consumers: `apps/web` & `apps/docs` (`nextjs.json`), `packages/ui` (`react-library.json`), `packages/auth` (extends `../typescript-config/base.json` via **relative path** and then locally overrides nearly everything: ES2020 target/lib, `module ESNext`, `moduleResolution node`, `noEmit false`, `outDir dist`). Expo apps extend `expo/tsconfig.base`; `admin-web`/`restaurant-web` roll their own.

---

## 8. Configuration & Environment Variables

| Variable | Used in | Purpose | Default |
|---|---|---|---|
| `EXPO_PUBLIC_BASE_API_URL` | all `packages/auth/src/lib/apis/**` | Backend API base URL | none (`undefined` → literal "undefined/..." URLs). App `.env.example`s set `https://api.halalgoes.com`; users app has a commented-out `http://98.130.76.223:3456` (raw server IP) |
| `EXPO_PUBLIC_SUPABASE_URL` | `config/constants.ts` → `createAppAuth` | Supabase project URL | `''` (then `createSupabaseClient` throws) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | same | Supabase anon key | `''` (throws) |

Constants: `DEFAULT_AUTH_CONFIG = { defaultCountryCode: '+91', phoneNumberLength: 10 }` (India-only assumption baked into schemas too). SecureStore keys: `otp_verified`, `user_phone`, `user_data`. No hardcoded secrets found in packages (only example placeholders and the commented dev IP in an app-level .env.example).

---

## 9. Auth/Security Model

- Dual auth planes: (a) backend OTP endpoints (`/auth/otp/*`, `/auth/rider/otp/*`) presumably fronting Supabase/SMS, with an **onboarding token** (Bearer) gating registration; (b) direct Supabase session APIs (`getSession`, `verifyOtp type:'sms'`, `updateUser`) against the Supabase project with the public anon key.
- Session persistence via `expo-secure-store` (encrypted device storage) with auto refresh tied to AppState — good practice for RN.
- Weaknesses: axios calls carry **no auth interceptor** — nothing attaches the Supabase access token to backend calls from this package; `logout()` sends no credentials/token so the backend can't know which session to kill, and `signOut()` never clears the local Supabase session; `authStorage.setUserData` stores untyped `any`; all errors are `console.error`'d (leaking to device logs) and often replaced with generic messages.

---

## 10. Code-Quality Observations (consolidated)

1. **Broken/stale shared store**: `createAuthStore` and `createPhoneValidationService.sendOtp` call `authService.sendOtp/verifyOtp` without the required `userType` param, and mis-destructure return shapes — TS arity errors + guaranteed runtime throw. Apps bypass it with their own stores, but `createAppAuth()` still builds it. `packages/auth` `tsc` typecheck should fail.
2. **Phantom workspace dependencies**: `apps/users` imports `@halal-goes/auth` without declaring it; `apps/rider` and `apps/restaurant` require `@halal-goes/tailwind-config` without declaring it.
3. **Restaurant gap**: restaurant app instantiates `createAuthService` but the service supports only `'user'`/`'rider'` userTypes — no restaurant OTP/register path in the shared package.
4. **Naming split**: `@halal-goes/*` vs `@repo/*` package scopes; `@repo/*` packages are unmodified create-turbo boilerplate (README even says `@turbo/eslint-config`).
5. **Dead code**: `ui/card.tsx`, `ui/code.tsx` (no consumers; card has a stray `"` in its UTM URL); `verifyProfileOtp`, `updateUserMetadata` (service), `RiderDetailsUpdate` not exported from barrel; commented-out metadata-update block in `setUserPhone`; unused `unchangedTextChangeRange` import in `eslint-config/base.js`; `eslint-plugin-only-warn` installed but unused; `@halal-goes/tailwind-config` is an empty no-op preset.
6. **Version conflicts**: auth package pins `react 18.3.1` & `expo ^54.0.10` while root resolutions force `expo ~53.0.0` and `@repo/ui` uses React 19 — three React/Expo baselines in one workspace. auth lists the same four libs in both `dependencies` and `peerDependencies`.
7. **Non-reactive "hook"**: `createUseAuthStore` returns `getState()` snapshots — components won't re-render on auth changes; also omits `updateUserMetadata`.
8. **Copy-paste artifacts**: `updateRiderDetails` logs "Error updating user details"; useless `try { ... } catch (error) { throw error }` wrappers in `register`/`logout`; `logout` discards the original error; rider vs user register return-shape divergence (`{success,data}` vs raw data).
9. **eslint next.js/react-internal duplicate** base layers (js.recommended, prettier, tseslint) already included via `...baseConfig`.
10. **No tests** anywhere in `packages/` (root has mocha/chai/sinon configured, `test/` dir at repo root only).
11. Excessive `console.log` of session/user objects in the store (`console.log(session?.user)`) — PII in logs; ironic given base eslint sets `no-console: warn`.
12. `typescript-config/package.json` sets `publishConfig.access: public` + MIT license on a private package.

---

## 11. Integration Summary

- **auth package → backend API**: 7 REST endpoints under `${EXPO_PUBLIC_BASE_API_URL}/auth/*` (see §3.3). These endpoints are not present in the local `hg-api` snapshot (features/ only has carts & users; API collection JSONs contain no auth/otp requests) — they exist on the deployed `https://api.halalgoes.com`.
- **auth package → Supabase**: session storage/refresh, SMS OTP verify (`verifyProfileOtp`), user metadata update, via `EXPO_PUBLIC_SUPABASE_URL`/`ANON_KEY`.
- **auth package → apps**: `createAppAuth()` singletons in each mobile app's `lib/auth.ts`; apps layer their own zustand stores/hooks over `authService`; `authStorage` re-exported for onboarding flags.
- **config packages → apps**: only the starter Next.js apps (`web`, `docs`) and `packages/ui` actually consume the shared eslint/tsconfig presets; the real web apps (`admin-web`, `restaurant-web`) and Expo apps do not — shared-config adoption is essentially confined to boilerplate.
