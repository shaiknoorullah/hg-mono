'use client';

import { useEffect, useLayoutEffect, useRef, type ReactNode, type Ref } from 'react';
import { Beat } from '@/components/journey/Beat';
import {
  Blank,
  DeviceFrame,
  DOOR_STEP_MARKS,
  DoorScreen,
  RECORD_BADGE_AT,
  RecordScreen,
  ScreenLabel,
  SEALED_SCAN_AT,
  SealedScreen,
  seg,
  type ScreenProps,
} from '@/components/journey/screens';
import { HALAL_SHIELD_D } from '@/components/Seal';
import { DISCLAIMER, MONEY, STATES } from '@/lib/claims';
import { type Audience } from '@/lib/audiences';

/**
 * The device chapters — the handset half of the G3 journey.
 *
 * Ported from the approved prototype's `j01…j04` beats, one set per track:
 * `experiments/hero-journey/site/index.html`, `restaurants.html`, `riders.html`.
 * Each chapter is one pinned beat holding one handset while one thing happens
 * on it, and the chapters are the ONLY pinned sections on the page besides the
 * overture. Everything else stays ordinary flow. That restraint is the
 * direction, not an omission.
 *
 * WHERE THE CHAPTERS SIT. Not in a block of their own: each is placed at its
 * content's home, so the moving version of an argument lands next to the
 * written one. `TrackPage` marks three insertion points and this component
 * answers each with whatever that track has there — see `CHAPTERS` at the foot
 * of the file. The restaurant track has no Sealed chapter for the same reason
 * it has no Sealed section: the seal binds at their counter, but the chain
 * after it is the customer's and the rider's.
 *
 * THE TWO CLOCKS. The handset ARRIVES on the approach clock (`p.dIn`) and is
 * therefore parked, whole and still, at the moment the beat pins. What the pin
 * is held for is the screen writing itself, which runs on the pinned clocks —
 * damped for everything continuous, exact for everything counted. The screens
 * enforce their half of that by taking the two separately and exporting their
 * own thresholds; this file must not re-guess either.
 *
 * EVERY VALUE ON EVERY SCREEN IS WITHHELD except the ones `claims.ts` settles —
 * the issuer's name, the delivery fee, the commission, the payout day, the
 * disclaimer. We have not opened. A plausible restaurant name or a specimen
 * certificate number on the page whose single claim is "we read documents
 * carefully" is the argument against us, so the fields are ruled blanks.
 */

// `useLayoutEffect` would warn on the server, where it does nothing anyway.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/* ── the handset's arrival ──────────────────────────────────────────────── */

type Pose = { x: number; y: number; ry: number; rz: number; s: number };

/**
 * Every chapter's device transform, from → to, in ONE table — the prototype's
 * `DEVICES` map, minus the parts the engine now owns. When the DOM handset is
 * one day swapped for a real model, this table is the only thing that has to be
 * re-pointed.
 *
 * The door chapters come in from the LEFT. Three chapters arriving from the
 * same side reads as one slide deck; the reversal is what makes the last one
 * land as an arrival rather than another card.
 */
const POSES: Record<'right' | 'near' | 'left', { from: Pose; to: Pose }> = {
  right: { from: { x: 76, y: 18, ry: 26, rz: -6, s: 0.92 }, to: { x: 0, y: 0, ry: 10, rz: -2, s: 1 } },
  near: { from: { x: 66, y: 16, ry: 22, rz: -5, s: 0.92 }, to: { x: 0, y: 0, ry: 7, rz: -1.5, s: 1 } },
  left: { from: { x: -62, y: 16, ry: -22, rz: 5, s: 0.92 }, to: { x: 0, y: 0, ry: -6, rz: 1.5, s: 1 } },
};

/**
 * Drives the handset's arrival straight onto the element, through the ref the
 * screens hand out.
 *
 * Written as a style mutation rather than a `style` prop because the handset is
 * the one node that moves on every frame of the approach, and `DeviceFrame`
 * deliberately exposes it as a ref for exactly this. The caption is a sibling
 * of it, so it stays square to the page while the phone is tipped.
 *
 * The scale folds in the prototype's viewport fit: a 468px handset plus a
 * heading and a caption does not fit a short laptop, and the prototype scaled
 * the device rather than cropping it. Same formula, same 0.56 floor.
 */
