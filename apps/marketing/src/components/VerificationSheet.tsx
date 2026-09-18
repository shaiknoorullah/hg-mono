import { StampSeal } from '@/components/Seal';

/**
 * Exhibit A — the verification sheet, ported from artboard V.
 *
 * The argument of the whole site is in this section: the seal is the OUTPUT of a
 * form somebody filled in, not a graphic somebody chose. So the section is drawn
 * as the form — square corners, double rule, mono document furniture — sitting
 * on the warm page, and every row is the spec's real check with the spec's real
 * reviewer/system split (docs/spec/05-admin.md H1–H7).
 *
 * Nothing here is illustrative. The two rows marked NO OVERRIDE are hard-computed
 * in the spec, the registry really is seeded-and-extensible rather than a closed
 * list, and the lapse rule really does run at end of day America/Toronto.
 */

type Row = { n: string; text: string; by: string };

const SCHEDULE_A: readonly Row[] = [
  { n: '01', text: 'Certificate legible and complete', by: 'Reviewer' },
  { n: '02', text: 'Issuing body on our accepted registry', by: 'System · reviewer confirms' },
  { n: '03', text: 'Legal name matches the restaurant', by: 'System · reviewer confirms' },
  { n: '04', text: 'Premises address matches the certificate', by: 'System · reviewer decides' },
  { n: '05', text: 'Dates valid today, not about to lapse', by: 'System · no override' },
  { n: '06', text: 'Scope covers everything sold here', by: 'Reviewer' },
  { n: '07', text: 'Certificate not reused by another restaurant', by: 'System · no override' },
];

const ISSUERS = [
  { abbr: 'HMA', sub: 'Canada', size: 'text-[14px]' },
  { abbr: 'HFSAA', sub: null, size: 'text-[12.5px] tracking-[0.02em]' },
  { abbr: 'ISNA', sub: 'Canada', size: 'text-[14px]' },
] as const;

/* Document furniture: mono, tracked, small. Used for every label on the sheet so
   the form reads as a form rather than as a styled marketing list. */
const FURNITURE = 'font-mono text-[11px] leading-none font-medium tracking-[0.06em] text-accent-600 uppercase';
const SCHEDULE_HEAD = 'm-0 font-mono text-[12px] leading-none font-semibold tracking-[0.1em] text-fg-primary uppercase';
const RULE = 'border-fg-primary';

function PassMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" role="img" aria-label="Passed" className="block flex-none">
      <rect x="0.75" y="0.75" width="16.5" height="16.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <path
        d="M4.5 9.3l3 3 6-6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function VerificationSheet() {
  return (
    <section id="seven-checks" className="mt-16 scroll-mt-6 md:mt-24">
      <div className="md:grid md:grid-cols-[1fr_440px] md:items-end md:gap-16">
        <div>
          <p className="m-0 inline-block rounded-full bg-feedback-success-tint px-3 py-2 text-marketing-eyebrow-phone text-accent-600 uppercase md:px-3.5 md:py-2.5 md:text-marketing-eyebrow">
            What verified means
          </p>
          <h2 className="mt-4 mb-0 max-w-[700px] font-display text-marketing-section-phone text-fg-primary md:mt-[18px] md:text-marketing-section">
            Verified is a record,
            <br />
            not a promise.
          </h2>
        </div>
        <p className="mt-4 mb-0 text-body-lg leading-relaxed text-accent-600 md:mt-0 md:mb-1.5 md:text-[19px]">
          Before a restaurant can appear on Halal Goes, a reviewer reads its halal certificate and records
          seven checks against it. This is the sheet they fill in. Nothing on it is inferred, scanned or
          auto-approved.
        </p>
      </div>

      {/* The hinge: the first monospace on the page, on the cream, just above the
          sheet — so the shift from marketing voice to document voice is visible
          before the document arrives. */}
      <p className="mt-6 mb-0 flex items-center gap-3 font-mono text-[10px] leading-tight font-medium tracking-[0.08em] text-accent-600 uppercase md:mt-[30px] md:text-[11px] md:leading-none">
        <span aria-hidden="true" className="hidden h-px w-7 flex-none bg-fg-primary md:block" />
        Exhibit A — the verification sheet, as a reviewer sees it · specimen, no restaurant named
      </p>

      {/* Double rule: a 1px border plus a 1px outline offset 4px. Square corners
          everywhere inside — the only square corners on the site. */}
      <section
        aria-label="Form HG-7, certificate of halal verification, specimen"
        className="mt-2 box-border border border-fg-primary bg-surface-raised px-4 py-5 outline outline-fg-primary outline-offset-4 md:mt-3.5 md:px-8 md:pt-[22px] md:pb-5"
      >
        <div className={`flex flex-col gap-1 border-b pb-3 font-mono md:flex-row md:items-baseline md:justify-between ${RULE}`}>
          <span className="text-[11px] leading-none font-semibold tracking-[0.1em] text-fg-primary uppercase md:text-[12.5px]">
            Form HG-7 — certificate of halal verification
          </span>
          <span className="text-[10px] leading-none font-medium tracking-[0.04em] text-accent-600 uppercase md:text-[11.5px]">
            Specimen · rev. 1 · checklist v1 · Ontario
          </span>
        </div>

        <div className="md:grid md:grid-cols-[1fr_392px] md:gap-x-10">
          {/* ---- Schedules A and B ---------------------------------------- */}
          <div className="flex min-w-0 flex-col">
            <div className={`mt-4 flex items-baseline justify-between gap-3 border-b pb-1.5 md:mt-[18px] ${RULE}`}>
              <h3 className={SCHEDULE_HEAD}>Schedule A — the seven checks</h3>
              <span className={FURNITURE}>7/7</span>
            </div>

            <ol className="m-0 list-none p-0">
              {SCHEDULE_A.map(({ n, text, by }, i) => (
                <li
                  key={n}
                  className={`flex items-center gap-2.5 border-b py-3 text-fg-primary md:h-10 md:py-0 ${
                    i === SCHEDULE_A.length - 1 ? RULE : 'border-line-decorative'
                  }`}
                >
                  <span className="w-7 flex-none font-mono text-[12px] font-medium text-accent-600 tabular-nums">
                    {n}
                  </span>
                  <span className="min-w-0 flex-1 text-body-md leading-snug font-medium md:text-[17px] md:leading-tight">
                    {text}
                  </span>
                  <span className="hidden w-[184px] flex-none font-mono text-[10.5px] leading-none font-medium tracking-[0.04em] text-accent-600 uppercase md:block">
                    {by}
                  </span>
                  <PassMark />
                </li>
              ))}
            </ol>

            <p className="mt-2 mb-0 font-mono text-[10.5px] leading-relaxed tracking-[0.03em] text-accent-600">
              05 and 07 are computed by the server. A reviewer cannot mark them passed against the
              computation.
            </p>

            <div className={`mt-5 flex items-baseline justify-between gap-3 border-b pb-1.5 ${RULE}`}>
              <h3 className={SCHEDULE_HEAD}>Schedule B — accepted issuing bodies</h3>
              <span className={`${FURNITURE} hidden md:block`}>Registry · 3 seeded · extensible</span>
            </div>

            <div className="mt-3.5 flex flex-wrap items-center gap-3">
              {ISSUERS.map(({ abbr, sub, size }) => (
                <div
                  key={abbr}
                  role="img"
                  aria-label={sub ? `${abbr} ${sub}` : abbr}
                  className="flex size-[84px] flex-none items-center justify-center rounded-full border border-fg-primary"
                >
                  <div className="flex size-[68px] flex-col items-center justify-center rounded-full border border-dashed border-halal-certified-ring font-mono leading-none text-fg-primary">
                    <span className={`font-semibold ${size}`}>{abbr}</span>
                    {sub ? (
                      <span className="mt-1 text-[8px] font-medium tracking-[0.14em] uppercase">{sub}</span>
                    ) : null}
                  </div>
                </div>
              ))}
              <p className="m-0 min-w-[240px] flex-1 text-body-sm leading-relaxed text-accent-600 md:ms-2.5 md:text-[14.5px]">
                A certificate from any <strong className="font-semibold text-fg-primary">one</strong> of these
                satisfies check 02. The registry is seeded, not closed — a body can be added as it is
                accepted — but the issuer is always chosen from the registry, never typed in.
              </p>
            </div>

            <div
              className={`mt-6 flex justify-between gap-4 border-t pt-3 font-mono text-[10px] leading-none font-medium tracking-[0.05em] text-accent-600 uppercase md:mt-auto md:text-[10.5px] ${RULE}`}
            >
              <span>Rejection — any one fail, with a reason code</span>
              <span className="hidden md:block">Page 1 of 1</span>
            </div>
          </div>

          {/* ---- Schedule C: the outcome, and what happens on lapse -------- */}
          <div className="mt-8 flex min-w-0 flex-col md:mt-[18px] md:border-s md:border-fg-primary md:ps-7">
            <div className={`flex items-baseline justify-between gap-3 border-b pb-1.5 ${RULE}`}>
              <h3 className={SCHEDULE_HEAD}>Schedule C — outcome</h3>
              <span className={`${FURNITURE} hidden md:block`}>Issued on 7/7 only</span>
            </div>

            <div className="mt-3.5 flex items-center gap-3">
              <p className="m-0 min-w-0 flex-1 text-body-md leading-snug text-fg-primary md:text-[15.5px]">
                The seal is the outcome of the sheet, not a setting: issued only when all seven checks are
                marked passed. Six of seven is a rejection with a reason, not a seal.
              </p>
              {/* Off-axis, like a stamp applied by hand rather than a logo placed. */}
              <div className="flex-none -rotate-8">
                <StampSeal size={168} className="hidden md:block" />
                <StampSeal size={120} className="md:hidden" />
              </div>
            </div>

            <div className={`mt-5 flex items-baseline justify-between gap-3 border-b pb-1.5 md:mt-[18px] ${RULE}`}>
              <h3 className={SCHEDULE_HEAD}>On lapse</h3>
              <span className={`${FURNITURE} hidden md:block`}>Withdrawn at expiry · same day</span>
            </div>

            <div className="mt-3.5 flex items-center gap-3">
              {/* Slate, never red. Invariant 9: red reads as haram, which is a
                  religious ruling the platform does not make. */}
              <span className="inline-flex h-9 flex-none items-center gap-2 rounded-sm bg-halal-expired-seal ps-2.5 pe-3 text-label-lg leading-none font-semibold whitespace-nowrap text-halal-expired-on-seal">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="block"
                >
                  <path d="M12 2.25 4.5 5.35v6.02c0 4.4 3.02 8.5 7.5 9.88 4.48-1.38 7.5-5.48 7.5-9.88V5.35L12 2.25Z" />
                </svg>
                Certification expired
              </span>
              <span className="font-mono text-[10.5px] leading-relaxed font-medium tracking-[0.05em] text-accent-600 uppercase">
                State: expired
                <br />
                Not orderable
              </span>
            </div>

            <p className="mt-3.5 mb-0 text-body-md leading-snug text-fg-primary md:text-[15px]">
              When a certificate reaches its expiry date, the seal is withdrawn that same day. The listing
              shows the state above — neutral slate, meaning{' '}
              <em className="font-semibold not-italic">we can’t currently vouch</em> — never a red warning,
              never a badge left up in hope. If a halal field is missing from our records, no badge is shown
              at all. We don’t guess.
            </p>

            <p className="mt-5 mb-0 border-t border-line-decorative pt-3 font-mono text-[10.5px] leading-relaxed tracking-[0.03em] text-accent-600 md:mt-auto">
              APPROVED → EXPIRED at expires_on, end of day, America/Toronto. Red is never used for a halal
              state: red reads as a religious ruling, and this platform does not make one.
            </p>
          </div>
        </div>
      </section>

      {/* Back to the warm voice: soft radius, sage, display face. */}
      <div className="mt-6 box-border flex flex-col gap-3 rounded-xl bg-feedback-success-tint px-5 py-3.5 md:flex-row md:items-center md:justify-between md:gap-8 md:ps-6.5">
        <p className="m-0 max-w-[900px] text-body-md leading-snug text-accent-600 md:text-[17px]">
          Every restaurant you can order from has a sheet like this on file. Issuing body, certificate
          number, dates and the day we verified it are on the restaurant’s page, with the certificate one
          tap away.
        </p>
      </div>
    </section>
  );
}
