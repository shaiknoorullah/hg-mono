# Handoff — where things stand

_Written 18 September 2026, at the point of moving from a terminal session to
Claude Code on the web. Read this with `AGENTS.md`; that file says what the
project is and what must not break, this one says what was just happening._

---

## The live thing

**https://landing-shaiknoorullahs-projects.vercel.app** — `apps/landing`, Astro
static + a serverless `/api/waitlist`. Deployed from `apps/landing` with:

```bash
npx vercel deploy --prod --yes --scope shaiknoorullahs-projects
```

The `--scope` matters. Without it the CLI defaults to a different team and fails
with a bare **"Not authorized"** that points nowhere near the real cause.

Pages: `/`, `/for-restaurants`, `/verification`, `/terms`, `/privacy`.

---

## The active task: the landing page is being redesigned, again

**Do not patch the current layout. It is being replaced.**

The client rejected it after five rounds. Their words: _"you are still using the
same plain web design."_ The specific defects, in their screenshots:

1. **Half the desktop viewport is empty.** Recognition, the craving-grid header
   and the states header all sit in columns 1–6 with blank cream beside them,
   wrapped in 176px hinge padding. They read as voids with a sentence in the
   corner. This came from applying the creative direction's "one optical left
   edge, nothing centred" rule literally, with nothing designed for the other
   half.
2. **The craving grid is neither masonry nor bento** — hand-set `grid-row: span`
   values with mismatched heights, so it reads as a broken gallery.
3. **Text glyphs used as UI.** `→` in the nav links and buttons. Use real icons
   or nothing. This is a standing rule now, everywhere.
4. **Nav and buttons are undesigned** — a wordmark and two bare text links on an
   invisible bar.

### How the client wants the redesign done

**Wireframe first, agreed collaboratively, before any code.** They are
installing skills ("superpowers") and want those used to interview them about
layout and composition, converging on a wireframe together. They do not want
another build-then-critique cycle — each previous round fixed the thing they
pointed at while the composition stayed wrong.

Two questions worth settling early, because both previous attempts got them
wrong:
- What fills the other half of the desktop viewport.
- Whether the specimen record card stays the hero object. The research direction
  hangs the whole brand on it and the client has never actually commented on it.

---

## What survives the redesign

The layout is wrong; the content layer is not. Reuse it.

- **`apps/landing/src/lib/claims.ts`** — every factual claim the site makes, each
  with the spec/decision/migration that backs it, plus a `REJECTED` list at the
  bottom of claims that were proposed and are **not** supported by the repo
  (IFANCC, "the GTA", "launch partners", a 60-day notice, guaranteed go-live).
  **No component may hard-code an assertion about what we do, charge, or where we
  operate.** It imports one from here or it does not ship.
- **`docs/design/landing-creative-direction.md`** — the researched direction
  (concept, story spine, copy, motion spec, anti-generic checklist). Its
  *content* thinking is sound. Its *layout* prescription is what produced the
  empty right half — treat that part as advisory, not settled.
- `/verification`, `/terms`, `/privacy` and the FAQ copy.
- The consent model (see below).

## Things that are correct and easy to break by accident

- **Consent is given by submitting the form, not by a checkbox.** There is no
  tick-box, deliberately: it restated the button, and CRTC 2012-549 names
  "actively entering their e-mail address in an electronic form" as a valid
  positive action. The notice stays *at the control* — do not move the email
  consent into `/terms`, CASL wants it unbundled.
- The endpoint refuses to store an address unless it also receives the rendered
  consent **sentence**. A bare `consent: true` is rejected.
- The waitlist is **email only**. O-03 (SMS/A2P 10DLC) is unresolved, so "we'll
  text you at launch" is a promise that cannot currently be kept.
- **Every hidden state lives under `html.js`.** A `.js` class is set by an inline
  head script before paint. No `opacity: 0` may exist outside that, or a JS
  failure strands the page blank.
- Photography: seven images, all viewed before shipping. The previous library
  contained **wine glasses, a rack of ribs and what reads as beer** — filenames
  are not evidence, open the file. `tools/verify/grade-landing-photos.py` brings
  a mixed set to one grade.

---

## Not done / blocked on the client

- `halalgoes.com` is not attached. No DNS.
- `WAITLIST_WEBHOOK_URL` is unset — **signups currently only write a line to the
  function log. Nobody is actually being captured.**
- A monitored mailbox. Three pages render the contact as a ruled blank rather
  than invent an address: `/verification` (disputes), `/terms`, `/privacy`.
  A privacy policy without a reachable contact is not finished.
- `/terms` and `/privacy` are drafted, not lawyered. Scoped narrowly to the
  website and waitlist on purpose — there is no ordering service to write terms
  for yet.
- Native emulator verification of the rider seal-scan and customer tamper flows
  (Metro port contention, unresolved).
- Mapbox needs a secret `sk.` token with `DOWNLOADS:READ` for a Mapbox-included
  native build. A public `pk.` token 403s.

---

## What a cloud session will NOT have

Re-establish these or avoid tasks that need them:

- **Gitignored env files** — `deploy/.env`, `apps/*/.env`, `.env.local`.
- **The Android toolchain** — JDK 21, NDK 27, CMake, cmdline-tools and the KVM
  emulator are installed on the local machine only. APK builds and emulator
  verification are local-only work.
- **An authenticated Vercel CLI.** Deploys need re-authentication.
- **User-level `~/.claude/`** — memories, user skills and agents do not travel.
  Repo-level `.claude/` and `AGENTS.md` do.
