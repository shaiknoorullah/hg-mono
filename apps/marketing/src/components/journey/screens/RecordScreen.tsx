import { HALAL_SHIELD_D } from '@/components/Seal';
import { DISCLAIMER, ISSUERS, STATES } from '@/lib/claims';
import { Blank, DeviceFrame, ScreenLabel, seg, type ScreenProps } from './DeviceFrame';

/**
 * Beat 01 — THE RECORD. A listing writing itself.
 *
 * Ported from the G3 prototype's j01 chapter. The narrative is deliberately in
 * this order: the restaurant's name arrives, THEN the badge, THEN what the
 * badge rests on. A seal that appeared first would be the placebo badge this
 * category is already full of; here it is visibly the outcome of a record.
 *
 * Every field is a ruled blank except one. The issuer's name is printed in
 * full, verbatim from the claims register, because naming the certifying body
 * is the product's actual position — we do not stand in front of the issuer
 * with a badge of our own, and a specimen that hid the issuer would misstate
 * the thing this beat is about. It is the only real value on any of the three
 * screens.
 *
 * Invariant 8 holds at reveal 0: the frame, the labels and the plate are
 * present, and there is no badge. The badge is never rendered optimistically
 * ahead of the record it summarises.
 */

/**
 * Exact progress at which the badge appears. Discrete, so the engine compares
 * EXACT progress against it — never the damped value, which would land the
 * badge after the reader has already scrolled past the moment it belongs to.
 * It appears; it never pulses, shimmers or draws itself.
 */
export const RECORD_BADGE_AT = 0.12;

/** Fixed copy, and it lives in the register: "Halal certified". Not "Halal",
 *  not "100% Halal", not "Verified halal" (claims.ts STATES, C-12 R7). */
const CERTIFIED_LABEL = STATES.find((s) => s.state === 'certified')?.label;

/** One accepted body, named in full. The registry is not a ranking — this is
 *  the same body the record-card specimen names, for the same reason. */
const ISSUER = ISSUERS[0];

/** Menu rows: two dishes, each a name and a price, all four withheld. */
const MENU_ROWS = [
  { id: 'a', name: 15, price: 5 },
  { id: 'b', name: 17, price: 5 },
] as const;

export function RecordScreen({
  reveal,
  certified,
  caption,
  ref,
  className,
}: ScreenProps & {
  /** Driven from EXACT progress against RECORD_BADGE_AT. */
  certified: boolean;
}) {
  // The disclaimer and the issuer arrive together, after the badge: the badge
  // is meaningless until the page says who issued the certificate and that we
  // are not the ones certifying it.
  const provenance = seg(reveal, 0.37, 0.52);

  return (
    <DeviceFrame caption={caption} busy={reveal < 0.74} ref={ref} className={className}>
      <ScreenLabel>Restaurant</ScreenLabel>
      <div className="flex h-[22px] items-end">
        <Blank ch={18} fill={seg(reveal, 0, 0.17)} />
      </div>

      {/* The plate is present from the first frame; only its contents arrive.
          A plate that appeared with the badge would make the beat blank at the
          pin, which is the defect this whole structure exists to prevent. */}
      <div className="flex flex-col items-start gap-2.5 rounded-xl bg-mk-seal-plate p-3.5">
        {/* Solid green, with its brass ring — the one filled green on the page,
            and it is the halal seal (invariant 10). */}
        <span
          className="inline-flex rounded-2xl border-[1.5px] border-mk-seal-ring p-0.5 transition-opacity duration-200"
          style={{ opacity: certified ? 1 : 0 }}
          aria-hidden={!certified}
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

        <span className="flex items-baseline gap-2 text-[11px] leading-snug text-mk-ink">
          Valid until
          <Blank ch={9} fill={seg(reveal, 0.25, 0.39)} />
        </span>

        <div className="flex flex-col gap-1" style={{ opacity: provenance }}>
          <span className="text-[10px] leading-none text-fg-secondary">Issued by</span>
          <span className="text-[11px] leading-snug font-semibold text-fg-primary">{ISSUER.name}</span>
        </div>

        {/* Fixed copy, whole. It is the standing disclaimer and it is not
            reworded or trimmed to fit a phone mock. */}
        <p className="m-0 text-[9.5px] leading-snug text-mk-ink" style={{ opacity: provenance }}>
          {DISCLAIMER}
        </p>
      </div>

      <ScreenLabel className="mt-1.5">Menu</ScreenLabel>
      {MENU_ROWS.map((row, i) => (
        <div key={row.id} className="flex h-[18px] items-center justify-between gap-2">
          <Blank ch={row.name} fill={seg(reveal, 0.57 + i * 0.15, 0.74 + i * 0.15)} decorative />
          <Blank ch={row.price} fill={seg(reveal, 0.63 + i * 0.15, 0.81 + i * 0.15)} decorative />
        </div>
      ))}
    </DeviceFrame>
  );
}
