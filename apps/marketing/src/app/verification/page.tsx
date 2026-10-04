import { DocSection, RuledBlank } from '@/components/DocPage';
import { PageShell } from '@/components/PageShell';
import { CHECKS, DISCLAIMER, ISSUERS, PLACE, STATES } from '@/lib/claims';
import { pageMetadata } from '@/lib/site';

/**
 * The verification standard — the artifact a family WhatsApp group forwards.
 *
 * This page is the one honest substitute we have for social proof:
 * verifiability. It is versioned and dated on purpose, so that if we ever
 * quietly loosen a check, the change is visible.
 *
 * Every list on it renders from `claims.ts` rather than from prose written here,
 * which is what stops the standard and the product drifting apart. If a check is
 * reworded in the spec, it is reworded in one place and this page follows.
 *
 * Note the dispute address is rendered as an UNFILLED FIELD rather than as an
 * invented mailbox. That is the specimen record card's device, used on
 * ourselves: where a value doesn't exist yet, we show the shape of it and say
 * so. A made-up hello@ on the page that documents our rigour would be
 * self-refuting.
 */

const VERSION = 'v1.0';
const EFFECTIVE = '19 September 2026';

export const metadata = pageMetadata({
  title: `The verification standard, ${VERSION}`,
  description:
    'The seven checks a halal certificate must pass before a kitchen is listed on HalalGoes, the certifying bodies we accept, what happens when a certificate expires, and what we explicitly do not claim.',
  path: '/verification',
});

const NOT_CLAIMED = [
  'We do not certify food. We read certificates issued by others.',
  'We do not make religious rulings, and we do not adjudicate between schools of thought.',
  'We do not rank or score certifying bodies.',
  'We do not inspect kitchens, slaughterhouses or supply chains ourselves.',
  'We do not verify certificates against a government registry — no such registry exists for halal certification in Canada.',
  'We do not accept a supplier’s certificate as evidence that a kitchen is certified.',
  'We do not allow a restaurant to pay for or influence its position in the feed.',
];

/** Ruled rows, not cards. A grid reads as a feature list; a ruled column reads
 *  as a form somebody filled in, which is the entire argument of this page. */
const ROW = 'border-t border-line-decorative py-5 first:border-t-0 first:pt-0';
const KEY = 'm-0 font-mono text-[11px] leading-none font-medium tracking-[0.07em] text-mk-ink uppercase';
const TITLE = 'mt-0 mb-1.5 text-body-lg leading-tight font-bold text-fg-primary';
const BODY = 'm-0 max-w-[62ch] text-body-md leading-relaxed text-mk-ink';

export default function VerificationPage() {
  return (
    <PageShell>
      <article className="pb-4">
        <header className="border-b border-line-decorative pb-8 lg:pb-11">
          <p className="m-0 font-mono text-[11px] leading-none font-medium tracking-[0.1em] text-mk-ink uppercase lg:text-[12px]">
            {VERSION} · Effective {EFFECTIVE}
          </p>
          <h1 className="mt-4 mb-0 max-w-[16ch] font-display text-marketing-section-phone text-fg-primary lg:mt-[18px] lg:text-marketing-section">
            The verification standard.
          </h1>
          <p className="mt-4 mb-0 max-w-[62ch] text-body-lg leading-relaxed text-mk-ink lg:mt-[18px] lg:text-[19px]">
            What a halal certificate has to survive before a kitchen appears on HalalGoes. If we change any
            of it, the version number changes with it.
          </p>
        </header>

        <div className="pt-9 lg:pt-13">
          <DocSection n="01" title="The seven checks">
            <p>
              All seven must pass. One fail and the kitchen is not listed — there is no partial credit, no
              provisional listing, and nothing is approved on a timer. Checks five and seven are computed by
              the server and cannot be overridden by any member of our team.
            </p>
            <ol className="m-0 mt-6 list-none p-0">
              {CHECKS.map((check, i) => (
                <li key={check.key} className={`${ROW} ps-0 before:hidden`}>
                  <p className={KEY}>
                    {String(i + 1).padStart(2, '0')} · {check.key}
                  </p>
                  <p className={`${TITLE} mt-[7px]`}>{check.title}</p>
                  <p className={BODY}>{check.body}</p>
                </li>
              ))}
            </ol>
          </DocSection>

          <DocSection n="02" title="The certifying bodies we accept">
            <p>
              A certificate from any one of these satisfies check two. The registry is seeded, not closed — it
              can be extended, and the reason it exists at all is so that the issuer’s name can be printed on
              the listing rather than hidden behind a label of ours.
            </p>
            <ul className="m-0 mt-6 list-none p-0">
              {ISSUERS.map((issuer) => (
                <li key={issuer.abbr} className={`${ROW} ps-0 before:hidden`}>
                  <p className="m-0 mb-1 font-mono text-[13px] leading-snug font-medium tracking-[0.03em] text-fg-primary">
                    {issuer.url ? (
                      <a href={issuer.url} rel="noopener noreferrer" target="_blank">
                        {issuer.name}
                      </a>
                    ) : (
                      issuer.name
                    )}
                  </p>
                  <p className={KEY}>{issuer.where}</p>
                </li>
              ))}
            </ul>
            <p className="mt-6">
              We are not affiliated with any of them and none of them endorses us. We do not rank, score or
              editorialise certifying bodies — which body’s standard you accept is your judgement, not ours.
            </p>
            <h3>If your issuer isn’t listed</h3>
            <p>
              Send the certificate anyway. If the issuing body is accredited and the certificate covers the
              kitchen, we will assess it and tell you either way, with a reason. We would rather add an issuer
              we can stand behind than turn away a kitchen that has done the work.
            </p>
          </DocSection>

          <DocSection n="03" title="What the badge can say">
            <ul className="m-0 mt-2 list-none p-0">
              {STATES.map((state) => (
                <li key={state.state} className={`${ROW} ps-0 before:hidden`}>
                  <p className={TITLE}>{state.label}</p>
                  <p className={BODY}>{state.body}</p>
                  <p className={`${KEY} mt-2.5`}>{state.mono}</p>
                </li>
              ))}
            </ul>
            <p className="mt-6">
              No halal state is ever shown in red. Red reads as <em>haram</em> — a religious ruling we do not
              make. An expired certificate is shown in slate, and it means our information has lapsed, not
              that anything is wrong with the food.
            </p>
          </DocSection>

          <DocSection n="04" title="What we explicitly do not claim">
            <ul>
              {NOT_CLAIMED.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </DocSection>

          <DocSection n="05" title="Disputing a listing">
            <p>
              If a listing ever looks wrong to you, we want to hear it — a verifier who is hard to contact is
              not a verifier. This is the address for that, and it is not published yet:
            </p>
            <RuledBlank label="Dispute address">
              <p>
                Not yet published. It goes up before the first listing does. We are showing you the empty
                field rather than an address nobody is reading, for the same reason a specimen record shows
                ruled blanks instead of a plausible-looking restaurant.
              </p>
            </RuledBlank>
          </DocSection>

          <p className="m-0 mb-2.5 max-w-[74ch] font-mono text-[11px] leading-relaxed tracking-[0.03em] text-mk-ink">
            {DISCLAIMER}
          </p>
          <p className="m-0 max-w-[74ch] font-mono text-[11px] leading-relaxed tracking-[0.03em] text-mk-ink">
            {VERSION} · effective {EFFECTIVE} · {PLACE.province}, {PLACE.country} · this document is the
            standard of record and supersedes any description of it elsewhere on this site.
          </p>
        </div>
      </article>
    </PageShell>
  );
}