function useHandset(pose: { from: Pose; to: Pose }, k: number, reducedMotion: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const apply = useRef<() => void>(undefined);

  useIsomorphicLayoutEffect(() => {
    apply.current = () => {
      const el = ref.current;
      if (!el) return;
      if (reducedMotion) {
        // Reduced motion is a real path: the handset sits where it belongs at
        // full size, and the page is an ordinary document.
        el.style.transform = '';
        el.style.margin = '';
        return;
      }
      const fit = Math.min(1, Math.max(0.56, (window.innerHeight * 0.545) / 468));
      // The fit is a TRANSFORM, so however small the handset is drawn it keeps
      // its full 468x228 layout box — at a 700px viewport that is 130px of
      // phantom height under a composition that already does not fit, and it is
      // what pushed the step counter off the top of the stage and the closing
      // rule off the bottom. Collapsing the box to what is actually painted
      // costs nothing: the transform origin is the centre, so symmetric
      // negative margins take the slack off both sides and leave the handset
      // exactly where it was drawn.
      const slack = 1 - fit;
      el.style.marginBlock = `${(-234 * slack).toFixed(2)}px`;
      el.style.marginInline = `${(-114 * slack).toFixed(2)}px`;
      const m = (a: number, b: number) => a + (b - a) * k;
      const { from, to } = pose;
      el.style.transform =
        `translate3d(${m(from.x, to.x).toFixed(2)}px, ${m(from.y, to.y).toFixed(2)}px, 0)` +
        ` rotateY(${m(from.ry, to.ry).toFixed(2)}deg)` +
        ` rotateZ(${m(from.rz, to.rz).toFixed(2)}deg)` +
        ` scale(${(m(from.s, to.s) * fit).toFixed(4)})`;
    };
    apply.current();
  });

  // The fit is measured, so a resize that does not move the scroll still has to
  // re-apply it — otherwise rotating a phone leaves the handset at the old size
  // until the reader scrolls.
  useEffect(() => {
    const onResize = () => apply.current?.();
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return ref;
}

/* ── screen furniture the built screens do not export ───────────────────── */

/**
 * A step marker. INK, never green — solid green is reserved to the halal seal
 * (invariant 10), and a green tick beside "Permit" or "Picked up" would quietly
 * read as a second halal assurance attached to a clerical event.
 *
 * The ring is drawn from the first frame, so an unmarked step is an empty
 * circle on a visible list rather than an absence.
 */
function Tick({ done, size = 18 }: { done: boolean; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex flex-none items-center justify-center rounded-full border-2 border-current bg-surface-raised text-fg-primary"
      style={{ width: size, height: size }}
    >
      <svg
        width={size * 0.56}
        height={size * 0.56}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="transition-opacity duration-200"
        style={{ opacity: done ? 1 : 0 }}
      >
        <path d="m5 12 5 5 9-10" />
      </svg>
    </span>
  );
}

/** A check that did NOT pass: a dash, not a cross. Never red, never a cross —
 *  invariant 9. The state is "we cannot currently vouch", not a verdict. */
function NotYet({ size = 18 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex flex-none items-center justify-center rounded-full border-2 border-current bg-surface-raised text-mk-ink"
      style={{ width: size, height: size }}
    >
      <svg
        width={size * 0.56}
        height={size * 0.56}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      >
        <path d="M7 12h10" />
      </svg>
    </span>
  );
}

/** A label/value row on a device screen: the shape of a receipt line. */
function DevRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex h-[18px] items-center justify-between gap-2 text-[11px] leading-snug text-mk-ink">
      <span>{label}</span>
      {children}
    </div>
  );
}

/** The plate a list or a total sits on. Matches the built screens' plate. */
function Plate({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-stretch gap-2 rounded-xl bg-surface-raised px-3.5 pt-3 pb-3.5">{children}</div>
  );
}

/** The bottom rule of a plate — the line a total sits under. */
function PlateTotal({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-1 flex items-center gap-2.5 border-t border-line-decorative pt-3">
      <b className="flex-1 text-[14px] leading-none font-bold tracking-[-0.01em] text-fg-primary">{label}</b>
      {children}
    </div>
  );
}

