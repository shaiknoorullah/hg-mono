# Brief — the whole marketing site as one scroll journey, as a live prototype

You are building **one self-contained, scrollable HTML page** that ports the **entire**
Halal Goes marketing site into a single scroll-driven storytelling journey, in **one
assigned visual direction**. The client will open it and scroll it to test the pacing. It
is a prototype for judging choreography and content, not production code.

**Three of these are being built in parallel (G1, G3, G4). Build only your own.** Do not
read, edit or reference the other two's output files.

---

## 1. Read these first — they are the source of truth

Content and claims (repo root `/home/user/hg-mono`):

| File | What you need from it |
|---|---|
| `apps/marketing/src/components/TrackPage.tsx` | **The section order, and the comment explaining why each beat sits where it does. Follow that order.** |
| `apps/marketing/src/lib/claims.ts` | **The claims register. Every factual assertion must come from here.** Read the whole file including the REJECTED list at the bottom. |
| `apps/marketing/src/lib/audiences.ts` | The copy: headlines, lede, form, steps, FAQ, final CTA. Customer track. |
| `apps/marketing/src/components/*.tsx` | Each section's exact copy and structure. Read every one listed in the spine below. |
| `apps/marketing/AGENTS.md` | The app's own rules. |
| `docs/design/landing-creative-direction.md` | Art direction. **§7's motion bans are superseded for this prototype by explicit client instruction** — scroll-driven sequences and Lenis are now wanted. Everything else in it still applies, especially §6's art-direction "never" list. |

**The rule that outranks everything: if you cannot put a `source:` on a factual claim, it
does not go on the page.** No counts, no testimonials, no competitor comparisons, no tax
claims, no restaurant names, no ratings, no prices. Values that would be real data are
**ruled blanks**. Copy is transcribed from the repo, not rewritten — you may cut, you may
not invent.

## 2. The section spine — port ALL of it

In this order (from `TrackPage.tsx`, customer track):

1. **Site header** — audience switch (Order food / List your restaurant / Ride with us) + CTA
2. **Hero** — `Hero.tsx`: eyebrow, `Verified / halal, / delivered.`, lede, waitlist form, certifier row
3. **Recognition** — `Recognition.tsx`: "You already have a list. It's four places long."
4. **CravingGrid** — `CravingGrid.tsx`: six dishes, the six captions verbatim. Images in `assets/`.
5. **WhyThisExists** — `WhyThisExists.tsx`: the CBC Marketplace investigation, cited exactly
6. **VerificationSheet** — `VerificationSheet.tsx`: the seven checks H1–H7. **This is the instrument — the most important section on the page.**
7. **Refusal** — `Refusal.tsx`: "We don't certify food." on the ink band
8. **StateGrid** — `StateGrid.tsx`: the four badge states + the specimen record card
9. **Sealed** — `Sealed.tsx`: chain of custody, three rows
10. **Steps** — `Steps.tsx`: how ordering works, three
11. **Checkable** — `Checkable.tsx`: the verifiability band
12. **FAQ** — seven questions from `audiences.ts`
13. **Final CTA** — "Be there on day one." + the form again
14. **Footer** — `SiteFooter.tsx`

Every section implements its real content. A section reduced to a placeholder is a failure.

## 3. The scroll choreography — this is the point of the exercise

The previous attempt failed **specifically because its timeline was too short**: chapters
were `150vh`, giving ~1.3 viewports per beat, so a small scroll ran the whole animation to
completion. Do not repeat that.

- **Every pinned or animated beat gets at least `250vh` of scroll**, and the device-led
  journey beats get `300vh`+.
- **Give each beat a dwell.** Map local progress so roughly the first 20% and last 20% of a
  beat's scroll range hold still, with the movement in the middle. A reader must be able to
  stop and read without the thing under them still travelling.
- **Drive everything from one scroll progress value**, computed in **pixels** against each
  beat's own measured `offsetTop`/`offsetHeight` — not from section centres alone, and never
  from a wheel-event accumulator.
- **Keep exact progress separate from damped progress.** Exact owns anything discrete (which
  chapter is active, which checks are ticked, ARIA state). Damped owns anything continuous
  (transforms, opacity). This is what stops text flickering between two states.
