# apps/marketing — halalgoes.com

> **Read `/AGENTS.md` first.** The nearest `AGENTS.md` wins, and Next.js writes
> its own block into this file on every `next dev` — so without this preamble
> the generated file would silently shadow the root one for everything under
> `apps/marketing/`, taking the invariants, the contract rule and the halal
> rules with it. Everything in the root file still applies here.

## What is different in this app

- **Type is owned locally.** `src/styles/marketing-tokens.css` is the marketing
  type layer — the display face and the `marketing.*` roles. Colour, radii,
  spacing and the halal tokens still come from `@hg/ui-web`. Building this site
  must never require an edit to `docs/design/tokens.json`.
- **The seal is the product's seal.** `Seal.tsx` reads
  `--hg-color-halal-certified-*` directly. Never restate a halal colour here.
- **Nothing goes on a page that is not in the claims register** in
  `docs/marketing/copy-deck.md`. No counts, no testimonials, no competitor
  comparisons, no tax claims. Copy lives in `src/lib/audiences.ts`, which is the
  deck transcribed rather than new writing.
- **Invariants 8, 9 and 10 apply to marketing surfaces too.** No optimistic
  badge, never red for a halal state, and solid green is reserved to
  `color.halal.*` — which is why the consent banner's accept button is orange.
- **Every screen implements empty, loading and error.** The blog index and the
  waitlist form both do; anything new must.
- **Nothing tracks before consent.** The analytics tag ships inert and Klaro
  activates it. Do not add a script that runs on load.

## Commands

```bash
pnpm --filter @hg/marketing dev        # :5190, and the CMS at /keystatic
pnpm --filter @hg/marketing build
pnpm --filter @hg/marketing lint       # L-4 no-green-solids over src/
```

---

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
