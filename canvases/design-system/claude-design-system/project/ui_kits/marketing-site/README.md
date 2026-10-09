# Marketing site — three audiences, pre-launch

The live kit is `components/Index3/preview.html` (JSX in `components/Index3/*.jsx`, precompiled and
inlined — the viewer blocks relative script URLs). Pick an artboard with the **Screen / Variant /
State** controls; **Show component gaps** outlines every placeholder for a component the design
system does not have yet (issue #109). `artboards.html` in this folder is the older static canvas
and has **not** been updated to these fixes.

Every factual line traces to `apps/marketing/src/lib/claims.ts` (claims win) and the voice to
`apps/marketing/src/lib/audiences.ts`. If a line cannot carry a source, it is not on the page. Both
waitlists are **email** (O-03, SMS sender registration, is open), and every consent box starts
**unticked**.

## Artboards
| Screen | Route | Variants / states |
|---|---|---|
| Landing | `/`, `/restaurants`, `/riders` | Customer · Restaurant · Rider |
| Waitlist form states | hero + footer form | Idle (unticked) · Submitting · Invalid email · Consent required · Server error · Success |
| Cookie consent | every page | Notice (nothing pre-accepted, Decline = Accept in weight) · Preferences (all off) |
| Verification standard | `/verification` | seven checks, four display states, seal chain |
| Writing | `/blog` | Populated · Empty ("Nothing published yet") |
| Post | `/blog/[slug]` | Populated · Error (404) |
| Legal | `/privacy`, `/terms` | Privacy · Terms (structure; body text lives in the app) |

## Files (`components/Index3/`)
| File | What |
|---|---|
| `Kit.jsx` | Shared kit frame + component-gap placeholders (same file in every kit) |
| `Content.jsx` | CHECKS, ISSUERS, STATES, SEAL, MONEY, the three audience tracks — transcribed from claims.ts / audiences.ts |
| `Nav.jsx` | Sticky header (forest chrome, `GapWordmark`, three-way audience `SegmentedControl`), `Section`, `SectionTitle` |
| `WaitlistForm.jsx` | Email + unticked consent, all six states |
| `Hero.jsx` | Hero per audience; example listing with `HalalBadge size="lg"` over the `Photo` slot |
| `Verification.jsx` | How we verify: `HalalBadge state="CERTIFIED" size="lg"`, the seven claims.ts checks as a plain public list (title, body, who performs each; the DS `HalalChecklist` is the admin review form and is not used here), the three accepted bodies as names |
| `HowItWorks.jsx` | Three steps per audience |
| `Benefits.jsx` | Why HalalGoes (customer, restaurant) |
| `Sealed.jsx` | Chain of custody (replaces `SocialProof.jsx`: no testimonials or counts exist yet) |
| `Faq.jsx` | Per-audience FAQ in `GapAccordion` |
| `FooterCta.jsx` | Final ask + footer, fixed disclaimer, cookie settings |
| `ConsentBanner.jsx` | Cookie notice and preferences (copy from `lib/consent.ts`) |
| `Pages.jsx` | `/verification`, `/blog`, `/blog/[slug]`, `/privacy`, `/terms` |
| `MarketingApp.jsx` | Artboard list, entry point |
| `../customer-app/Photo.jsx` | `MediaFrame` placeholder with the no-image fallback |

## Fixed copy
- Disclaimer: "Certification verified by HalalGoes on the date shown on each listing. HalalGoes does not itself certify food."
- Badge label: "Halal certified" (from `HalalBadge`).
- "0% commission at launch." always travels with the qualifier: at launch, per restaurant, switchable; processing fees still apply.

## Placeholders (marked, not invented)
The hero's `[XX] certified restaurants ready for launch day` / `[XX] restaurants already on the
launch list` line (kept by owner decision), all photography, sample blog posts.

## Removed, and why
"Keep every dollar" (processing fees apply), the phone field and "we'll text you" (no SMS sender),
pre-ticked consent (CASL), the four body-logo slots (logos need permission; three accepted bodies),
named launch cities and "Greater Toronto Area" (launch unit is Ontario), "a broken seal gets you a
refund", "usually within two working days", "no exclusivity", placeholder testimonials and city
counts, the badge download.