/** Fixed copy from the register: "Halal certified". Not "Halal", not "100%
 *  Halal", not "Verified halal" (claims.ts STATES, C-12 R7). */
const CERTIFIED_LABEL = STATES.find((s) => s.state === 'certified')?.label;

/**
 * The certified badge, on the tracks whose chapters show a listing.
 *
 * The one solid green anywhere on this page, with its brass ring, and it is the
 * halal seal (invariant 10). It appears; it never pulses, shimmers or draws
 * itself, because a seal that animated would be performing a claim rather than
 * reporting one. Driven by EXACT progress: a badge is shown or it is not, and
 * invariant 8 says a record we have not read renders no badge at all.
 */
function SealBadge({ shown }: { shown: boolean }) {
  return (
    <span
      className="inline-flex rounded-2xl border-[1.5px] border-mk-seal-ring p-0.5 transition-opacity duration-200"
      style={{ opacity: shown ? 1 : 0 }}
      aria-hidden={!shown}
    >
      <span className="inline-flex items-center gap-1.5 rounded-xl bg-mk-seal py-1.5 pr-2.5 pl-2 text-[12px] leading-none font-bold whitespace-nowrap text-mk-on-seal">
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" className="block">
          <path d={HALAL_SHIELD_D} fill="var(--hg-mk-on-seal)" />
          <path
            d="m8 12.1 2.7 2.7L16.2 9"
            fill="none"
            stroke="var(--hg-mk-seal)"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {CERTIFIED_LABEL}
      </span>
    </span>
  );
}

/* ── the restaurant's three screens ─────────────────────────────────────── */

/**
 * The four documents. Short forms, because the full names wrap to two lines on
 * a 228px screen and a row that wraps stops reading as a checklist — the
 * caption under the handset spells all four out, which is where the claim
 * lives. The list itself is the restaurant track's first step (`audiences.ts`).
 */
const DOCUMENTS = ['Licence', 'Certificate', 'Permit', 'Owner ID'] as const;

/** Exact progress at which each document is marked received, then the whole
 *  application submitted. Discrete: a count must not lag the reader's scroll. */
const DOC_MARKS = [0.27, 0.38, 0.49, 0.6] as const;
const DOC_SUBMITTED_AT = 0.76;

/**
 * Restaurant 01 — FOUR DOCUMENTS. The application filling itself in.
 *
 * The point of the beat is how SHORT the list is. Four documents, named, and
 * then the line that matters more than any of them: two of the four never
 * appear on the public page at all (invariant 7 — certificates and KYC live in
 * private buckets behind short-lived presigned URLs, never a public URL).
 */
function DocumentsScreen({
  reveal,
  docsDone,
  submitted,
  caption,
  ref,
}: ScreenProps & { docsDone: number; submitted: boolean }) {
  return (
    <DeviceFrame caption={caption} busy={reveal < 0.78} ref={ref}>
      <ScreenLabel>Your application</ScreenLabel>
      <div className="flex h-[22px] items-end">
        <Blank ch={18} fill={seg(reveal, 0, 0.16)} />
      </div>

      <ScreenLabel className="mt-1">Documents</ScreenLabel>
      <Plate>
        <div className="relative">
          <span
            aria-hidden="true"
            className="absolute top-3 bottom-3 left-2 w-0.5 origin-top bg-fg-primary will-change-transform"
            style={{ transform: `scaleY(${seg(reveal, 0.13, 0.27).toFixed(3)})` }}
          />
          <ol className="m-0 grid list-none p-0">
            {DOCUMENTS.map((doc, i) => (
              <li
                key={doc}
                className="flex items-center gap-2.5 py-[5px] text-[11.5px] leading-tight font-medium text-fg-primary"
              >
                <Tick done={docsDone > i} />
                <span className="min-w-0 flex-1">{doc}</span>
                <Blank ch={4} fill={seg(reveal, 0.29 + i * 0.067, 0.42 + i * 0.067)} decorative />
              </li>
            ))}
          </ol>
        </div>
        <PlateTotal label="Submitted">
          <Blank ch={6} fill={submitted ? seg(reveal, 0.76, 0.87) : 0} decorative />
        </PlateTotal>
      </Plate>

      <p
        className="m-0 text-[9.5px] leading-snug text-mk-ink"
        style={{ opacity: seg(reveal, 0.85, 0.96) }}
      >
        The certificate and the owner ID sit in private storage. Never a public link.
      </p>
    </DeviceFrame>
  );
}

