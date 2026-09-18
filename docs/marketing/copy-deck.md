# Copy deck — halalgoes.com

_Gate B. Sep 2026. Pre-launch: every CTA is a **waitlist**, not an app download._

---

## How to read this

Written against `objection-map.md`, which is **category evidence, not our customers** — we have
none yet. The one finding that shaped every headline below:

> The persuasive register in the evidence is **relief from vigilance**, not interest in process.
> *"It just saves you the hassle of asking again and again."*
> *"…the last thing you want to be worried about is the pizza in front of me."*

Our existing copy sells our process ("checked seven ways"). The evidence says people want their
effort back. The seven checks are the **proof**; they are probably not the **hook**. Both options
are given for the customer headline so this can be tested rather than assumed.

Every factual claim is listed in the **claims register** at the bottom with its source. Anything
not in that register does not go on the page.

---

## Voice

Plain, unhurried, exact. The product's authority comes from being specific, so vagueness reads as
evasion. Short sentences. No exclamation marks. Never "guaranteed halal" — always "verified", or
"certified by", or the certifier's own name.

Three things we never do, all of them invariants:
- **Never issue a religious ruling.** We report what a certificate says and whether we checked it.
- **Never a red state.** Expired is "we can't currently vouch", in slate.
- **Never an optimistic badge.** No halal field on file → no badge, not a guess.

---

## Customer track

### Hero — headline options

**Option A — "Verified halal, delivered."** *(the incumbent)*
- Says what the product *is* in three words. For cold traffic that has never heard of us, that
  matters more than it looks — a visitor who doesn't know the category can't be moved by relief
  from a problem they haven't been told we solve.
- Fits the 118px lockup in three lines exactly.
- **Weakness:** process-neutral. It states a claim rather than removing a burden.

**Option B — "Order without asking."** *(evidence-led)* ← **recommended to test**
- Passes the "Now you can" test cleanly: *now you can order without asking.*
- Mirrors the verbatim almost exactly. The transformation is doing the asking *for* them.
- **Weakness:** doesn't say what the product is. Needs the subhead to carry the category, and
  needs the eyebrow (`ONTARIO · LAUNCHING SOON`) plus the seal to do more work.

**Option C — "We already asked."**
- The labour transfer, stated as a completed fact. Strongest single line in the set.
- **Weakness:** oblique. Asked *whom*, about *what*? Requires the subhead to land immediately, and
  it's the highest-risk option on cold paid traffic.

**Recommendation:** ship A, test B. A is the safer opener for cold traffic and it's already
designed; B is the one the evidence points at. This is the single highest-value A/B test on the
page and it should be the first thing run once there is traffic — not decided by argument now.

### Hero — subheads, paired

| With A | With B or C |
|---|---|
| **"Seven checks on every restaurant, before it reaches you."** | **"Every halal restaurant here passed seven checks. You don't have to run them again."** |

The A subhead is tightened from "Every restaurant checked seven ways before it reaches you" —
"seven checks" is more concrete than "seven ways", and "before it reaches you" earns its place by
placing the work ahead of the order.

### Form and CTA

- Label: **Mobile number**
- Placeholder: `+1 416 555 0134`
- Button: **Notify me** — deliberately not "Get started", which promises a product that isn't live.
- Under-CTA: **"No spam. One text, when we launch in your city."**
  *(Was "We'll text you once, when we launch in your city." Tightened; "No spam" leads because
  giving a phone number is the actual objection to the actual ask.)*
- CASL consent, adjacent to the field, not buried: **"I agree to receive one launch notification
  by text. Unsubscribe any time."** — checkbox, unticked. Silence is never consent.

### Section order — customer

1. **Hero** — the claim or the relief, plus the form.
2. **Why this needs to exist** — the category problem. *New section; the objection map's second
   unanswered objection.* A cold visitor who has never been misled doesn't know what we solve.
3. **The verification section** — the certificate sheet. Already built; copy stands.
4. **How ordering works** — three steps.
5. **FAQ** — the objections below.
6. **Final CTA** — repeat the form.

### "Why this needs to exist" — draft

> **Halal is a claim anyone can print.**
>
> Canada has more than a dozen halal certifying agencies. Each sets its own standards, and none of
> them is regulated — the Canadian Food Inspection Agency requires halal food to be certified but
> does not do the certifying, and does not oversee the certifiers.
>
> In 2024, a CBC Marketplace investigation visited ten fast-food locations advertising halal food.
> Staff at six said the whole restaurant was certified. None of the ten was. Between them they
> produced eight expired certificates — one set had run out eight years earlier.
>
> That is the gap. Not restaurants lying, mostly: paperwork nobody checks.

Attribution line, visible: *Source: CBC Marketplace, "Fast-food chains serving up halal food with
a side of misinformation, expired certificates", 18 October 2024.*

**We cite; we never accuse, and we name no chains.** See the legal note in `objection-map.md`.

---

## Restaurant track

**Headline:** **"0% commission at launch."**
**Subhead:** **"Keep the whole ticket. We make our money later, and we'll tell you before we do."**

The second clause is the important one. "0% at launch" invites the obvious objection — *and then
what?* — so answer it in the same breath rather than letting it sit. `S-01` keeps a per-restaurant
commission field that is switchable, so this is true and the promise we can keep is notice, not
permanence.

- CTA: **Get early access** · field: **Email address**
- Under-CTA: **"No contract, no exclusivity, no setup fee."**

**Secondary block — "What we'll ask you for":**

> Your business licence, your halal certificate, your food-safety permit, and owner ID. We check
> the certificate against seven points before you go live. If something's missing we tell you
> which one, not just "rejected".

That last sentence is the restaurant-side version of the whole product promise, and it's true —
rejection carries a reason code (`docs/spec/05-admin.md`).

