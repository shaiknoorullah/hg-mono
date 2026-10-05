---
covers:
  - .github/workflows/release-builds.yml
  - scripts/release/**
  - apps/customer/app.config.js
  - apps/rider/app.config.js
reviewed: 2026-10-05
---

# Releasing the apps

How HalalGoes builds and hands out its four apps: the customer and rider Android APKs, and the
restaurant and admin web apps. Goal: [release 1.0](https://github.com/shaiknoorullah/hg-mono/issues/257).
The server side of a release (the API, the compose stack, the go-live settings) is in
[`RELEASING.md`](../../RELEASING.md).

Every build is made by the [release-builds workflow](../../.github/workflows/release-builds.yml)
on GitHub's runners, with `expo prebuild` and Gradle for Android. No hosted build service is
involved: Expo's (EAS) is still an open owner decision.

## Two environments

Each build talks to one environment, and only one. The table lives in
[`scripts/release/app-env.cjs`](../../scripts/release/app-env.cjs); the API hosts come from the
`servers` list in [the contract](../../contracts/openapi.yaml).

| | dev | prod |
|---|---|---|
| Talks to | `https://staging-api.halalgoes.com`, the dev environment beside production ([#235](https://github.com/shaiknoorullah/hg-mono/issues/235)) | `https://api.halalgoes.com`, the production API |
| Realtime socket | `wss://staging-api.halalgoes.com/v1/ws` | `wss://api.halalgoes.com/v1/ws` |
| App name | "HalalGoes — Customer Dev", "HalalGoes — Rider Dev" | "HalalGoes — Customer", "HalalGoes — Rider" |
| Android package | `com.halalgoes.customer.dev`, `com.halalgoes.rider.dev` | `com.halalgoes.customer`, `com.halalgoes.rider` |
| APK signed with | Android's debug key | the HalalGoes release key ([below](#the-release-key)) |
| APK built for | 64-bit ARM phones and x86_64 emulators | 64-bit and 32-bit ARM phones |
| Made by | running the workflow by hand | a release tag, or running the workflow by hand |

Dev and prod have different packages, so both install on one phone side by side. Dev builds are
the ones tested end to end on emulators and in browsers ([#77](https://github.com/shaiknoorullah/hg-mono/issues/77)).
The dev host is the contract's second server until the dev environment's own host is settled in
[#235](https://github.com/shaiknoorullah/hg-mono/issues/235); neither host serves traffic until
production is up ([#207](https://github.com/shaiknoorullah/hg-mono/issues/207)).

A prod build cannot point anywhere else: the app config refuses to build a prod app whose bundle
would talk to any API but production's.

## Versions

Every app has its own [semantic version](https://semver.org): `MAJOR.MINOR.PATCH`, for example
`1.0.0`, or a pre-release `MAJOR.MINOR.PATCH-label.N`, for example `1.0.0-rc.1`.

- MINOR and PATCH go up to 99. Pre-release numbers run from 1 to 98, straight through one
  version's pre-releases whatever the label (`rc.1`, `rc.2` …).
- Android needs each update's version code to be higher than the installed one. The code is
  worked out from the version, so a later version always installs over an earlier one:
  `1.0.0-rc.1` is 1000001, `1.0.0` is 1000099, `1.0.1` is 1000199.

Version bumps, changelogs and release notes written for users come with
[versioned releases (#97)](https://github.com/shaiknoorullah/hg-mono/issues/97) and
[the PR rule that asks for a note (#98)](https://github.com/shaiknoorullah/hg-mono/issues/98).
Until then the version is the one in the tag, and the GitHub Release carries the checksums only.

## Cut a release

Tag the commit to release and push the tag. The tag names the app and the version:

| App | Tag | Release contains |
|---|---|---|
| Customer | `customer-v1.0.0` | `halalgoes-customer-1.0.0.apk` and its `.sha256` |
| Rider | `rider-v1.0.0` | `halalgoes-rider-1.0.0.apk` and its `.sha256` |
| Restaurant | `restaurant-v1.0.0` | `halalgoes-restaurant-1.0.0.tar.gz` and its `.sha256` |
| Admin | `admin-v1.0.0` | `halalgoes-admin-1.0.0.tar.gz` and its `.sha256` |

```bash
git switch main && git pull
git tag customer-v1.0.0
git push origin customer-v1.0.0
```

A tag always builds **prod**, and only from a commit that is on `main`; a tag anywhere else is
refused. When the build passes, the workflow publishes a GitHub Release for the tag with the files
and their SHA-256 sums; a version with a pre-release label (`-rc.1`) is marked as a pre-release.
If the build fails, no release is made: fix the cause and run the failed jobs again, or delete the
tag and tag again.

### A build without a tag

Actions → release-builds → Run workflow, then pick the app, the environment and a version. Or:

```bash
gh workflow run release-builds.yml -f app=customer -f env=dev -f version=1.0.0-dev.1
gh run watch
```

The files are on the run's page under Artifacts for 14 days. Dev builds run from any branch. Prod
builds run from `main` only (choose `main` in "Use workflow from"); use one to try a prod build
before tagging it.

### What each build checks

- The APK's package, version name and version code are the ones expected for its environment.
- The API it talks to is inside its JavaScript bundle (and inside a web bundle).
- Dev APKs carry the debug key. Prod APKs do not; when the variable
  `ANDROID_RELEASE_CERT_SHA256` is set, their certificate must be the release key's.

### What keeps a prod build trustworthy

- Prod builds come only from `main` or a tag on `main`. The workflow checks this twice: once
  before building anything, and again in the job that signs, where git must confirm that `main`
  contains the commit before any step reads a signing secret. A tag name proves nothing on its
  own: a tag can point at any commit.
- The signing secrets belong to the repo's `release` environment, never to the repo itself (any
  workflow on any branch can read a repo secret). Only the prod Android job enters that
  environment, and GitHub lets in only `main` and the `customer-v*` and `rider-v*` tags: its
  deployment rules (Settings → Environments → release) refuse every other branch and tag. Dev
  builds and pull requests cannot read the secrets. The owner can add required reviewers to the
  environment, so each prod build waits for approval.
- Prod builds restore no cache: they are built from the commit alone.
- Every action the workflow uses is pinned to a commit, and its inputs are checked against a fixed
  list before any script sees them.

## Web apps

The restaurant and admin apps build to static files, served by the production host when hosting
lands ([#52](https://github.com/shaiknoorullah/hg-mono/issues/52)). Build one locally the same way
the workflow does:

```bash
pnpm --filter @hg/restaurant build:dev
APP_VERSION=1.0.0 pnpm --filter @hg/restaurant build:prod
pnpm --filter @hg/admin build:dev
APP_VERSION=1.0.0 pnpm --filter @hg/admin build:prod
```

Each writes the app's `dist` folder. These commands set `VITE_API_BASE_URL` and `VITE_WS_URL` for the
environment and win over any `.env.local`. The admin's live map needs `VITE_MAPBOX_TOKEN`; in CI
it comes from the repo secret `MAPBOX_PUBLIC_TOKEN_WEB`
([Mapbox tokens, #57](https://github.com/shaiknoorullah/hg-mono/issues/57)). The plain
`pnpm --filter @hg/admin build` still builds against whatever `.env.local` says, for local work.

## Android apps, built locally

Don't, on a shared machine: a Gradle build of either app takes most of its CPU and memory for a
long time. Use the workflow. If you must, the steps are the workflow's, in `apps/customer` or
`apps/rider`:

```bash
node ../../scripts/release/app-env.cjs dev -- npx expo prebuild --platform android --no-install
cd android && node ../../../scripts/release/app-env.cjs dev -- ./gradlew assembleRelease
```

`app-env.cjs` sets `APP_ENV`, `APP_VERSION` and the `EXPO_PUBLIC_*` API addresses for every step.
A dev build can be pointed at another API with `API_BASE_URL`, for example an API on your own
machine as an emulator sees it: `API_BASE_URL=http://10.0.2.2:8080`.

The Mapbox public token is `EXPO_PUBLIC_MAPBOX_TOKEN` (in CI, the repo secret
`MAPBOX_PUBLIC_TOKEN_MOBILE`). No Mapbox download token is needed: Mapbox serves the native SDK
without one.

For a local `eas build`, the customer's `eas.json` `preview` and `production` profiles set
`EXPO_PUBLIC_API_BASE_URL` to the placeholder `https://api.halalgoes.com`. To point a build at
another API, change that profile's `env` value.

The customer app pays with Stripe's payment sheet, which needs the PUBLIC key
`EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_test_…` or `pk_live_…`; in CI, the repo secret
`STRIPE_PUBLISHABLE_KEY_MOBILE`). It must be from the same Stripe account and mode as the API's
`HG_STRIPE_SECRET_KEY`, or the sheet cannot confirm the payment. The sheet is native-only: on web
the customer app skips it. When the API runs its local fake gateway (`HG_ENV=local`, no Stripe
key) it returns `pi_fake_…` client secrets and the app skips the sheet too.

## The release key

Prod APKs are signed with the HalalGoes release key. Android installs an update only if it is
signed with the same key as the installed app, so this key is permanent: **if it is lost, every
person with the app has to uninstall it and install it again.**

The owner makes it once ([#264](https://github.com/shaiknoorullah/hg-mono/issues/264)), on their
own machine, with a JDK 17+ for `keytool` and `gh` signed in with admin rights on the repo:

```bash
scripts/release/make-android-keystore.sh
```

The script:

1. makes the key in `~/halalgoes-android-release-key`, outside the repo, with a random password;
2. sets up the `release` environment (only `main` and the Android release tags may use it) and
   stores in it the secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
   `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`, and the variable
   `ANDROID_RELEASE_CERT_SHA256`;
3. prints how to back it up. Do it straight away: both files in the folder go into a password
   manager and onto offline storage.

It never prints the password or passes it on a command line, and it refuses to write the key
inside a git checkout. Run it again with the same folder to set the secrets again; it will not
make a second key while the repo already has one. It creates the `release` environment if it is
missing and sets its deployment rules; if it cannot, it stops before storing anything, and it
never falls back to repo secrets. At the end it prints where everything went.

Until the secrets exist, a prod Android build stops at its first step with "Release key missing"
and names this task. Dev builds don't need the key.

## Install an APK (sideload)

The APKs are handed out directly, not through an app store.

1. Download the `.apk` and its `.sha256` from the GitHub Release, and check the checksum (below)
   before sending the file to anyone.
2. Send the APK to the phone (a download link, a USB cable, or a messaging app that keeps files
   intact).
3. On the phone, open the file. Android asks to allow installs from that source (the browser, the
   file manager or the messaging app): allow it for that app only, go back, and install.
4. Afterwards, turn that permission off again in Settings → Apps → Special app access → Install
   unknown apps.

An update installs over the old version and keeps its data, as long as it is signed with the same
key and has a higher version. A dev build installs beside the prod one and does not touch it.

With a computer and USB debugging on: `adb install -r halalgoes-customer-1.0.0.apk`.

## Check a checksum

The `.sha256` file holds the SHA-256 the build computed. Compare the downloaded file with it.

Linux:

```bash
sha256sum -c halalgoes-customer-1.0.0.apk.sha256
```

macOS:

```bash
shasum -a 256 -c halalgoes-customer-1.0.0.apk.sha256
```

Windows (PowerShell): compare the printed hash with the one in the `.sha256` file and in the
release notes.

```powershell
Get-FileHash .\halalgoes-customer-1.0.0.apk -Algorithm SHA256
```

`OK` (or matching hashes) means the file is exactly what the workflow built. Anything else: don't
install it, download it again.

To see who signed an APK, with the Android SDK's build tools:
`apksigner verify --print-certs halalgoes-customer-1.0.0.apk`. A prod APK's certificate SHA-256
is the one the release notes and the key script printed.
