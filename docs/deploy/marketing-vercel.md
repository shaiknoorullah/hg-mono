# Deploying `apps/marketing` (halalgoes.com) to Vercel

The runbook of record for the marketing site. Follow it top to bottom for a
first deploy; the section headings are the order the work has to happen in.

`vercel.json` and `next.config.ts` already carry the parts that belong in the
repo. What is left is project settings, environment variables and one open
decision — and that is what this file is.

> Supersedes `apps/marketing/DEPLOY.md`, which is the earlier draft of the same
> procedure and is missing `KEYSTATIC_SECRET`. Delete it once this has been
> through a real deploy; two runbooks is how one of them goes stale.

**Source of truth for the variables:** `apps/marketing/.env.example`. Every
variable named below is read by code in this repo or by a dependency, and each
one cites the file that reads it. If you find a variable in a dashboard that is
not in this document, it is doing nothing.

---

## 1. Environment variables

### 1.1 The whole set

| Variable | Read by | Environment | Missing ⇒ |
|---|---|---|---|
| `WAITLIST_WEBHOOK_URL` | `src/lib/waitlist-store.ts:38` | Production + Preview | **Signups are lost.** Saving throws, the form shows its error state. §3 |
| `NEXT_PUBLIC_SITE_URL` | `src/lib/site.ts:12` | **Production only** | Preview: correct (self-referential canonicals). Production: canonicals and sitemap fall back to `https://halalgoes.com`, which is right — but see §6 |
| `NEXT_PUBLIC_LAUNCH_AT` | `src/lib/launch.ts:25` | optional, any | No countdown. The chip reads "Ontario · launching soon" |
| `NEXT_PUBLIC_UMAMI_SRC` | `src/components/Analytics.tsx:17` | Production only | No analytics tag at all |
| `NEXT_PUBLIC_UMAMI_WEBSITE_ID` | `src/components/Analytics.tsx:18` | Production only | No analytics tag at all |
| `KEYSTATIC_GITHUB_CLIENT_ID` | `keystatic.config.ts:17`, `src/app/keystatic/layout.tsx:15`, `@keystatic/core` | Production only | `/keystatic` 404s in production |
| `KEYSTATIC_GITHUB_CLIENT_SECRET` | same | Production only | `/keystatic` 404s in production |
| `KEYSTATIC_SECRET` | `@keystatic/core` | Production only | **Editor loads but every API call 500s.** Not covered by the 404 guard. §4.3 |
| `NEXT_PUBLIC_KEYSTATIC_GITHUB_APP_SLUG` | `@keystatic/next` (browser bundle) | Production only | Editor's setup links point nowhere |

Vercel supplies `VERCEL_ENV`, `VERCEL_URL` and `VERCEL_GIT_PREVIOUS_SHA`
itself — **do not create them by hand.** `src/lib/site.ts` and `vercel.json`
both depend on them; §6 covers the one checkbox that makes them exist.

### 1.2 `NEXT_PUBLIC_*` is read at BUILD time

It is inlined into the output, not read at runtime. **Setting a value is not
enough — it needs a redeploy.** Changing the Umami website ID and wondering why
nothing changed is the single most common way to lose an hour here.

The non-public ones (`WAITLIST_WEBHOOK_URL`, the two Keystatic secrets) are read
at request time and do take effect on the next request after a redeploy.

### 1.3 Why the Environment column is not decoration

**`NEXT_PUBLIC_SITE_URL` must NOT be set on Preview.** Unset, a preview build
uses Vercel's own deployment host, and `robots.ts` disallows the entire origin.
Set it to the production URL on Preview and every preview page emits a canonical
pointing at production, publishes a `robots.txt` that invites crawling, and
competes with the real site for the brand term.

`isProductionSite()` (`src/lib/site.ts:47`) requires three signals to agree —
`VERCEL_ENV`, `NODE_ENV` and the resolved origin — precisely so "forgot to set
it" cannot read as production. Read §6 before you trust that.

Same reasoning for Umami: a preview reporting into production's numbers means
your first month of data is your own deploys.

---

## 2. Create the project

**New Project → import `shaiknoorullah/hg-mono`.**

