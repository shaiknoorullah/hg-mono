# Deploying halalgoes.com to Vercel

`vercel.json` and `next.config.ts` already carry the parts that belong in the
repo. What is left is the project settings and the environment variables, which
is what this file is.

---

## 1. Create the project

**New Project → import `shaiknoorullah/hg-mono`.**

| Setting | Value |
|---|---|
| Root Directory | `apps/marketing` |
| Framework Preset | Next.js *(auto-detected)* |
| Node.js Version | 22.x |
| Install Command | leave blank — `vercel.json` sets it |
| Build / Output | leave blank — the preset is right |

**Leave "Include source files outside of the Root Directory" ON.** It is the
default once Vercel sees the workspace, and the build genuinely needs files
above `apps/marketing`: `@hg/ui-web`'s stylesheets, `pnpm-lock.yaml`, and the
content directory the blog reader resolves from the repo root.

Two things `vercel.json` does that are worth knowing about rather than
discovering:

- **The install is scoped**: `pnpm install --filter '@hg/marketing...'` selects
  3 of the 14 workspace projects — this app, `@hg/ui-web`, `@hg/api-client`. The
  entire Expo and React Native tree, which nothing on this site imports, is
  never fetched.
- **Unrelated commits do not rebuild.** `ignoreCommand` compares the last commit
  against `apps/marketing`, `packages/ui-web` and the lockfile. A backend or
  spec commit is skipped. If git fails for any reason the command errors, which
  Vercel reads as "build" — the safe direction.

**Hobby is non-commercial** under Vercel's terms. This is a commercial product,
so it needs Pro.

---

## 2. Environment variables

Set these under **Settings → Environment Variables**. The **Environment** column
is not decoration — two of these are actively wrong if set everywhere.

| Variable | Environment | Value |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | **Production only** | `https://halalgoes.com` |
| `NEXT_PUBLIC_UMAMI_SRC` | Production only | `https://analytics.halalgoes.com/hg.js` |
| `NEXT_PUBLIC_UMAMI_WEBSITE_ID` | Production only | the UUID from Umami |
| `WAITLIST_WEBHOOK_URL` | Production, Preview | wherever signups are POSTed |
| `NEXT_PUBLIC_LAUNCH_AT` | optional | RFC 3339, e.g. `2026-11-03T12:00:00-05:00` |

### Why "Production only" matters

**`NEXT_PUBLIC_SITE_URL` must NOT be set on Preview.** Unset, a preview build
uses Vercel's own deployment host, and `robots.ts` then disallows the entire
origin. Set it to the production URL on Preview and every preview page emits a
canonical pointing at production, publishes a `robots.txt` that invites
crawling, and competes with the real site for the brand term. `isProductionSite()`
requires three signals to agree — `VERCEL_ENV`, `NODE_ENV` and the resolved
origin — precisely so "forgot to set it" cannot read as production.

The same for Umami: a preview reporting into production's numbers means your
first month of data is your own deploys.

### `NEXT_PUBLIC_*` is read at BUILD time

It is inlined into the output, not read at runtime. **Setting a value is not
enough — it needs a redeploy.** Changing the Umami website ID and wondering why
nothing changed is the single most common way to lose an hour here.

### What happens before you set them

Nothing breaks, on purpose:

- No Umami variables → `Analytics.tsx` renders nothing at all, rather than a
  script tag pointing at `undefined`.
- No `WAITLIST_WEBHOOK_URL` → the form shows its error state and the server logs
  a refusal. It never reports a success it did not have. **Set this before you
  send anyone to the site**, or you will collect zero signups and the page will
  look fine.

---

## 3. Domains

Add **`halalgoes.com`** and **`www.halalgoes.com`**, and let Vercel redirect
`www` → apex (it offers this; take it). The apex is what `NEXT_PUBLIC_SITE_URL`,
every canonical and the sitemap already say, and two origins serving the same
content is a duplicate-content problem you have to fix later.

`analytics.halalgoes.com` is a **separate A record pointing at the Contabo VPS**
— do not add it to Vercel. Same apex is the whole point: it makes the tracker
first-party. See `deploy/umami/README.md`.

---

## 4. The CMS in production

`/keystatic` **404s in production until GitHub mode is configured.** That is the
guard in `src/app/keystatic/layout.tsx`, not a bug: local storage mode writes to
the working tree and has no login, which is right on a laptop and wrong on a
public origin.

To turn the editor on:

1. Create a GitHub App at <https://github.com/settings/apps>.
2. Callback URL: `https://halalgoes.com/api/keystatic/github/oauth/callback`.
3. Install it on `shaiknoorullah/hg-mono` with read/write access to contents.
4. Set, Production only:
   - `KEYSTATIC_GITHUB_CLIENT_ID`
   - `KEYSTATIC_GITHUB_CLIENT_SECRET`
   - `NEXT_PUBLIC_KEYSTATIC_GITHUB_APP_SLUG`
5. Redeploy.

Editors then sign in with GitHub and their posts land as real commits by them. A
publish is a commit, so it triggers a build — which is exactly what you want,
and also why `ignoreCommand` includes `apps/marketing` (where the content lives).

Until then, write posts locally: `pnpm --filter @hg/marketing dev` → `/keystatic`.

---

## 5. Verify the first deploy

```bash
curl -s https://halalgoes.com/robots.txt          # Allow: /, and the sitemap line
curl -sI https://halalgoes.com | grep -i x-frame  # DENY
curl -s https://halalgoes.com/sitemap.xml | head  # absolute https://halalgoes.com URLs
curl -sI https://halalgoes.com/keystatic          # 404 until §4
curl -so /dev/null -w '%{http_code} %{content_type}\n' https://halalgoes.com/opengraph-image
```

Then, on a **preview** deployment, the one that actually catches mistakes:

```bash
curl -s https://<preview-host>/robots.txt         # MUST be "Disallow: /"
```

And in a private window on production: check the canonical is the page's own URL
(not the homepage), confirm no request to `analytics.halalgoes.com` before you
touch the consent banner, then accept and confirm the hit lands in Umami.

---

## 6. What Vercel does not do

Vercel runs `next build` and nothing else. It does **not** run `pnpm check` —
contract validation, fixture validation, token drift, L-4 or typecheck across
the workspace. A commit that breaks token drift or the contract deploys happily.
That belongs in CI on the repo, not here, and does not exist yet.

The one that will bite first: `pnpm generate:tokens:check`. Edit
`docs/design/tokens.json` without regenerating and the site still deploys,
carrying stale CSS, silently.