- **Ship a visible scroll HUD** (fixed, small, mono, bottom-right): current beat name and
  its local progress `0.00–1.00`, plus total page height in viewports. The client is testing
  pacing and needs to see the numbers. Make it toggleable with the `d` key.

## 4. Your direction

Each direction keeps the same content and the same beat order. What differs is **how the
device carries the journey**. Your specific direction is in your task prompt.

The devices in this prototype are **DOM/CSS mockups, not three.js** — deliberately. The
point is to settle the choreography, the content and the timeline cheaply first; the device
gets swapped for a real 3D model afterwards, once the pacing is agreed. So build the
handsets as styled `div`s with real app UI inside them (cards, rows, seal pills, ruled
blanks), and drive them with `transform`. Keep every device's transform state in one place
so it is a clean swap later.

## 5. Technical requirements

- **One file**, `<direction>.html`, in the output directory given in your prompt. Assets live
  beside it in `assets/` — reference them as `assets/<name>`. **Do not copy or modify the
  assets.**
- **Lenis is vendored** at `assets/lenis.min.js`. Load it with a relative path, not a CDN — a
  CDN import is exactly what broke the last published prototype. Wire it to drive native
  scroll and make sure your progress maths reads Lenis's scroll value.
- **Reduced motion is a real path**: `prefers-reduced-motion: reduce` disables Lenis, snaps
  every beat to its resting state, and leaves the page fully readable as an ordinary
  document. Test it.
- **No WebGL. No three.js. No GSAP, no Framer, no Locomotive.** Lenis is the only library.
- **Fonts**: Bricolage Grotesque (display), Plus Jakarta Sans (UI), IBM Plex Mono — from
  Google Fonts, which is allowed.
- **The waitlist form** must implement empty, focus, invalid and submitted states. It posts
  nowhere; on submit show the success state. The consent checkbox is unticked by default and
  the copy is verbatim from `audiences.ts`.
- Real semantics: `<button>`, `<a>`, `<input>` + `<label>`, headings in order, visible focus.

## 6. The palette — these hexes and no others

```
cream    #FFFAEA   sunken  #F6EFDD   raised   #FFFFFF
ink      #232323   body    #4A4E48   mkt ink  #1B3B31
hairline #E6E0D4   border  #8B8578
orange   #F1521E   on-orange #0F241C
seal     #0F7A43   brass   #C9A24B   sage     #E9F3E4
expired  #4E5862
```

- **`#6E7C77` is banned** — it fails AA on cream at ~4.2:1. Do not use it.
- **Invariant 9: never red for a halal state.** Expired is the cool slate `#4E5862`.
- **Invariant 10: solid green `#0F7A43` is reserved to the halal seal.** Nothing else on the
  page may be a solid saturated green — not a success tick, not a progress bar, not a
  timeline dot. Completed steps are ink `#1B3B31`.
- **Invariant 8: a missing halal field renders NO badge**, never an optimistic one.
- The only gradient permitted on the whole page is the CravingGrid caption plate. Keep its
  stops at 0.92 / 0.72 — the contrast is derived, not sampled, and lowering it breaks AA.

## 7. Verify before you hand back

Run these yourself and report the numbers. Chromium is at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; `playwright` resolves from the repo
root. Serve the directory over `http://127.0.0.1:<port>` with correct MIME types — do not
test over `file://`, ES modules will not load.

1. **Total scroll height in viewports**, and **the scroll distance of every beat**. Report the
   table. Any beat under 250vh is a defect — fix it.
2. **No horizontal scroll** at 390, 768, 1024 and 1440 wide.
3. **Zero console errors**, and the page still works with **every external origin blocked**
   (fonts will fall back; that is fine — the page must not break).
4. **Reduced motion**: page renders complete and readable, nothing mid-transform.
5. **Contrast**: sample your body text and captions against their real backgrounds; report any
   pair under 4.5:1.
6. Screenshot the page at four or five scroll positions and **look at them** before handing
   back.

Report honestly: what you built, the beat-length table, the measured numbers, and anything
you could not do or had to compromise on. Do not publish anything — do not call the Artifact
tool. Just write the file and report.
