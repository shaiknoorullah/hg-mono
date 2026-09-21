'use client';

import { Beat } from '@/components/journey/Beat';
import type { Audience } from '@/lib/audiences';

/**
 * THE JOURNEY — the index card that opens the scroll journey.
 *
 * Ported from the G3 prototype's `overture` beat. It announces the movement:
 * after this the handsets take over, and a reader who scrolls past a device
 * chapter still knows how many are left and what they are.
 *
 * WHAT IS NOT HERE. The prototype fanned three MINI handsets beside the type.
 * They are dropped, deliberately: the mini deck is a fourth, smaller rendering
 * of the same three screens the chapters render at full size a few sections
 * later, and G3's restraint is the point of the direction. What the beat keeps
 * is its job — naming the steps — which is the type, not the deck.
 *
 * THE TWO CLOCKS, which is the whole structure of this file:
 *   - The eyebrow, the heading and the lede are FURNITURE. They arrive on the
 *     approach clock (`p.dIn`) and are therefore finished, whole and still at
 *     the moment the beat pins.
 *   - The numbered contents list is the NARRATIVE. It lights row by row on the
 *     pinned clocks, which is what the pin is being held for. A beat with
 *     nothing on a pinned clock is a viewport of frozen scroll.
 *
 * Every string below is already on the page elsewhere — the steps come from
 * `audiences.ts`, and the money and the seal behind them from `claims.ts`.
 * This beat names them; it does not make a new claim.
 */

type OvertureCopy = {
  /** Set as lines rather than one string: the display face is being broken on
   *  purpose, and where it breaks is a typographic decision, not a reflow. */
  heading: readonly string[];
  lede: string;
  /** The chapters, in order, and the labels must match `Chapters.tsx`. */
  index: readonly string[];
};

const OVERTURE: Record<Audience, OvertureCopy> = {
  customer: {
    heading: ['From the', 'certificate', 'to your door.'],
    lede: 'Three steps. Each one is shown to you in the app as it happens.',
    index: ['The record', 'Sealed at the kitchen', 'At your door'],
  },
  restaurant: {
    heading: ['From your', 'certificate', 'to your first order.'],
    lede: 'Three steps. You send the documents; the reading is ours to do.',
    index: ['Four documents', 'Seven checks, or a reason', 'Live at 0% commission'],
  },
  rider: {
    heading: ['From the', 'offer to', 'Monday.'],
    lede: 'Four beats to a delivery, and you can see the money in every one of them.',
    index: ['The fee', 'The scan at pickup', 'The scan at the door', 'Paid on Monday'],
  },
};

/**
 * Where the first row starts and the last row finishes lighting.
 *
 * Both are at the edges on purpose. The pinned clock is already DWELLED — its
 * first and last fifth of raw scroll are held still by construction, so that a
 * reader can stop and read something that is not still moving. A narrative that
 * then starts at 0.12 and stops at 0.87 holds a second time on top of the
 * dwell, and the two holds compound: a pacing pass measured 0.90 of a viewport
 * frozen at each end of this 300vh beat. The dwell is the hold. The narrative
 * spends the rest.
 */
const NARRATIVE_START = 0.02;
const NARRATIVE_END = 0.97;

export function Overture({ audience }: { audience: Audience }) {
  const copy = OVERTURE[audience];
  // The rows divide the narrative between them, so three rows and four rows
  // both finish in the same place rather than the rider's list running late.
  const span = (NARRATIVE_END - NARRATIVE_START) / copy.index.length;

  return (
    <Beat
      id="overture"
      name="01 THE JOURNEY"
      vh={300}
      labelledBy="overture-heading"
      // The sunken panel is the prototype's band, inset by the page's own
      // gutter rather than bled to the window: nothing else on this site
      // escapes the 1280px box, and one section that did would read as a
      // mistake rather than as emphasis.
      className="mt-16 rounded-3xl bg-surface-sunken lg:mt-24"
    >
      {(p) => {
        // Furniture. Finished as the beat pins — see the note above.
        const eyebrow = p.seg(p.dIn, 0, 0.34);
        const heading = p.seg(p.dIn, 0.12, 0.66);
        const lede = p.seg(p.dIn, 0.42, 0.9);

        return (
          <div className="mx-auto w-full px-5 py-10 lg:grid lg:grid-cols-[1fr_360px] lg:items-end lg:gap-16 lg:px-12">
            <div>
              <p
                className="m-0 font-mono text-marketing-eyebrow-phone text-mk-ink uppercase lg:text-marketing-eyebrow"
                style={{ opacity: eyebrow }}
              >
                The journey
              </p>

              <h2
                id="overture-heading"
                className="mt-3 mb-0 font-display text-marketing-section-phone text-fg-primary lg:mt-4 lg:text-marketing-section"
                style={{ opacity: heading, transform: `translateY(${((1 - heading) * 14).toFixed(2)}px)` }}
              >
                {/* Each line is a block, so the authored break holds where
                    there is room and the browser re-wraps it where there is
                    not — rather than a <br> forcing a ragged line on a phone. */}
                {copy.heading.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </h2>

              <p
                className="mt-5 mb-0 max-w-[36ch] text-marketing-lede-phone text-mk-ink lg:text-marketing-lede"
                style={{ opacity: lede, transform: `translateY(${((1 - lede) * 10).toFixed(2)}px)` }}
              >
                {copy.lede}
              </p>
            </div>

            {/* The narrative. Rows are readable from the first frame — they are
                contents, not a reveal — and brighten as the reader arrives at
                each one. */}
            <ol className="mt-10 grid list-none p-0 lg:mt-0">
              {copy.index.map((label, i) => {
                const from = NARRATIVE_START + i * span;
                const to = from + span * 0.9;
                // Continuous: damped, so the brightening does not step.
                const k = p.seg(p.pDamped, from, to);
                // Discrete: exact, so the ink flip happens once and where the
                // reader is, not where a settling damped value happens to be.
                const lit = p.pExact >= to;

                return (
                  <li
                    key={label}
                    aria-current={lit ? 'step' : undefined}
                    className="flex items-baseline gap-3 border-t border-line-decorative py-3 font-mono text-[12px] leading-snug tracking-[0.04em] last:border-b lg:py-3.5"
                    style={{ opacity: (0.34 + 0.66 * k).toFixed(3) }}
                  >
                    <b
                      className={`font-medium tabular-nums ${lit ? 'text-fg-primary' : 'text-mk-ink'}`}
                    >
                      {String(i + 1).padStart(2, '0')}
                    </b>
                    <span className="text-mk-ink">{label}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        );
      }}
    </Beat>
  );
}
