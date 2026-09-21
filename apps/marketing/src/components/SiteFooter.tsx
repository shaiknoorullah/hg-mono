import Link from 'next/link';
import { ConsentPreferencesButton } from '@/components/ConsentManager';
import { WaitlistForm } from '@/components/WaitlistForm';
import { AUDIENCES, TRACKS, type Audience } from '@/lib/audiences';

/**
 * The footer carries the second ask, not just the links.
 *
 * By the time somebody has read the whole argument — the seven checks, the
 * refusal, the four states — the ask should be in front of them without a
 * scroll back to the hero. That is the entire reason this grew from a nav strip
 * into a band with its own form.
 *
 * Every link goes somewhere. A footer full of dead links is the clearest
 * possible signal that a site was generated rather than built, which is why
 * privacy, terms and the verification standard were written before they were
 * linked rather than stubbed and linked anyway. The standard sits here as well
 * as in the page body on purpose: it is the one document a reader might want to
 * forward, and the footer is where people look for a document.
 *
 * Cookie preferences is not optional: consent that cannot be withdrawn as
 * easily as it was given is not consent.
 *
 * The bottom rule reserves whichever of the two fixed things in that corner is
 * taller, so the last line — the one that says we do not certify food — is
 * never sitting under either. StickyCta hides itself over this footer, but the
 * reserve costs nothing and covers the moment before the observer fires; the
 * consent notice is the taller of the two and was measured occluding the line
 * by 51px at 390. `max()`, not a sum: only one of them is ever up, because the
 * bar stands down while the notice is (see `consent.css`).
 */

const COLUMN_LABEL =
  'm-0 mb-2.5 font-mono text-[11px] leading-none tracking-[0.08em] text-mk-ink uppercase';

const LINK =
  'inline-flex min-h-10 items-center text-body-sm text-fg-primary underline decoration-line-decorative underline-offset-4 hover:decoration-[var(--hg-mk-accent)]';

const CURRENT = 'font-semibold decoration-[var(--hg-mk-accent)]';

export function SiteFooter({ current }: { current?: Audience }) {
  const track = TRACKS[current ?? 'customer'];

  return (
    <footer id="site-footer" className="mt-16 lg:mt-24">
      <div className="border-t border-line-decorative bg-surface-sunken py-12 lg:py-20">
        <div className="lg:grid lg:grid-cols-[1fr_480px] lg:items-start lg:gap-18">
          <div>
            <p className="m-0 mb-4 font-display text-heading-sm font-extrabold tracking-[-0.03em] text-fg-primary">
              Halal Goes
            </p>
            <p className="m-0 max-w-[15ch] font-display text-marketing-section-phone leading-[1.06] text-fg-primary lg:text-marketing-section">
              Seven checks, before it reaches you.
            </p>
            <p className="mt-4 mb-0 max-w-[46ch] text-body-lg leading-relaxed text-mk-ink">
              We are pre-launch in Ontario. Leave your email and we will write once, the day we open in your area
              — and after that only when there are newly verified kitchens near you.
            </p>

            <div className="mt-9 grid grid-cols-2 gap-x-6 gap-y-7 lg:grid-cols-3">
              <div>
                <h2 className={COLUMN_LABEL}>I want to</h2>
                <ul className="m-0 list-none p-0">
                  {AUDIENCES.map((id) => (
                    <li key={id}>
                      <Link
                        href={TRACKS[id].href}
                        aria-current={id === current ? 'page' : undefined}
                        className={`${LINK} ${id === current ? CURRENT : ''}`}
                      >
                        {TRACKS[id].tab}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h2 className={COLUMN_LABEL}>How we check</h2>
                <ul className="m-0 list-none p-0">
                  <li>
                    <Link href="/verification" className={LINK}>
                      Verification standard
                    </Link>
                  </li>
                  <li>
                    <Link href="/blog" className={LINK}>
                      Writing
                    </Link>
                  </li>
                </ul>
              </div>

              <div>
                <h2 className={COLUMN_LABEL}>Legal</h2>
                <ul className="m-0 list-none p-0">
                  <li>
                    <Link href="/privacy" className={LINK}>
                      Privacy
                    </Link>
                  </li>
                  <li>
                    <Link href="/terms" className={LINK}>
                      Terms
                    </Link>
                  </li>
                  <li>
                    <ConsentPreferencesButton className={`${LINK} cursor-pointer bg-transparent p-0`} />
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div id="footer-waitlist" className="mt-10 scroll-mt-6 lg:mt-0">
            <WaitlistForm track={track} context="footer" />
          </div>
        </div>
      </div>

      <div
        className="flex flex-wrap items-baseline gap-x-7 gap-y-1.5 border-t border-line-decorative pt-6"
        style={{
          paddingBottom: 'calc(2rem + max(var(--sticky-cta-h, 0px), var(--hg-consent-h, 0px)))',
        }}
      >
        <p className="m-0 text-body-sm text-fg-secondary">Ontario, Canada. Launching soon — prices in CAD.</p>
        <p className="m-0 text-body-sm text-fg-secondary">Halal Goes does not itself certify food.</p>
      </div>
    </footer>
  );
}
