# Android device lab for agent-driven testing: decision report

**Deadline:** Monday 12 Oct 2026. The user moved the release from Tue 6 Oct to this Monday. `AGENTS.md` §7 still says 6 Oct and needs updating separately.
**Date of findings:** Fri 9 Oct 2026. Every probe ran inside the Anthropic cloud container. Nothing in the repo was changed and no workflow was triggered.

---

## 1. Bottom line

**This container cannot run Android, so don't try again.** It is a Firecracker microVM. It has no `/dev/kvm` and no vmx/svm flags. The kernel has no binder, and module loading is disabled (`nomodule`). We measured a software-emulated (TCG) API 34 emulator: after 19 minutes the screen was still black and one screenshot took 24.5 s ([emulator command line](https://developer.android.com/studio/run/emulator-commandline), [Linaro TCG boot analysis](https://linaro.atlassian.net/wiki/spaces/QEMU/pages/29465968650/Android+QEMU+boot+time+analysis)).

The container is good for:
- building both dev APKs (about 11 min cold, about 3 min warm);
- running the Go API stack (`dockerd` starts by hand);
- running Playwright.

**Recommended setup: two tracks in parallel.**

| | What | Why | Owner action |
|---|---|---|---|
| **Primary (start now, no new spend)** | **Device lab on a GitHub Actions KVM runner, with Claude Code running on the runner.** A new `device-lab.yml` reuses the boot, seed and emulator steps from `e2e.yml`, then runs the `claude` CLI with `maestro mcp`, `mobile-mcp` (stdio), adb and the Playwright MCP. A cloud agent dispatches a "mission" and reads back a report plus screenshots. | It is the only path that works today with no network-policy change, no new account and no new SaaS. KVM on these runners is proven: `e2e.yml` run [37324952069](https://github.com/shaiknoorullah/hg-mono/actions/runs/37324952069) passed on 5 Oct. The `CLAUDE_CODE_OAUTH_TOKEN` secret already exists in `claude.yml`. | Merge the workflow, or allow it to run on a PR label. Put the secret in a dedicated GitHub environment. |
| **Upgrade (if the owner approves about USD 40–60 by Saturday)** | **A GCP `n2-standard-16` VM with nested virtualization**, running 3 emulators, the real `services/hg` stack and the restaurant web app. Cloud agents drive it **live** through `mobile-mcp --listen` over HTTPS (Caddy, Let's Encrypt, bearer token) on a halalgoes subdomain added to the environment allow-list. | This is the only option that gives cloud agents true live control (a screenshot, then a tap, then a screenshot) **and** truly simultaneous customer and rider devices. Every emulator reality feature is available. | GCP project with billing, a DNS record, and an allow-list entry for the lab domain. |

**Regression gate:** keep `e2e.yml` (batch mode). Agents save the flows they explored as Maestro YAML under `tools/e2e/native/`.

**Drop:**
- **Genymotion SaaS and the BrowserStack Local tunnel.** Both carry their data over WebSockets. The proxy README lists "WebSocket upgrades" as not supported, with the instruction "report, do not work around" (`/root/.ccr/README.md`).
- **ngrok, Tailscale, reverse SSH and cloudflared quick tunnels.** Ruled out for the same reason.
- **Codespaces port-forwarding.** `app.github.dev` is refused by the proxy.
- **Maestro Cloud.** `api.cloud.maestro.dev` is policy-blocked (CONNECT 502).

---

## 2. Ranked comparison of viable device-lab options

Prices are for 48 hours.

| # | Option | Interactivity for the agent | Reality simulation | Time to first run | 48 h cost | Self-hosted OSS? | Owner approval or credentials |
|---|---|---|---|---|---|---|---|
| 1 | **GCP n2-standard-16, nested KVM, mobile-mcp over HTTPS** ([nested virt](https://docs.cloud.google.com/compute/docs/instances/nested-virtualization/overview), [pricing](https://cloud.google.com/compute/vm-instance-pricing)) | **Live from the cloud agent**, about 0.5–2 s per action. MCP Streamable HTTP through the proxy was verified (`200`, `text/event-stream` intact). mobile-mcp 1.0.9's `--listen` mode was verified locally: 401 without the token, `tools/list` with it. | Full emulator console: GPS routes, network speed/delay, virtual camera, real FCM on Play images, 3 emulators at once | 45–90 min after credentials | About USD 37 (about USD 19 on n2-standard-8; spot is 60–70% cheaper but can be pre-empted), plus about USD 2 of disk | OSS stack on paid IaaS | **Yes:** billing, a DNS record, and the lab domain on the allow-list. The org policy `compute.disableNestedVirtualization` must not be set. |
| 2 | **AWS c8i.4xlarge with nested virtualization** (GA Feb 2026, [announcement](https://aws.amazon.com/about-aws/whats-new/2026/02/amazon-ec2-nested-virtualization-on-virtual)) | Same as #1 | Same as #1 | 45–90 min | About USD 36 | Same as #1 | **Yes:** an AWS account (watch vCPU quotas), DNS and the allow-list |
| 3 | **GitHub Actions device lab with Claude on the runner** (B) ([claude-code-action](https://github.com/anthropics/claude-code-action), [mobile-mcp](https://github.com/mobile-next/mobile-mcp)) | Live **on the runner** (local adb, about 0.3–1 s per screenshot). The cloud agent sees only mission in, report out. A job lasts at most 6 h. | Full emulator console. **One emulator** on a private 2-core/8 GB runner, so customer and rider take turns on the same AVD (both APKs installed), with the restaurant app in Chromium. | 3–5 h of build work | About USD 0.72 per 2 h session beyond the free quota, plus Claude subscription usage (not quantified) | Yes | Merge, or a PR-label trigger. The secret goes in its own environment. |
| 4 | **e2e.yml batch** (A) | Batch: about 14–20 min per loop as measured (about 7–9 min once trimmed) | Whatever Maestro and adb can script | Works today | About USD 0.10–0.16 per run beyond quota | Yes | No. Changes to inputs need merging to main. |
| 5 | **Remote Control on a KVM machine** (the owner's workstation, or the VM from #1) ([Remote Control](https://code.claude.com/docs/en/remote-control)) | Live, at native speed. The agent runs on that machine. Only outbound HTTPS is needed, so **no allow-list change**. | Full | 1–3 h | USD 0 on a workstation; the VM cost on #1 | Yes | The owner signs in on that machine and keeps it awake. Unverified: headless login, and whether a cloud session can receive replies from it. |
| 6 | **GitHub as the command relay** (the runner polls issue comments or a branch file, runs the commands, posts the results) | Pseudo-live, about 3–8 s per action (estimated, not measured) | Same as #3 | About half a day | Minutes only | Yes | Yes. It posts to the repo, and it needs a PAT or App token because the `GITHUB_TOKEN` limit is 1,000 requests per hour per repo ([limits](https://docs.github.com/en/actions/reference/actions-limits)). |
| 7 | **Expo web plus Playwright inside the container** | Fully live, here and now | Logic only: geolocation, offline mode, dark mode, permissions, file upload, clock control, several personas at once. **No** native push, background location, PaymentSheet or Mapbox native. | 2–4 h | USD 0 | Yes | No |
| 8 | **Hetzner Cloud CCX33 / CAX41 running redroid** (add-on) | Live over HTTPS, same as #1 | No emulator console, no camera, no FCM. GPS through the location test provider; network through `tc netem`. | 30–60 min | About EUR 2–5 | Yes | Yes: an account (KYC risk) and the allow-list |
| 9 | **BrowserStack App Automate (Appium hub only)** ([GPS](https://www.browserstack.com/docs/app-automate/appium/test-real-user-conditions/simulate-gps-location), [image injection](https://www.browserstack.com/docs/app-automate/appium/advanced-features/camera-image-injection)) | Live through WebDriver over HTTPS. Sessions idle out after about 90 s. | GPS, network profiles. Image injection needs Pro and an unobfuscated build. No raw adb. | 1–2 h | About USD 500 for a month, 2 parallels | No (paid SaaS) | Yes. **Devices cannot reach the container's API** without Local, whose WebSocket leg is suspect. |

**Not viable:**
- Anything in-container: TCG emulator, redroid, Waydroid, Cuttlefish, docker-android.
- Genymotion SaaS (WebSocket tunnel).
- Maestro Cloud (policy-blocked, batch only).
- Firebase Test Lab (batch, no Maestro).
- AWS Device Farm (5-min idle timeout, needs a public API).
- Bitrise and Codemagic (duplicate `e2e.yml`).
- Kobiton and HeadSpin (sales cycle).
- Larger GitHub runners (need the repo moved to an org).
- arm64 GitHub runners (KVM undocumented).
- Contabo production (no KVM; it is the launch box).

---

## 3. Agent driver stack

Every serious driver comes down to three things: adb `screencap`, a uiautomator hierarchy and `input`. The device is the hard part, not the driver. The recommended stack, in order:

1. **`maestro mcp`, from the repo's pinned Maestro 2.10.0** (SHA-256 verified). Use it wherever the agent is on the same host as adb: the runner (#3), the VM (#1) or Remote Control (#5).
   - Tools: `inspect_screen`, `run` (inline YAML such as `- tapOn: {id: "cart-checkout"}`) and `take_screenshot`.
   - Taps resolve by React Native `testID` (`id:`) and by text, with waits and retries built in.
   - It reuses the flows in `tools/e2e/native/{customer,rider}` as macros (sign in, go online).
   - Anything the agent explores can be saved straight back as a CI flow.
   - Native reality commands: `travel`, `setLocation`, `addMedia`, `setAirplaneMode`, and `launchApp` with `permissions` ([docs](https://docs.maestro.dev/getting-started/maestro-mcp)).
   - Set `MAESTRO_CLI_NO_ANALYTICS=1`.
2. **`@mobilenext/mobile-mcp@1.0.9`** ([repo](https://github.com/mobile-next/mobile-mcp)), for quick ad-hoc screenshots, element lists and taps, plus `set_location`, logcat and crash reports.
   - **It is the only driver with a remote HTTP mode** (`--listen`, `MOBILEMCP_AUTH` bearer), so it is the transport for cloud agents on option #1.
   - Set `MOBILEMCP_DISABLE_TELEMETRY=1`. Pin the version.
3. **Plain adb and the emulator console, through Bash** (on-host), or through a small allow-listed HTTPS "reality" endpoint (remote). This covers everything the MCPs lack: `emu geo fix`, `emu network speed/delay`, `cmd uimode night`, `settings put system font_scale`, `pm revoke`, `svc data/wifi`, `dumpsys deviceidle`.
4. **The Playwright MCP**, for the restaurant and admin web apps against the same API.

Optional, for remote use on #1: expose `maestro mcp` over HTTP with a stdio-to-Streamable-HTTP bridge (for example supergateway). This is unverified.

**Skip:**
- Appium plus appium-mcp, unless a paid WebDriver grid is chosen.
- droidrun/Mobilerun, Arbigent and Midscene: each runs a second LLM loop with its own keys and spend.
- Detox: needs native build changes and runs batch only.
- scrcpy: recording only.
- Community plugins (`adb-mcp`, Android Emulator QA): unreviewed code that needs user approval.

**React Native caveat:** `testID` shows up as resource-id on View, Text and Pressable, but is unreliable on Android `TextInput`. Key inputs by `accessibilityLabel` or placeholder, and confirm with the first `inspect_screen`.

---

## 4. Dev APK build path

**Primary: a standalone release-type APK** (JS bundled, debug-signed). This is the `e2e.yml` recipe, and it was built successfully in this container.

```bash
# SDK, about 30 s and 2.6 GB. Versions from RN 0.81.4: AGP 8.11.0, Gradle 8.14.3, Kotlin 2.1.20
cmdline-tools 13114758 -> sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" \
  "ndk;27.1.12297006" "cmake;3.22.1"
# REQUIRED: Maven Central returns 429 to the container's shared egress IP.
# ~/.gradle/init.d/central-mirror.gradle rewrites Central to
#   https://maven-central.storage-download.googleapis.com/maven2/
# (a copy is kept in scratchpad/lab-probe/apk-build/out/central-mirror.gradle)
eval "$(API_BASE_URL=http://10.0.2.2:8080 node scripts/release/app-env.cjs dev --print)"
pnpm exec expo prebuild --platform android --no-install
tools/e2e/android/allow-cleartext.sh android
./gradlew assembleRelease -PreactNativeArchitectures=x86_64 \
  -Pandroid.injected.signing.store.file=app/debug.keystore ...
```

**Measured in the container (4 vCPU):**
- Customer, cold build: 10 min 34 s, producing a 50 MB APK (`com.halalgoes.customer.dev`, bundle contains `10.0.2.2:8080`, `usesCleartextTraffic=true`).
- Rider, warm build: 3 min 03 s.
- Incremental rebuild: 54 s.

The JDK 21 that ships in the container worked; CI uses 17.

**Where to build:**
- **On #1:** on the VM itself (16 vCPU, next to the emulators). No upload step is needed.
- **On #3/#4:** the `e2e.yml` `apk` job, which caches by source hash.
- **Cloud container:** suitable for code iteration. Use a private build directory, because a sibling agent deleted a shared SDK directory mid-install.

**For fast UI iteration: a dev-client debug APK plus Metro** (`expo-dev-client` is already a plugin).
- Build with `assembleDebug` (2 min 53 s warm).
- Run `expo start --dev-client` on the device host, then `adb reverse tcp:8081 tcp:8081`, then open `exp+hg-customer://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081`.
- JS changes land in seconds.
- Do not use it for screenshots of record: LogBox and the dev menu pollute the tree.

**Gaps (missing secrets, not build problems):**
- No `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` means no live map, only ETA text ([#57](https://github.com/shaiknoorullah/hg-mono/issues/57)).
- No `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` means no PaymentSheet.
- No `EAS_PROJECT_ID` and FCM config means no push token.
- `eas.json`'s development profile points at `localhost:8080`, which an emulator cannot reach.
- Skip EAS Build. It is paid SaaS and redundant.
- Add `arm64-v8a` to the architectures only if real phones or a farm are used.

---

## 5. Reality-simulation recipe per capability

These assume an emulator on a KVM host (#1, #3 or #5). Package names are `com.halalgoes.{customer,rider}.dev`.

| Capability | Recipe | Notes from the repo |
|---|---|---|
| **GPS along a route** | Option 1: a GPX turned into a 1 Hz loop of `adb emu geo fix <LON> <LAT>` (**longitude first**). Option 2: Maestro `travel: {points: [...], speed: 12}` ([docs](https://docs.maestro.dev/api-reference/commands/travel)). For speed and bearing, use emulator gRPC `setGps` ([aemu-grpc](https://android.googlesource.com/platform/external/qemu/+/emu-master-dev/android/android-grpc/python/aemu-grpc)). | `apps/rider/src/location.ts` reports every 5 s on an assignment and every 20 s when idle. Dispatch only considers riders within 3 km with a fix under 90 s old, so stall GPS for more than 90 s as a test of its own. Run `travel` in the background, because it blocks the flow. |
| **Network loss and throttling** | `adb emu network speed gsm|edge|umts|full`; `adb emu network delay gprs|umts|none`; `svc wifi disable && svc data disable`; `cmd connectivity airplane-mode enable`; Maestro `toggleAirplaneMode`. Server-side faults: [toxiproxy](https://github.com/Shopify/toxiproxy) 2.x in front of hg (latency, timeout, `reset_peer`) and on `/v1/ws`. | Tests the realtime reconnect path. The repo has no toxiproxy today. |
| **Push** | Tier C (now): deep links `am start -a android.intent.action.VIEW -d 'hgrider://…'` follow the same path as a notification tap; assert on the backend's fake sender. Tier B: POST to `exp.host/--/api/v2/push/send` with the token the app registered (exp.host is reachable). Tier A (real FCM): `eas init`, FCM v1 credentials, `HG_PUSH_ENABLED=true` and `EXPO_ACCESS_TOKEN` on the dev API, then rebuild. | `services/hg/internal/notify` has an Expo PushSender and fake senders. `push.ts` needs `extra.eas.projectId`, or it silently registers nothing. Tier A works on `google_apis` images ([Expo FCM](https://docs.expo.dev/push-notifications/fcm-credentials/)). |
| **Camera and proof-of-delivery photo** | Change `-camera-back none` to `-camera-back virtualscene` (or `emulated`). For a chosen photo: Maestro `addMedia: [./fixtures/pod.jpg]` ([docs](https://docs.maestro.dev/api-reference/commands/addmedia)), or `adb push` to `/sdcard/Pictures`, then take the library path. | `apps/rider/src/capture.ts` calls `launchCameraAsync` with a library fallback. The camera path is **untested today** because CI disables the camera. |
| **Multiple devices** | #1: AVDs on ports 5554, 5556 and 5558 (customer, rider, second rider), with Maestro `--device emulator-5556`, all reaching the API at `10.0.2.2:8080`, plus Playwright for the restaurant web app. #3: one AVD with both APKs, switching apps in turn, plus Chromium. | The private 2-core/8 GB runner fits one emulator. The 4-core/16 GB standard runner is for public repos only. |
| **Dark mode, font scale, accessibility** | `cmd uimode night yes`; `settings put system font_scale 1.3` (also 2.0); `wm density`. TalkBack is not in `google_apis`: install its APK and enable it with `settings put secure enabled_accessibility_services …`, or assert content-desc through the hierarchy. | The theme follows `useColorScheme`. Prebuild warns that `userInterfaceStyle` needs `expo-system-ui`. Check every halal state in dark mode (invariants 8–10). |
| **Permissions denied** | Maestro `launchApp: {permissions: {location: deny, camera: deny, notifications: deny}}`; `pm revoke … ACCESS_FINE_LOCATION`; `appops set … COARSE_LOCATION allow` for approximate-only. | The rider declares `ACCESS_BACKGROUND_LOCATION`. |
| **Background, foreground, process death** | `input keyevent KEYCODE_HOME`, `am kill`, `am force-stop`, `dumpsys battery unplug && dumpsys deviceidle force-idle`, then `am start`. | Checks that 5 s location reporting survives in the background. |
| **Time and deadlines** | Shift `deadline_at` in the devworld DB (that is where the ticker runs). Device clock: `adb root; settings put global auto_time 0; date …`. | Invariant 4. |
| **Payments** | Stripe test cards: 4242… (approved), 4000 0000 0000 9995 (insufficient funds), 4000 0027 6000 3184 (3DS) ([Stripe testing](https://docs.stripe.com/testing)). | Needs test-mode keys in the APK and the API. |

---

## 6. Setup steps for the recommended option

### Primary track: GitHub Actions device lab (#3)

**What agents can do** (after the orchestrator lifts read-only mode):
1. Write `.github/workflows/device-lab.yml`:
   - Trigger: `workflow_dispatch` with a `mission` input, plus a `pull_request` label trigger so it can run before merge.
   - Copy these steps from the `flows` job in `e2e.yml`: KVM udev rule, `tools/e2e/stack/up.sh`, seed, APK cache and download, and `reactivecircus/android-emulator-runner@v2.38.0` (API 34, google_apis, `-camera-back virtualscene`).
   - Inside the runner's `script:` (the emulator dies when the script exits), install both APKs, then run `npm i -g @anthropic-ai/claude-code@<pin>` and `claude -p "$MISSION" --mcp-config mcp.json --allowedTools …`.
   - Set `timeout-minutes` to 120–300. The mission comes in through `env:`, following the repo's trust rules.
2. Write `mcp.json` with:
   - `maestro` (`<path>/maestro/bin/maestro mcp --no-viewer`);
   - `mobile` (`npx -y @mobilenext/mobile-mcp@1.0.9`, telemetry off);
   - `playwright`.
3. Add a `tools/e2e/reality/` helper set: `geo-route.sh route.gpx`, `net.sh slow-3g|offline|restore`, `look.sh dark|font 1.3`.
4. Have the runner agent upload `report.md`, screenshots and logcat as artifacts. The cloud agent reads them through `mcp__github__actions_get` and `get_job_logs`.
5. Give each parallel mission its own branch, because `concurrency` cancels an in-flight run on the same ref.
6. Optionally add `flow_glob` and a native-only input to `e2e.yml`, to bring the batch loop down to about 7–9 min.

**What the user/owner must do:**
1. Create a GitHub environment `device-lab`, move or copy `CLAUDE_CODE_OAUTH_TOKEN` into it, and restrict it to `main` and the label trigger, never forks. This keeps `e2e.yml`'s "no job reads a secret" rule intact.
2. Review and merge the workflow, or approve label runs.
3. Accept the Actions minutes (the nightly already uses about 1,000–1,800 of the 2,000–3,000 a month) and the Claude usage.

### Upgrade track: GCP KVM lab VM (#1)

**What the user/owner must do** (about 30–60 min):
1. Create a GCP project with billing and approve about USD 40–60. Provide a service-account key with `roles/compute.instanceAdmin.v1`, or run step 2 themselves.
2. Create a DNS A record, `lab.<halalgoes-domain>`, pointing at the VM's static IP.
3. In the environment settings (Edit, Network access, Custom), add that hostname to the allow-list. Today `staging-api.halalgoes.com` is refused, so the domain must be added explicitly.
4. Log the paid test infrastructure in `docs/decisions/`. It is not production, but the project prefers self-hosted.

**What agents can do** (`gcloud` is already installed and proxied in the container):

```bash
gcloud compute instances create hg-device-lab --zone=us-east4-a \
  --machine-type=n2-standard-16 --enable-nested-virtualization \
  --min-cpu-platform="Intel Cascade Lake" --image-family=ubuntu-2404-lts-amd64 \
  --image-project=ubuntu-os-cloud --boot-disk-size=150GB
# On the VM (setup script):
#   ls /dev/kvm must exist
#   openjdk-17, cmdline-tools, sdkmanager emulator, platform-tools,
#     "system-images;android-34;google_apis_playstore;x86_64", plus the build components from section 4
#   avdmanager: create 3 x pixel_6
#   emulator -avd cust -port 5554 -no-window -gpu swiftshader_indirect -camera-back virtualscene &   (also 5556, 5558)
#   docker + git clone; cd services/hg && make up && make migrate && make dev-reset; make dev-admin
#   build both APKs (section 4); adb -s <each> install
#   MOBILEMCP_AUTH=$TOKEN MOBILEMCP_DISABLE_TELEMETRY=1 npx -y @mobilenext/mobile-mcp@1.0.9 --listen 127.0.0.1:3000
#   a small "reality" HTTP service on 127.0.0.1:3001 that runs only allow-listed adb/emu commands
#   Caddy: lab.<domain> { reverse_proxy /mcp* 127.0.0.1:3000; reverse_proxy /reality* 127.0.0.1:3001 } with automatic TLS
#   firewall: allow only 443
# In each cloud agent:
claude mcp add --transport http mobile https://lab.<domain>/mcp --header "Authorization: Bearer $TOKEN"
```

Other points for #1:
- **Delete the VM when the sprint ends.** Billing is per second.
- **The token is the only lock on a public device-control endpoint.** Rotate it per day, never log it, and use throwaway seeded data only.
- **Alternative with no allow-list change:** run `claude remote-control --spawn worktree` on the VM inside tmux. Agents then work on the VM with local adb and Maestro, and the orchestrator hands work over with SendMessage. Unverified: headless login on the VM, and whether replies flow back to a cloud session.

---

## 7. Risks and open questions

**Unverified:**
1. Whether the owner can add the lab hostname to the allow-list, and whether the proxy then passes a long MCP session to it. Streamable HTTP through the proxy was proven against `mcp.context7.com` only.
2. Whether `compute.disableNestedVirtualization` is set in the owner's GCP org.
3. How much Claude usage on the runner (#3) draws from the OAuth subscription's limits, and how it is throttled. Not estimated.
4. Whether a 2-core/8 GB private runner can hold the stack, one emulator, the Maestro JVM and node for MCP without ANRs. `hide_error_dialogs` in `e2e.yml` suggests it is already tight.
5. Mapbox GL under swiftshader with no GPU and no token: possibly blank or slow ([#57](https://github.com/shaiknoorullah/hg-mono/issues/57)). This is the biggest native-rendering risk.
6. Whether `testID` surfaces on Android `TextInput`.
7. Remote Control: headless VM login, and the cross-session reply direction. The ListAgents docs say cloud sessions cannot message back yet.
8. Real FCM push needs EAS and Firebase accounts set up ([#59](https://github.com/shaiknoorullah/hg-mono/issues/59)). Until then only tiers B and C are possible.

**Contradictions between the lenses, resolved:**
- **Docker daemon:** not running at session start, but `dockerd` started as root works (hello-world ran).
- **Maestro download:** one 403 from GitHub releases against several successful, SHA-checked downloads. Download it on the runner or VM, pinned by SHA.
- **Runner size:** private repos get 2-core/8 GB, so one emulator per standard runner.
- **"Outbound WebSocket works":** contradicted by the proxy README and by the `ws_closed_mid_exchange` log entries. Treat WebSockets as unavailable.

**Security note:** the critic pass was flagged by the harness as a possible **containment escape** (tunnel and WebSocket probes). Do not run further tunnel or WebSocket probes from cloud sessions without the owner's explicit approval. The recommended designs need none: both use plain HTTPS request/response, or GitHub.

**Operational risks:**
- The `e2e.yml` concurrency group cancels parallel runs on the same ref.
- 6 h job cap.
- A public lab endpoint needs a bearer token and only allow-listed adb commands; never expose arbitrary shell.
- Delete the GCP VM after Monday.
- Never touch Contabo production.

**Files:**
- APKs already built: `/tmp/claude-0/-home-user-hg-mono/af54094b-b508-58c9-b4bd-baf9e6b6469b/scratchpad/lab-probe/apk-build/out/` (`customer-release-x86_64.apk`, `rider-release-x86_64.apk`, `customer-devclient-debug-x86_64.apk`).
- Maven mirror script: `central-mirror.gradle`, in the same folder.