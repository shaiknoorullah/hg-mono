# @hg/landing — Halal Goes marketing site

Pre-launch, dual-audience landing page. **Astro** (zero-JS static + one on-demand API
route), deployed to **Vercel**, domain `halalgoes.com`.

Implemented from the **"Halal Goes Design System"** Claude Design project
(`ui_kits/marketing-site`) — tokens, components, icons and copy ported faithfully.
Verbatim copy strings ("Verified halal, delivered.", "0% commission at launch.", …)
must not be rewritten. `[XX]` counts, certifying-body names/logos, testimonials and
photography are marked placeholders until real assets exist.

## Run

```bash
pnpm --filter @hg/landing dev        # dev server
pnpm --filter @hg/landing build      # production build (.vercel/output)
pnpm --filter @hg/landing typecheck  # astro check
```

## How it works

- **One long scroll, two audiences** switched by the segmented toggle in the nav.
  Both variants render in the DOM (good for crawlers); `[data-audience]` on `<html>`
  toggles visibility — no React runtime. `?for=restaurant` deep-links to the restaurant
  view; the choice is remembered in `localStorage`.
- **Islands only** for the toggle (`Nav.astro`) and the two waitlist forms
  (`scripts/forms.ts`). Everything else is static HTML.
- **Waitlist**: customer = phone (normalised to E.164) + a CASL consent checkbox with a
  timestamp; restaurant = email. Client validates, then POSTs to `/api/waitlist`, which
  **re-validates server-side** and forwards to a sink.
- **Design tokens** live in `src/styles/tokens.css`, assembled verbatim from the kit
  (forest chrome, orange action, cream canvas, emerald halal seal; marketing type =
  Plus Jakarta Sans).

## Environment variables

Set these in Vercel (never commit secrets):

| Var | Purpose | Exposure |
|---|---|---|
| `WAITLIST_WEBHOOK_URL` | Server sink the `/api/waitlist` lead is POSTed to (CDP / table / Zapier). If unset, leads are accepted and only their non-PII shape is logged. | **server only** |
| `PUBLIC_RUDDERSTACK_WRITE_KEY` | RudderStack JS source write key. If set (with the data-plane URL), a **consent-gated** analytics loader + banner appears. | public |
| `PUBLIC_RUDDERSTACK_DATA_PLANE_URL` | RudderStack data-plane URL. | public |

## Deploy

Vercel project rooted at `apps/landing` (framework preset: Astro). Point `halalgoes.com`
at it. `sitemap-index.xml`, `robots.txt` and `llms.txt` are generated/served.

## Not built yet
- Real OG image (`public/og.png` referenced but not created).
- Real photography, certifying-body logos, the seven point labels, testimonial quotes,
  the launch-city + restaurant counts — all visibly placeholdered.
- Wiring `WAITLIST_WEBHOOK_URL` to the actual CDP (RudderStack) / a store.
