# Marketing type is not part of the product design system

_Decided Sep 2026, on the client's instruction: "for expo, keep the design system very simple.
for marketing keep it separate."_

## What was decided

`halalgoes.com` **shares** the product's colour ramps, role map, radii, spacing, elevation and the
halal tokens — all of it from `docs/design/tokens.json`, consumed through `@hg/ui-web`.

It does **not** share type. The display face and every marketing type role live in
`apps/marketing/src/styles/marketing-tokens.css`, which the marketing app owns.

## Why

Gate A put `font.family.display` (Bricolage Grotesque) and four `typography.marketing.*` roles into
`docs/design/tokens.json`, because that file is the system of record. The generators do their job
faithfully, so the cost showed up on the next regeneration:

| Generated file | Lines of web-marketing type it carried |
|---|---|
| `packages/ui-native/src/tokens/generated/themes.ts` | 288 |
| `packages/ui-native/src/tokens/generated/tokens.ts` | 78 |
| `packages/ui-native/src/tokens/generated/nativewind-preset.cjs` | 42 |
| `packages/ui-web/src/tokens/*` | 401 |

**809 lines**, describing a 118px headline and an optical-size axis, in the token set two Expo apps
compile against. Nothing in the apps referenced any of it, and nothing ever would: a phone does not
render a 118px hero. Removing them is a pure deletion — the generated diff has zero added lines.

The general rule this settles: **a token belongs in `docs/design/tokens.json` when more than one
surface needs it.** A value that exists for exactly one surface belongs to that surface, however
tempting it is to put everything in one file.

## What is still shared, and must stay shared

The seal on the marketing page has to be the same green, the same gold ring and the same shield as
the seal in the app. If they ever drift, the page is advertising a badge the product does not show.
So `color.halal.*`, the role map and the radii come from the product tokens and are never restated
locally. `Seal.tsx` reads `--hg-color-halal-certified-*` directly for exactly this reason.

Invariants 8, 9 and 10 are unaffected: they are colour rules, and colour did not move.

## Consequences

- `apps/marketing/src/styles/marketing-tokens.css` is the only hand-authored token file in the
  repo. There is no generator and no drift check for it, because there is nothing to drift from.
- `pnpm generate:tokens:check` still gates the shared tokens, unchanged.
- If a marketing value is ever needed in an app, that is the signal to **promote** it into
  `docs/design/tokens.json` — not to reach across for it.

## Reversal cost

Low. Moving a role back is a copy of nine lines into `typography` plus a regeneration.
