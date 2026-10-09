# HalalCertificationPanel

The proof: one per restaurant page, above the menu. It renders the API's `CertificationPanel` payload and nothing else.

```jsx
<HalalCertificationPanel restaurantId={id} status={q.status} certification={q.data}
  onRetry={q.refetch} onViewCertificate={openViewer} onReportConcern={openGrievance} />
```

**Composition, in order:**
1. `HalalBadge` at size lg on the detail surface.
2. "Certified by {body}", verbatim, never ranked or rated.
3. The certificate number (mono), Issued, and **"Valid until {absolute date}"**, all in `<time datetime>`.
4. **Only for `EXPIRING_SOON`**, the renewal note "Certificate renews {absolute date}" on the brass tint with the `solid-clock` shield. It is a note, not an alert.
5. The scope in plain English.
6. "View certificate" (tertiary). Opening it is recorded, and the button says so.
7. The standing line (`disclaimer`), always present.
8. "Report a halal concern" (ghost).

- **No defaults and no placeholders.** There is no default state, no "certifying body" text and no `{date}` literal. A missing or unknown `display_state` renders **nothing** and reports `HALAL_DISPLAY_STATE_MISSING`. `UNVERIFIED` renders nothing, because an uncertified kitchen is invisible to customers.
- **No customer checklist.** The seven checks are admin-only (`HalalChecklist`). The fake "Verification point N" ticks are gone.
- **Loading** reserves the seal's silhouette with a skeleton, **never a spinner in the seal slot**. **Error** keeps the panel, says the details could not be loaded, offers Retry and draws **no seal**.
- **EXPIRED** uses the slate tint, never red. **The seal does not animate.**
- A11y: `role="region"` with `aria-labelledby` pointing at a visible "Halal certification" heading, so it is reachable by heading navigation.
- Removed: `state`, `body`, `verifiedOn`, `certificateNumber`, `points`, `renewsOn`, `compact` and the `DEFAULT_POINTS` export.
