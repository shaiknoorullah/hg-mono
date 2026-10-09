# Marketing site — three audiences

Order food · List your restaurant · Deliver with us, plus verification, writing, legal and cookie consent

The HalalGoes pre-launch marketing site as artboards: the landing page for each audience (`/`,
`/restaurants`, `/riders`), every waitlist form state (email only, consent unticked), the cookie
notice and preferences (nothing pre-accepted), `/verification`, `/blog` (with its empty state),
`/blog/[slug]` (with 404), `/privacy` and `/terms`. Every claim comes from
`apps/marketing/src/lib/claims.ts`. Dashed outlines ("Show component gaps") mark placeholders for
components the system does not have yet: Wordmark, Accordion, EmptyState, ErrorState, InlineAlert,
ListRow, MediaFrame. Files and details: `ui_kits/marketing-site/README.md`.
