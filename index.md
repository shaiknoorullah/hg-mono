# Sign-in composites screenshots (#737)

Each image puts the restaurant sign-in canvas board on the left, rendered from the canvas
export, beside the candidate on the right, which is the `@hg/ui-web/proposed` specimen from
`pnpm --filter @hg/ui-web preview:shoot` at 1440px. The live design system has no preview page
for these proposed composites. Where the canvas draws no separate board for a state, the left
column says so.

| Component | Files |
|---|---|
| StateCard | `StateCard-*.png`: sign-in form, account state (icon tile), locked with the support block, working (busy), done, 320px reflow |
| SupportBlock | `SupportBlock-*.png`: available, unavailable (`support_enabled = false`), loading |
| SupportSentence | `SupportSentence-*.png`: available, "Partner support:" lead, fallback when support is off |
| WaitLine | `WaitLine-*.png`: too many attempts, resend cooldown, daily limit |
| TextLink | `TextLink-*.png`: inline, standalone, tel:, keyboard focus |

The canvas export draws the Icon glyph at about 36px, because its `var(--icon-lg)` width
attribute fails to parse. The design system's `lg` is 24px, which the candidate uses.
