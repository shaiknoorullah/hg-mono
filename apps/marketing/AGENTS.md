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
- **Nothing goes on a page that is not in the claims register.** The register is
  `src/lib/claims.ts` — every factual assertion about what we check, what we
  charge and where we operate lives there with the file and decision that backs
  it, and it ends with a REJECTED list of claims that must not come back. Its
  rule: *if you cannot put a `source:` on it, it does not go on the page.* Copy
  lives in `src/lib/audiences.ts` (the Gate B deck in
  `docs/marketing/copy-deck.md`, transcribed rather than new writing); where the
  two disagree, `claims.ts` wins and `audiences.ts` changes. No counts, no
  testimonials, no competitor comparisons, no tax claims.
- **The waitlist collects email on every track** while O-03 (SMS sender
  registration) is open — `claims.ts`, `WAITLIST_CHANNEL`. The server action
  refuses a track that drifts from it. Do not reintroduce a phone field, or copy
  promising a text, until that decision closes.
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

## Breakpoints

One breakpoint, and it is **`lg` (1024px)**, not `md`. Below it the phone
artboard runs; at and above it the desktop artboard does. `md` was the switch
originally and the desktop layout does not fit until ~1000px, so every tablet in
portrait scrolled sideways — 227px on `/restaurants`. Do not add a `md:` variant
back without checking 768px, and do not lower the switch.

---

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