| Setting | Value |
|---|---|
| Root Directory | `apps/marketing` |
| Framework Preset | Next.js *(auto-detected)* |
| Node.js Version | 22.x *(`.nvmrc` says `v22.22.2`; root `engines` allows ≥20)* |
| Install Command | leave blank — `vercel.json` sets it |
| Build Command / Output | leave blank — the preset is right |
| Include source files outside of the Root Directory | **ON** |

**Hobby is non-commercial** under Vercel's terms. This is a commercial product,
so it needs Pro.

### 2.1 Root Directory is load-bearing, not cosmetic

Three things break if it is anything other than `apps/marketing`:

- `src/lib/posts.ts:12` derives the Keystatic reader root by stripping
  `/apps/marketing` off `process.cwd()`. A different Root Directory silently
  gives the reader the wrong root and the blog reads zero posts.
- `vercel.json`'s `ignoreCommand` uses paths relative to the Root Directory
  (`.`, `../../packages/ui-web`). Vercel runs that command *in the Root
  Directory*, not the repo root.
- `next.config.ts` pins `outputFileTracingRoot` to the repo root for exactly
  this layout, so that `content/posts/*` is traced into the deployed output
  rather than missing at runtime.

### 2.2 "Include source files outside of the Root Directory" must stay ON

The build genuinely needs files above `apps/marketing`: `@hg/ui-web`'s
stylesheets, `pnpm-lock.yaml` at the repo root, and `pnpm-workspace.yaml`
without which the scoped install in §2.3 cannot resolve the workspace at all.

### 2.3 What `installCommand` implies

```
pnpm install --frozen-lockfile --filter '@hg/marketing...'
```

- **The install is scoped.** The trailing `...` means "and its dependencies", so
  this selects 3 of the 14 workspace projects: `@hg/marketing`, `@hg/ui-web`,
  and `@hg/api-client` (a dependency of `ui-web`). The Expo and React Native
  tree, which nothing on this site imports, is never fetched.
- **`--frozen-lockfile` means a stale lockfile fails the build**, loudly, rather
  than resolving something different from what was tested. If a build dies at
  install with `ERR_PNPM_OUTDATED_LOCKFILE`, someone changed a `package.json`
  without committing the lockfile. Fix it in the repo, not by relaxing the flag.
- **pnpm must be the package manager Vercel uses.** It is inferred from the root
  `packageManager: "pnpm@10.33.0"` and `pnpm-lock.yaml`, both of which are only
  visible because of §2.2. This is the concrete reason that checkbox matters.

### 2.4 What `ignoreCommand` implies

```sh
base=${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}
git cat-file -e "$base^{commit}" 2>/dev/null || base=HEAD^
git diff --quiet "$base" HEAD -- . ../../packages/ui-web ../../pnpm-lock.yaml
```

Most commits in this repo are backend, contract or spec work that cannot change
this site's output. This skips those builds.

**Exit 0 skips the build; any non-zero builds.** `git diff --quiet` exits 0 when
nothing matched and 1 when something did, which lands the right way round. If
git fails for any reason the command errors, which Vercel reads as "build" — the
safe direction, and deliberate.

**Why `VERCEL_GIT_PREVIOUS_SHA` and not just `HEAD^`.** `HEAD^ HEAD` inspects
only the tip commit, so a push whose *last* commit is unrelated hides every
marketing change earlier in the same push. That is not hypothetical — it already
happened in this repo's history: `cf2316a` (`fix(marketing): vendor three.js`)
is the parent of `781452d` (`docs(decisions): …`), and diffing `781452d^..781452d`
reports nothing deployable. The marketing fix would never have shipped.

`VERCEL_GIT_PREVIOUS_SHA` is the SHA of the last *successful* deployment for the
project and branch, so it spans whole pushes — and because a skipped build is
cancelled rather than successful, it keeps accumulating across skips until
something really does need building. Vercel exposes it **only when an ignore
command is configured**, which is why it can be relied on here and nowhere else.
It is empty on a branch's first deployment and can fall outside Vercel's shallow
clone, so the `cat-file` probe falls back to `HEAD^`, and a failure there builds.

Two consequences worth knowing rather than discovering:

