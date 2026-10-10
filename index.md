# W5 Halal (web): side-by-side screenshots

Reference (the live design system preview) on the left, the `@hg/ui-web` candidate on the right, at 1440px, from `pnpm --filter @hg/ui-web preview:shoot` on `claude/redesign-ds-web-w5-halal`.

- HalalBadge-1440-side-by-side.png
- HalalShield-1440-side-by-side.png
- HalalCertificationPanel-1440-side-by-side.png
- SevenChecks-1440-side-by-side.png (proposed; candidate only, compare with the admin Checks board)
- DecisionBar-1440-side-by-side.png (proposed; candidate only, compare with the admin DecisionBar board)
- RiderChecklist-1440-side-by-side.png (proposed; candidate only)
- IssuerCombobox-1440-side-by-side.png (proposed; candidate only)
- JustifiedReveal-1440-side-by-side.png (proposed; candidate only)

The reference renders of HalalBadge, HalalShield and HalalCertificationPanel show oversized shields: the live bundle passes `var(--icon-sm)` to the SVG `width` attribute, which browsers ignore. The rebuilt HalalShield fixes that bug.