> ⚠️ **Unevidenced.** Nothing in the objection map touches restaurants. This is written from the
> spec and from what the offer implies, not from anything an owner said. Treat as a first draft to
> be replaced the moment there are five real conversations.

---

## Rider track

**Headline:** **"The delivery fee is yours. All of it."**
**Subhead:** **"$2.99 plus $1.00 per kilometre, paid to you. Every Monday, automatically, with no
minimum."**

This is the strongest copy in the deck because every number in it is a settled decision (`S-02`,
`S-03`, `S-04`) and no competitor can say it casually. Specificity over vagueness, and it happens
to be true.

- CTA: **Start delivering** · field: **Mobile number**
- Under-CTA: **"No minimum payout. No waiting for a threshold."**

> ⚠️ **Unevidenced**, same caveat as restaurants.

---

## FAQ — ordered by the objection map

**What does "verified" mean here?**
A person reads the restaurant's halal certificate and records seven checks against it:

1. It's legible and complete.
2. The issuing body is one we accept.
3. The legal name matches the restaurant.
4. The premises address matches the certificate.
5. The dates are valid today.
6. The scope covers everything sold.
7. The certificate isn't already in use by another restaurant.

All seven have to pass. Six of seven is a rejection with a reason, not a seal.

**Whose certificates do you accept?**
HMA Canada, HFSAA and ISNA Canada. A certificate from any one of them satisfies the issuer check.
The list can grow as we accept more bodies; it's never typed in free-hand.

**What happens when a certificate expires?**
The seal comes down the same day. The listing shows a neutral "we can't currently vouch" state and
you can't order from it until it's renewed. We don't leave a badge up in hope.

**Do you decide what's halal?**
No. We check certificates issued by recognised bodies and report what we find. We don't make
religious rulings, and we don't rank one certifier's standard above another's.

**Is the whole restaurant halal, or just some items?**
That's check six, and in the CBC investigation it was the most common failure — six of the ten
locations claimed the whole restaurant was certified when none of them was. We record what the
certificate's scope covers. If it doesn't cover everything sold, the restaurant doesn't go
live.

**Is the meat hand- or machine-slaughtered?**
We record what the certificate says, and show it on the restaurant's page. If the certificate
doesn't state a method, we show nothing rather than guess. We don't rank one method above the
other — that's a question for your certifier, not for us.

> 🚫 **BLOCKED — do not publish.** There is no `slaughter_method` field yet. Ships only after
> schema → contract → admin capture → app display. See `docs/decisions/halal-slaughter-method.md`.

**What do you do with my number?**
One text when we launch in your city. That's it — it isn't sold, and it isn't used for anything
else. You can unsubscribe from that message.

**When are you launching?**
Ontario first. We'll text you the day it's live in your city.

---

## Thank-you page

Attention peaks here and almost nothing is usually asked.

> **You're on the list.**
> We'll text you once, the day we launch in your city. Nothing before then.
>
> **Know a halal restaurant that should be on here?** *(field: restaurant name + city → button:
> Suggest it)*

Turns one waitlist signup into supply-side leads at the moment of maximum goodwill, and costs the
visitor nothing. This is the only place on the site that asks for a second thing.

---

## Claims register

Every factual claim on the page, with its source. **Nothing goes on the page that isn't here.**

| Claim | Source | Safe to publish |
|---|---|---|
| Seven checks, and what each one is | `docs/spec/05-admin.md` H1–H7 | Yes |
| HMA Canada · HFSAA · ISNA Canada accepted; any one satisfies the issuer check; registry extensible | `docs/decisions/README.md` S-11 | Yes |
| Seal withdrawn same day on expiry; neutral state; not orderable | spec + invariants #8/#9 | Yes |
| Rejection carries a reason code | `docs/spec/05-admin.md` | Yes |
| 0% commission at launch, switchable later | `S-01` | Yes |
| Delivery fee $2.99 + $1.00/km | `S-02` | Yes |
| 100% of the delivery fee to the rider | `S-03` | Yes |
| Weekly Monday payouts, automatic, no minimum | `S-04` | Yes |
| Free cancellation before the restaurant accepts | `S-05` | Yes |
| Ontario at launch | `O-05` | Yes |
| >12 unregulated certifiers; CFIA requires certification but doesn't certify or regulate certifiers | CBC Marketplace, 18 Oct 2024 | Yes — cite CBC |
| 6 of 10 claimed whole-restaurant certification; none certified; 8 expired certificates, one by 8 years | CBC Marketplace, 18 Oct 2024 | Yes — cite CBC, **name no chains** |

### Not publishable — do not write these

- Any restaurant count, rider count, order count or waitlist count. **None exist.** If a number
  appears on the page it must be live from the database, or the section doesn't ship.
- Any testimonial, review or quote from a customer, restaurant or rider. None exist.
- Certifying-body **logos** — the names are factual; the marks need permission.
- Any comparison to a named competitor.
- "Guaranteed halal", "100% halal", or any phrasing that makes the platform the authority rather
  than the certificate.
- **Slaughter method (hand/machine).** Approved in principle, but the field does not exist yet.
  The FAQ answer above is drafted and blocked — publishing it before the column ships would be an
  overclaim on the most sensitive topic on the page.

---

## Open, before build

1. **Headline A vs B** — ship A, test B first. Do not settle by argument.
2. **Restaurant and rider copy is unevidenced.** Five real conversations each would replace it.
3. **Slaughter method (hand vs machine)** — named by the HMA as trust-breaking, and the objection
   map's third unanswered objection. Our check six covers scope generically. Decide whether the
   certificate's method is surfaced on the restaurant page; if it is, the FAQ needs a line.