- **`apps/marketing/experiments/` is inside the watched path.** Prototype
  commits trigger production rebuilds. Harmless, just noisy.
- **`packages/api-client` is not watched.** Correct today: this app imports only
  `@hg/ui-web`'s two stylesheets, so an api-client change cannot alter the
  output. Revisit if this app ever imports a `ui-web` component that uses it.

---

## 3. `WAITLIST_WEBHOOK_URL` — the blocker

**This is the one variable whose unset state is not safe.** Everything else in
this repo degrades to silence on purpose. This one loses signups.

### 3.1 What actually happens without it

`saveSignup()` throws `WaitlistNotConfigured` before it makes any request. The
server action catches it, logs

```
[waitlist] refusing to report success: no store is configured. Set WAITLIST_WEBHOOK_URL.
```

and returns `{ status: 'error' }`, so the visitor sees *"We couldn't save that
just now. Please try again in a moment."*

That is the correct behaviour and not a bug to route around: a form that reports
success while discarding the signup is the one outcome the module exists to
prevent. But **the page looks completely healthy from the outside.** Nothing on
the deployed site tells you it is happening. Set this before you send anyone to
the site, or you will run a launch campaign into a black hole.

### 3.2 The contract a receiver has to honour

One `POST` per signup, `content-type: application/json`, `cache: no-store`.

- **Answer 2xx.** Any other status throws `Waitlist webhook returned <status>`
  and the visitor sees the error state.
- **There is no retry.** Deliberate: a duplicate signup is worse than a
  retryable message, because the visitor can press the button again and we
  cannot un-send an email. If your receiver can be slow, make it accept fast and
  queue internally.
- **It is an unauthenticated public endpoint** as far as the code is concerned —
  there is no signing header. Whatever you point it at will be discoverable and
  must tolerate junk. Put the secret in the URL path if the provider supports
  it, and rate-limit at the edge.

Body — the `Signup` type in `src/lib/waitlist-store.ts:20`:

```json
{
  "audience": "customer",
  "contact": "someone@example.com",
  "kind": "email",
  "consentText": "I agree to receive one launch email from Halal Goes, and news of newly verified kitchens near me afterwards. Unsubscribe any time.",
  "consentedAt": "2026-09-21T14:03:11.427Z",
  "context": "hero",
  "utm": { "utm_source": "instagram", "utm_campaign": "launch" }
}
```

- `audience` — `customer` | `restaurant` | `rider`.
- `contact` — normalised; lower-cased for email.
- `kind` — `email` on every track while **O-03** is open (below). The server
  action refuses a track that drifts from `WAITLIST_CHANNEL`.
- `context` — which form on which page: `hero` | `final` | `footer` | `sticky`.
- `utm` — session-scoped, `{}` for a direct visit. Client-supplied, so it is
  bounded and sanitised server-side and is not trusted.

**The receiver must store `audience`, `consentText` and `consentedAt`, not just
the address.** CASL wants the wording: "they consented" is not a defence,
"they consented to this sentence, on this date, from this part of the page" is.
A receiver that keeps only the email throws away the reason those fields ship.

### 3.3 What to point it at

Ranked by how quickly it can be live, which is the constraint right now.

1. **A form/automation endpoint** — Formspark, Basin, a Zapier or Make catch
   hook. Minutes to set up, gives a dashboard and CSV export, needs no code.
   Verify it stores the full JSON body and not just recognised fields: several
   of these drop unknown keys, which would silently discard `consentText` and
   defeat §3.2. **Check this before launch, not after.**
2. **An email platform's API** — whatever will actually send the launch email
   (Resend, Buttondown, Mailchimp). Usually needs a small proxy, because most
   want an `Authorization` header and this code sends none. A Vercel Function in
   this same project is the obvious home for that proxy.
3. **The `hg` binary** — the long-term answer, once a waitlist endpoint exists.
   It already owns Postgres and is the only durable store in the architecture.
   It does not have one yet; do not block launch on it.

Whichever you pick, **test it against a preview deploy before production** and
confirm a row lands with the consent fields intact. Set the variable on Preview
too — pointed at a separate test destination, so preview traffic does not
pollute the real list.

