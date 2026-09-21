import { HALAL_SHIELD_D } from '@/components/Seal';
import { type HalalState } from '@/lib/claims';

/**
 * The certification record, as a designed artifact. Ported from the Astro site.
 *
 * This is the brand lockup: the seal NEVER appears without the record beneath
 * it. A seal on its own is the placebo badge this category is already drowning
 * in — the record is the whole difference, so the two ship together or not at
 * all.
 *
 * Four states, and only four, mirroring the product's halal enum:
 *   certified — emerald seal + brass ring. The only filled solid green here.
 *   expired   — cool slate. NEVER red: red reads as *haram*, a religious ruling
 *               this platform does not make (invariant 9). Expired means our
 *               knowledge has lapsed, not that anything is wrong with the food.
 *   review    — outlined slate, no fill. Paperwork in, checking not finished.
 *   none      — NO BADGE AT ALL. Not a greyed shield, not a neutral chip: an
 *               empty hairline square (invariant 8 — a missing halal field
 *               renders no badge, never an optimistic one).
 *
 * `specimen` renders the shape of the record with its identifying values left as
 * ruled blanks. It exists so a section can show what we keep on file without
 * inventing a restaurant, a certificate number or an admin's name. On launch day
 * this takes real props and the caption is deleted — a data change, not a design
 * change.
 */

const STATUS_LABEL: Record<HalalState, string> = {
  certified: 'Halal certified',
  expired: 'Certificate expired',
  review: 'Under review',
  none: 'No record',
};

/** Ruled blanks are sized in characters so a row of them reads as a form with
 *  the values omitted, rather than as a row of identical placeholder bars. */
type Field = { label: string; value?: string; blank: number; prose?: boolean };

function RecordLine({ label, value, blank, prose }: Field) {
  return (
    <div className="flex items-baseline gap-4 py-[7px]">
      <dt className="w-[86px] flex-none font-mono text-[10.5px] leading-snug font-medium tracking-[0.06em] text-mk-ink uppercase">
        {label}
      </dt>
      <dd className="m-0 min-w-0 flex-1">
        {value ? (
          <span
            className={
              prose
                ? 'text-body-sm leading-snug text-mk-ink'
                : 'text-[13.5px] leading-snug font-semibold text-fg-primary'
            }
          >
            {value}
          </span>
        ) : (
          <span
            role="img"
            aria-label="not yet published"
            className="inline-block border-t border-dashed border-line-interactive align-[0.32em] opacity-60"
            style={{ width: `${blank}ch`, maxWidth: '100%' }}
          />
        )}
      </dd>
    </div>
  );
}

function StateMark({ state }: { state: HalalState }) {
  if (state === 'certified') {
    return (
      <span className="grid size-9 flex-none place-items-center rounded-sm bg-mk-seal shadow-[inset_0_0_0_2px_var(--hg-mk-seal-ring)]">
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" className="block">
          <path d={HALAL_SHIELD_D} fill="var(--hg-mk-on-seal)" />
          <path
            d="m8 12.1 2.7 2.7L16.2 9"
            fill="none"
            stroke="var(--hg-mk-seal)"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }

  // Expired: cool slate. The whole point of this colour is that it is not red.
  if (state === 'expired') {
    return <span aria-hidden="true" className="size-9 flex-none rounded-sm bg-mk-expired-bg" />;
  }

  // Under review: outline only — paperwork received, nothing vouched for yet.
  if (state === 'review') {
    return (
      <span
        aria-hidden="true"
        className="size-9 flex-none rounded-sm opacity-60 shadow-[inset_0_0_0_1.5px_var(--hg-mk-expired-bg)]"
      />
    );
  }

  // No record: renders NO badge. An empty hairline square is the honest mark.
  return <span aria-hidden="true" className="size-9 flex-none rounded-sm shadow-[inset_0_0_0_1px_var(--hg-border-decorative)]" />;
}

export function RecordCard({
  state = 'certified',
  specimen = false,
  caption,
  kitchen,
  city,
  issuer,
  certNumber,
  scope,
  inForceTo,
  checkedBy,
  reviews,
  footnote,
  className = '',
}: {
  state?: HalalState;
  specimen?: boolean;
  caption?: string;
  kitchen?: string;
  city?: string;
  issuer?: string;
  certNumber?: string;
  scope?: string;
  inForceTo?: string;
  checkedBy?: string;
  reviews?: string;
  footnote?: string;
  className?: string;
}) {
  const kitchenValue = specimen ? undefined : kitchen && city ? `${kitchen} · ${city}` : kitchen;
  const muted = state === 'none' || state === 'review';

  return (
    // Paper on a table, not app chrome floating on a gradient: opaque surface,
    // one hairline, one shadow level. No blur, no glass, no top highlight.
    <article
      className={`box-border max-w-[420px] rounded-2xl border border-line-decorative bg-surface-raised p-7 shadow-sm ${className}`}
    >
      {caption ? (
        <p className="m-0 mb-[18px] font-mono text-[10.5px] leading-relaxed font-medium tracking-[0.085em] text-mk-ink uppercase">
          {caption}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <StateMark state={state} />
        <span
          className={`text-body-lg font-extrabold tracking-[-0.01em] ${muted ? 'text-mk-ink' : 'text-fg-primary'}`}
        >
          {STATUS_LABEL[state]}
        </span>
      </div>

      <hr className="my-4 border-0 border-t border-line-decorative" />

      <dl className="m-0 grid">
        <RecordLine label="Kitchen" value={kitchenValue} blank={22} />
        <RecordLine label="Issued by" value={issuer} blank={20} />
        <RecordLine label="Certificate" value={specimen ? undefined : certNumber} blank={14} />
        <RecordLine label="Scope" value={specimen ? undefined : scope} blank={18} />
        <RecordLine label="In force to" value={specimen ? undefined : inForceTo} blank={11} />
        <RecordLine label="Checked by" value={specimen ? undefined : checkedBy} blank={16} />
      </dl>

      {reviews ? (
        <>
          <hr className="my-4 border-0 border-t border-line-decorative" />
          <dl className="m-0 grid">
            <RecordLine label="Reviews" value={reviews} blank={20} prose />
          </dl>
        </>
      ) : null}

      {footnote ? (
        <>
          <hr className="my-4 border-0 border-t border-line-decorative" />
          <p className="m-0 max-w-[52ch] text-body-sm leading-relaxed text-mk-ink">{footnote}</p>
        </>
      ) : null}
    </article>
  );
}