/** The four checks this specimen gets as far as, abbreviated for a phone. They
 *  are H1–H4 of the register's seven, in the register's order; the full
 *  wording is on the verification sheet a few sections above. */
const REVIEW_ROWS = ['01 Legible and complete', '02 Issuer accepted', '03 Legal name', '04 Premises address'] as const;

/** Exact progress at which each of the first three is marked. The fourth is
 *  never marked — that is the beat. */
const REVIEW_MARKS = [0.22, 0.34, 0.45] as const;
/** …and where the rejection itself is stated. */
const REVIEW_REASON_AT = 0.6;

/**
 * Restaurant 02 — THE REASON CODE. What a rejection actually looks like.
 *
 * The only screen in the journey that ends on a NO, and it is the most
 * important one on this track: "six of seven is a rejection with a reason, not
 * a seal" is the sentence the whole product rests on, and an owner deciding
 * whether to apply deserves to see the shape of the bad outcome.
 *
 * Invariant 9 governs the whole screen. The failed check is a DASH, not a
 * cross; the pill is cool slate, never red. Red reads as *haram* — a religious
 * ruling the platform does not make — and this is a clerical outcome about a
 * piece of paper, not a verdict on a kitchen.
 */
function ReasonScreen({
  reveal,
  checksDone,
  rejected,
  caption,
  ref,
}: ScreenProps & { checksDone: number; rejected: boolean }) {
  return (
    <DeviceFrame caption={caption} busy={reveal < 0.78} ref={ref}>
      <ScreenLabel>Review</ScreenLabel>
      <div className="flex h-[22px] items-end">
        <Blank ch={18} fill={seg(reveal, 0, 0.16)} />
      </div>

      <Plate>
        <div className="relative">
          <span
            aria-hidden="true"
            className="absolute top-3 bottom-3 left-2 w-0.5 origin-top bg-fg-primary will-change-transform"
            style={{ transform: `scaleY(${seg(reveal, 0.09, 0.22).toFixed(3)})` }}
          />
          <ol className="m-0 grid list-none p-0">
            {REVIEW_ROWS.map((row, i) => (
              <li
                key={row}
                className="flex items-center gap-2.5 py-[5px] text-[11.5px] leading-tight font-medium text-fg-primary"
              >
                {i < REVIEW_MARKS.length ? <Tick done={checksDone > i} /> : <NotYet />}
                <span className="min-w-0 flex-1">{row}</span>
              </li>
            ))}
          </ol>
        </div>
        <PlateTotal label="Reason">
          <Blank ch={7} fill={seg(reveal, 0.63, 0.76)} decorative />
        </PlateTotal>
      </Plate>

      {/* Cool slate, the same neutral the expired state uses. Never red. */}
      <div className="flex" style={{ opacity: rejected ? 1 : 0 }} aria-hidden={!rejected}>
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-mk-expired-bg px-2.5 py-1.5 text-[11.5px] leading-none font-semibold text-mk-expired-fg">
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" className="block">
            <path d={HALAL_SHIELD_D} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          </svg>
          Not passed
        </span>
      </div>

      <p className="m-0 text-[11px] leading-snug text-mk-ink" style={{ opacity: seg(reveal, 0.67, 0.8) }}>
        Check 04 — the premises address on the certificate.
      </p>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10.5px] leading-none text-fg-secondary">What to send instead</span>
        <Blank ch={16} fill={seg(reveal, 0.83, 0.96)} />
      </div>
    </DeviceFrame>
  );
}