---

## 4. The CMS in production (Keystatic)

### 4.1 Why `/keystatic` 404s until you configure it

`src/app/keystatic/layout.tsx:17` calls `notFound()` when `NODE_ENV` is
production and GitHub mode is not configured. That is a guard, not a bug.

With no GitHub credentials, `keystatic.config.ts` falls back to
`{ kind: 'local' }` — the editor writes to the working tree and **has no login
at all.** That is exactly right on a developer's machine and exactly wrong on a
public origin. On Vercel's read-only filesystem it would fail rather than leak,
but "fails by accident" is not a security posture, so the route refuses to exist
until signing in is possible. `metadata.robots` sets `noindex` alongside the
`Disallow` in `robots.ts`: robots.txt is a request, a noindex header is an
instruction.

### 4.2 Turning the editor on

1. Create a GitHub App at <https://github.com/settings/apps>.
2. Callback URL: `https://halalgoes.com/api/keystatic/github/oauth/callback`.
3. Install it on `shaiknoorullah/hg-mono` with **read/write access to repository
   contents**.
4. Set all four variables (§4.3), Production only.
5. Redeploy — three of the four are build-time.

Shortcut: run `pnpm --filter @hg/marketing dev`, open `/keystatic/setup`, and
let Keystatic create the App for you. It writes all four values into a local
`.env`; copy them into Vercel. Set the callback URL to production afterwards.

Editors then sign in with GitHub and their posts land as real commits by them.
A publish is a commit, so it triggers a build — which is what you want, and also
why `ignoreCommand` watches `apps/marketing`, where `content/posts/` lives.

Until then, write posts locally: `pnpm --filter @hg/marketing dev` →
`/keystatic`. (`content/posts/` is currently empty, so `/blog` renders its empty
state. That is designed, not broken.)

### 4.3 All four variables, or none

```
KEYSTATIC_GITHUB_CLIENT_ID
KEYSTATIC_GITHUB_CLIENT_SECRET
KEYSTATIC_SECRET                        ← at least 32 characters
NEXT_PUBLIC_KEYSTATIC_GITHUB_APP_SLUG
```

**The trap:** the 404 guard checks only `CLIENT_ID` and `CLIENT_SECRET`, but
`@keystatic/core` requires `KEYSTATIC_SECRET` as well. Set the first two and
forget the third and you get a *reachable* editor whose API route throws on
construction:

```
Missing required config in Keystatic API setup when using the 'github' storage mode:
- secret (can be provided via KEYSTATIC_SECRET env var)
```

— so `/keystatic` renders and every save and sign-in 500s. Strictly worse than
the 404. `KEYSTATIC_SECRET` encrypts the session cookie holding the editor's
GitHub token; under 32 characters Keystatic throws *"KEYSTATIC_SECRET must be at
least 32 characters long"* at request time. Generate with `openssl rand -hex 40`.
Rotating it signs every editor out, which is also how you revoke a leaked
session.

---

## 5. Domains

Add **`halalgoes.com`** and **`www.halalgoes.com`**, and let Vercel redirect
`www` → apex (it offers this; take it). The apex is what `NEXT_PUBLIC_SITE_URL`,
every canonical and the sitemap already say, and two origins serving the same
content is a duplicate-content problem you have to fix later.

`analytics.halalgoes.com` is a **separate A record pointing at the Contabo VPS**
— do not add it to Vercel. Same apex is the whole point: it makes the tracker
first-party. See `deploy/umami/`.

---

## 6. The checkbox the indexing guard depends on

**Settings → Environment Variables → "Enable access to System Environment
Variables" must be ON.** It is the default. Leave it alone; this section is so
that nobody turns it off later without understanding what it costs.

`isProductionSite()` returns true only when all three agree:

```ts
if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') return false;
if (process.env.NODE_ENV !== 'production') return false;
return SITE.origin === CANONICAL_ORIGIN;
```