/**
 * Restaurant 03 — LIVE AT 0% COMMISSION. The listing, from the owner's side.
 *
 * The badge arrives first here and not last, which is the opposite of the
 * customer's record beat — and correct for this reader. An owner has already
 * been shown the review; what they are waiting to see is the page going live
 * and the money that follows from it.
 *
 * The two printed figures are the only real values: 0% is `MONEY`'s
 * commission at launch, and Monday is `MONEY`'s payout day. Both are settled
 * decisions (S-01, S-04). Everything a real week would put here — orders,
 * amounts — is withheld, because we have not opened.
 */
function ListingScreen({ reveal, certified, caption, ref }: ScreenProps & { certified: boolean }) {
  const provenance = seg(reveal, 0.31, 0.45);

  return (
    <DeviceFrame caption={caption} busy={reveal < 0.78} ref={ref}>
      <ScreenLabel>Your listing</ScreenLabel>
      <div className="flex h-[22px] items-end">
        <Blank ch={18} fill={seg(reveal, 0, 0.16)} />
      </div>

      <div className="flex flex-col items-start gap-2.5 rounded-xl bg-mk-seal-plate p-3.5">
        <SealBadge shown={certified} />
        <span className="flex items-baseline gap-2 text-[11px] leading-snug text-mk-ink">
          Verified on
          <Blank ch={9} fill={seg(reveal, 0.2, 0.34)} />
        </span>
        {/* Fixed copy, whole. It is the standing disclaimer and it is not
            reworded or trimmed to fit a phone mock. */}
        <p className="m-0 text-[9.5px] leading-snug text-mk-ink" style={{ opacity: provenance }}>
          {DISCLAIMER}
        </p>
      </div>

      <ScreenLabel className="mt-1">This week</ScreenLabel>
      <Plate>
        <DevRow label="Orders">
          <Blank ch={4} fill={seg(reveal, 0.51, 0.63)} decorative />
        </DevRow>
        <DevRow label="Commission">
          <b className="text-[12px] leading-none font-bold text-fg-primary" style={{ opacity: seg(reveal, 0.58, 0.69) }}>
            {MONEY.commissionAtLaunch}
          </b>
        </DevRow>
        <PlateTotal label={`Paid ${MONEY.payoutDay}`}>
          <Blank ch={6} fill={seg(reveal, 0.78, 0.92)} decorative />
        </PlateTotal>
      </Plate>
    </DeviceFrame>
  );
}

/* ── the rider's two extra screens ──────────────────────────────────────── */

/**
 * Rider 01 — THE FEE. The offer, priced in front of them.
 *
 * The badge is on this screen for one reason: a rider's first question about a
 * pickup is where it is, and this platform's answer includes that the kitchen
 * was read before the offer ever reached them. The fee is the beat, but the
 * seal is why the fee is on this app and not another.
 *
 * `$2.99` and `$1.00` are `MONEY`'s settled numbers (S-02). The distance, the
 * tip and the total are blanks — they belong to an order, and there are no
 * orders yet.
 */
function FeeScreen({ reveal, certified, caption, ref }: ScreenProps & { certified: boolean }) {
  return (
    <DeviceFrame caption={caption} busy={reveal < 0.78} ref={ref}>
      <ScreenLabel>Pickup</ScreenLabel>
      <div className="flex h-[22px] items-end">
        <Blank ch={18} fill={seg(reveal, 0, 0.16)} />
      </div>

      <div className="flex items-start rounded-xl bg-mk-seal-plate p-3">
        <SealBadge shown={certified} />
      </div>

      <Plate>
        <DevRow label="Delivery, base">
          <b className="text-[12px] leading-none font-bold text-fg-primary" style={{ opacity: seg(reveal, 0.22, 0.34) }}>
            {MONEY.deliveryBase}
          </b>
        </DevRow>
        <DevRow label="Per kilometre">
          <b className="text-[12px] leading-none font-bold text-fg-primary" style={{ opacity: seg(reveal, 0.31, 0.42) }}>
            {MONEY.deliveryPerKm}
          </b>
        </DevRow>
        <DevRow label="Distance">
          <Blank ch={5} fill={seg(reveal, 0.45, 0.56)} decorative />
        </DevRow>
        <DevRow label="Tip">
          <Blank ch={5} fill={seg(reveal, 0.54, 0.65)} decorative />
        </DevRow>
        <PlateTotal label="To you">
          <Blank ch={7} fill={seg(reveal, 0.69, 0.83)} decorative />
        </PlateTotal>
      </Plate>

      <p className="m-0 text-[10px] leading-snug text-mk-ink" style={{ opacity: seg(reveal, 0.85, 0.96) }}>
        {MONEY.deliveryFeeToRider} of the delivery fee and {MONEY.tipToRider} of the tip reach you. We take neither.
      </p>
    </DeviceFrame>
  );
}

/**
 * Rider 04 — MONDAY. The week, closed.
 *
 * The last beat on the rider track, and the quietest on purpose: no badge, no
 * scan, no arrival — a statement and a date. `MONEY` settles both figures and
 * the day (S-03, S-04, I-13.5). "No minimum payout" is the rider track's own
 * reassurance copy, not a new promise.
 */
function PayoutScreen({ reveal, paid, caption, ref }: ScreenProps & { paid: boolean }) {
  return (
    <DeviceFrame caption={caption} busy={reveal < 0.83} ref={ref}>
      <ScreenLabel>Earnings · week of</ScreenLabel>
      <div className="flex h-[22px] items-end">
        <Blank ch={16} fill={seg(reveal, 0, 0.16)} />
      </div>

      <Plate>
        <DevRow label="Deliveries">
          <Blank ch={4} fill={seg(reveal, 0.21, 0.34)} decorative />
        </DevRow>
        <DevRow label="Delivery fees">
          <Blank ch={7} fill={seg(reveal, 0.32, 0.46)} decorative />
        </DevRow>
        <DevRow label="Tips">
          <Blank ch={7} fill={seg(reveal, 0.43, 0.57)} decorative />
        </DevRow>
        <PlateTotal label={`Paid ${MONEY.payoutDay}`}>
          <Blank ch={7} fill={paid ? seg(reveal, 0.69, 0.85) : 0} decorative />
        </PlateTotal>
      </Plate>

      <div className="flex flex-col gap-1.5 rounded-xl bg-mk-seal-plate p-3.5">
        <b
          className="text-[12px] leading-snug font-bold text-fg-primary"
          style={{ opacity: seg(reveal, 0.85, 0.96) }}
        >
          {MONEY.deliveryFeeToRider} of the fee. {MONEY.tipToRider} of the tip.
        </b>
        <span className="text-[10.5px] leading-snug text-mk-ink">No minimum payout, and nothing to claim.</span>
      </div>
    </DeviceFrame>
  );
}

/* ── one chapter ────────────────────────────────────────────────────────── */

/** Where in `TrackPage`'s argued section order a chapter is spliced. */
export type ChapterSlot = 'verification' | 'sealed' | 'steps';

type ChapterDef = {
  id: string;
  /** Published as `data-beat-name`; the pacing harness names it in its output. */
  name: string;
  at: ChapterSlot;
  /** 300 is the floor for a device-led beat. Below 250 a small scroll runs the
   *  whole animation to completion and nobody sees the middle of it. */
  vh: number;
  heading: string;
  /** Set flat beneath the handset, outside the perspective transform. */
  caption: string;
  pose: keyof typeof POSES;
  /** `exact` owns everything counted, `reveal` (damped) everything continuous. */
  screen: (p: { reveal: number; exact: number; caption: string; ref: Ref<HTMLDivElement> }) => ReactNode;
};

/**
 * The pinned stage of one chapter: the index, the heading, the handset, the
 * caption and the rule under it.
 *
 * A component rather than markup inside the render prop because the handset's
 * transform needs a ref and a layout effect, and a render prop cannot hold a
 * hook.
 *
 * Nothing but the handset moves on the approach: the index and the heading are
 * simply present, which is the cheapest possible guarantee that the beat is not
 * blank when it pins.
 */