Turn system variables off and `VERCEL_ENV` and `VERCEL_URL` both disappear. On a
preview build that means: the first check no longer fires (`VERCEL_ENV` is
undefined), `NODE_ENV` is `production` on any Vercel build, and `resolveOrigin()`
— finding neither `NEXT_PUBLIC_SITE_URL` nor `VERCEL_URL` — falls back to the
canonical origin. All three agree, `isProductionSite()` returns **true**, and the
preview publishes `Allow: /` with a sitemap and canonicals pointing at
production.

Vercel's own `x-robots-tag: noindex` on preview deployments still covers you in
practice, but the preview's `robots.txt` and canonicals would be lying, and the
guard that exists to prevent exactly this would be inert. One checkbox.

---

## 7. Pre-launch checklist

Work down it. The first five are the ones that are expensive to discover late.

- [ ] **`NEXT_PUBLIC_SITE_URL=https://halalgoes.com` is set on Production, and
      NOT on Preview** — before anything is indexed. It is build-time, so
      confirm it after a redeploy, not after saving it.
- [ ] **"Enable access to System Environment Variables" is ON** (§6).
- [ ] **`WAITLIST_WEBHOOK_URL` is set and a real signup lands**, with
      `audience`, `consentText` and `consentedAt` intact at the destination
      (§3.2). Do this on a preview deploy first.
- [ ] Root Directory is `apps/marketing`; "Include source files outside the Root
      Directory" is ON (§2.1, §2.2).
- [ ] Both `halalgoes.com` and `www.` resolve, `www` → apex (§5).
- [ ] Keystatic: either all four variables set and an editor has signed in and
      published once, or none set and `/keystatic` 404s (§4.3).
- [ ] Umami: both variables set on Production only; no request to
      `analytics.halalgoes.com` before consent, and a hit after accepting.
- [ ] `NEXT_PUBLIC_LAUNCH_AT` — set to a real RFC 3339 date, or deliberately
      left unset. There is no wrong-countdown failure mode, only a no-countdown
      one, so unset is a legitimate choice.

Then verify the deploy:

```bash
curl -s  https://halalgoes.com/robots.txt          # Allow: /, and the sitemap line
curl -sI https://halalgoes.com | grep -i x-frame   # DENY
curl -s  https://halalgoes.com/sitemap.xml | head  # absolute https://halalgoes.com URLs
curl -sI https://halalgoes.com/keystatic           # 404 until §4
curl -so /dev/null -w '%{http_code} %{content_type}\n' https://halalgoes.com/opengraph-image
```

And on a **preview** deployment — the one that actually catches mistakes:

```bash
curl -s https://<preview-host>/robots.txt          # MUST be "Disallow: /"
```

Then in a private window on production: check the canonical is the page's own
URL and not the homepage, confirm no request to `analytics.halalgoes.com` before
you touch the consent banner, then accept and confirm the hit lands in Umami.
Submit the waitlist form and confirm the row arrives.

---

## 8. Open decisions that touch this deploy

- **O-01 — HST registration number and supplier position.** Open, owned by the
  client's accountant. It does not block the deploy: the marketing site makes no
  tax claim, and `src/lib/claims.ts` lists tax claims as REJECTED precisely
  because of this. Do not let anyone add pricing copy implying a tax treatment
  before it closes.
- **O-03 — SMS / A2P sender registration.** Open. This is why the waitlist
  collects **email on every track** (`WAITLIST_CHANNEL` in `src/lib/claims.ts`)
  and why the server action refuses a track that drifts from it. Do not
  reintroduce a phone field, or copy promising a text, until it closes.
- **`WAITLIST_WEBHOOK_URL`'s destination is itself undecided** (§3.3). Pick one
  and record it — this is the only genuine blocker between here and a site that
  can take a signup.

O-04, O-05 and O-06 were settled at rc1 and do not affect this deploy. See
`docs/decisions/README.md`.

---

## 9. What Vercel does not do

Vercel runs `next build` and nothing else. It does **not** run `pnpm check` —
contract validation, fixture validation, token drift, L-4 or workspace-wide
typecheck. A commit that breaks token drift or the contract deploys happily.
That belongs in CI on the repo, not here, and does not exist yet.

The one that will bite first: `pnpm generate:tokens:check`. Edit
`docs/design/tokens.json` without regenerating and the site still deploys,
carrying stale CSS, silently.