function ChapterStage({
  chapter,
  step,
  total,
  reveal,
  exact,
  entrance,
  reducedMotion,
}: {
  chapter: ChapterDef;
  step: number;
  total: number;
  reveal: number;
  exact: number;
  entrance: number;
  reducedMotion: boolean;
}) {
  const ref = useHandset(POSES[chapter.pose], entrance, reducedMotion);
  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    // `text-center` deliberately does NOT go on this wrapper. A device screen
    // is a document — labels, rows and a disclaimer, all ranged left — and a
    // centred ancestor silently re-set every line of it. The two pieces of
    // chapter furniture centre themselves instead.
    <div className="mx-auto flex w-full max-w-[1280px] flex-col items-center px-5 lg:px-14">
      <p className="m-0 text-center font-mono text-[11px] leading-none tracking-[0.14em] text-mk-ink uppercase">
        Step {pad(step)} of {pad(total)}
      </p>
      <h2
        id={`${chapter.id}-heading`}
        className="mt-2.5 mb-0 text-center font-display text-heading-xl text-fg-primary lg:text-display-md"
      >
        {chapter.heading}
      </h2>

      <div className="mt-[clamp(18px,3.4vh,34px)] flex justify-center">
        {chapter.screen({ reveal, exact, caption: chapter.caption, ref })}
      </div>

      {/* The rule under the caption. A chapter ends with a mark on the page, so
          the next one reads as a new one rather than as more of this one. */}
      <span aria-hidden="true" className="mt-3.5 block h-px w-14 bg-line-decorative" />
    </div>
  );
}

function Chapter({ chapter, step, total }: { chapter: ChapterDef; step: number; total: number }) {
  return (
    <Beat id={chapter.id} name={chapter.name} vh={chapter.vh} labelledBy={`${chapter.id}-heading`}>
      {(p) => (
        <ChapterStage
          chapter={chapter}
          step={step}
          total={total}
          reveal={p.pDamped}
          exact={p.pExact}
          // The arrival, on the approach clock, finished as the beat pins.
          // `p.seg` is already smoothstepped here — the prototype's
          // `smooth(seg(...))` would ease it twice and go slack at both ends.
          entrance={p.seg(p.dIn, 0, 0.88)}
          reducedMotion={p.reducedMotion}
        />
      )}
    </Beat>
  );
}

/* ── the three tracks ───────────────────────────────────────────────────── */

const CHAPTERS: Record<Audience, readonly ChapterDef[]> = {
  /**
   * The customer's chain, end to end: the record that let the kitchen on the
   * list, the seal that binds the bag to one order, and the trail to the door.
   */
  customer: [
    {
      id: 'j-record',
      name: '02 · 01 THE RECORD',
      at: 'verification',
      vh: 320,
      heading: 'The record',
      caption: '01 · The record',
      pose: 'right',
      screen: ({ reveal, exact, caption, ref }) => (
        <RecordScreen reveal={reveal} certified={exact > RECORD_BADGE_AT} caption={caption} ref={ref} />
      ),
    },
    {
      id: 'j-sealed',
      name: '03 · 02 SEALED',
      at: 'sealed',
      vh: 320,
      heading: 'Sealed at the kitchen',
      caption: '02 · Sealed at the kitchen',
      pose: 'near',
      screen: ({ reveal, exact, caption, ref }) => (
        <SealedScreen reveal={reveal} scanned={exact > SEALED_SCAN_AT} caption={caption} ref={ref} />
      ),
    },
    {
      id: 'j-door',
      name: '04 · 03 AT YOUR DOOR',
      at: 'steps',
      vh: 340,
      heading: 'At your door',
      caption: '03 · At your door',
      pose: 'left',
      screen: ({ reveal, exact, caption, ref }) => (
        <DoorScreen
          reveal={reveal}
          stepsDone={DOOR_STEP_MARKS.filter((m) => exact >= m).length}
          caption={caption}
          ref={ref}
        />
      ),
    },
  ],

  /**
   * The owner's chain stops at their own counter. There is no Sealed chapter
   * for the same reason there is no Sealed section: the seal binds as they
   * finish packing, but what happens to the bag afterwards is the customer's
   * argument and the rider's, not theirs.
   *
   * The first two sit together at the verification block, because both are
   * about the reading: what you send, and what happens when one of the seven
   * does not pass. The third sits at the steps, whose own third step is going
   * live.
   */
  restaurant: [
    {
      id: 'j-documents',
      name: '02 · 01 FOUR DOCUMENTS',
      at: 'verification',
      vh: 320,
      heading: 'Four documents',
      caption: '01 · Licence · halal certificate · food-safety permit · owner ID',
      pose: 'right',
      screen: ({ reveal, exact, caption, ref }) => (
        <DocumentsScreen
          reveal={reveal}
          docsDone={DOC_MARKS.filter((m) => exact >= m).length}
          submitted={exact >= DOC_SUBMITTED_AT}
          caption={caption}
          ref={ref}
        />
      ),
    },
    {
      id: 'j-reason',
      name: '03 · 02 THE REASON CODE',
      at: 'verification',
      vh: 320,
      heading: 'The reason code',
      caption: '02 · Six of seven is a rejection, not a seal',
      pose: 'near',
      screen: ({ reveal, exact, caption, ref }) => (
        <ReasonScreen
          reveal={reveal}
          checksDone={REVIEW_MARKS.filter((m) => exact >= m).length}
          rejected={exact >= REVIEW_REASON_AT}
          caption={caption}
          ref={ref}
        />
      ),
    },
    {
      id: 'j-listing',
      name: '04 · 03 LIVE AT 0%',
      at: 'steps',
      vh: 340,
      heading: 'Live at 0% commission',
      caption: '03 · Live at 0% commission',
      pose: 'left',
      screen: ({ reveal, exact, caption, ref }) => (
        <ListingScreen reveal={reveal} certified={exact > RECORD_BADGE_AT} caption={caption} ref={ref} />
      ),
    },
  ],

  /**
   * Four, because the rider's journey has a fourth thing in it that neither of
   * the others does: the money arriving. The two scans sit together after the
   * Sealed section, which is where the chain they belong to is written out.
   */
  rider: [
    {
      id: 'j-fee',
      name: '02 · 01 THE FEE',
      at: 'verification',
      vh: 320,
      heading: 'The fee',
      caption: '01 · The fee',
      pose: 'right',
      screen: ({ reveal, exact, caption, ref }) => (
        <FeeScreen reveal={reveal} certified={exact > RECORD_BADGE_AT} caption={caption} ref={ref} />
      ),
    },
    {
      id: 'j-pickup',
      name: '03 · 02 AT PICKUP',
      at: 'sealed',
      vh: 320,
      heading: 'The scan at pickup',
      caption: '02 · Each code works once',
      pose: 'near',
      screen: ({ reveal, exact, caption, ref }) => (
        <SealedScreen reveal={reveal} scanned={exact > SEALED_SCAN_AT} caption={caption} ref={ref} />
      ),
    },
    {
      id: 'j-handover',
      name: '04 · 03 AT THE DOOR',
      at: 'sealed',
      vh: 300,
      heading: 'The scan at the door',
      caption: '03 · Scanned at the door',
      pose: 'left',
      screen: ({ reveal, exact, caption, ref }) => (
        <DoorScreen
          reveal={reveal}
          stepsDone={DOOR_STEP_MARKS.filter((m) => exact >= m).length}
          caption={caption}
          ref={ref}
        />
      ),
    },
    {
      id: 'j-monday',
      name: '05 · 04 MONDAY',
      at: 'steps',
      vh: 340,
      heading: 'Monday',
      caption: '04 · Every Monday, automatically',
      pose: 'right',
      screen: ({ reveal, exact, caption, ref }) => (
        <PayoutScreen reveal={reveal} paid={exact >= 0.69} caption={caption} ref={ref} />
      ),
    },
  ],
};

/**
 * The chapters this track has at this point in the page.
 *
 * `TrackPage` marks the three insertion points and asks; the answer is often
 * nothing (the restaurant track has no `sealed` slot at all, because it has no
 * Sealed section) and sometimes two, which is how the prototype's rider page
 * runs the pickup and the door back to back.
 */
export function JourneyChapters({ audience, at }: { audience: Audience; at: ChapterSlot }) {
  const all = CHAPTERS[audience];
  const here = all.filter((chapter) => chapter.at === at);
  if (here.length === 0) return null;

  return (
    <>
      {here.map((chapter) => (
        <Chapter key={chapter.id} chapter={chapter} step={all.indexOf(chapter) + 1} total={all.length} />
      ))}
    </>
  );
}
