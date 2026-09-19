import Link from 'next/link';

/**
 * The credibility band — and a deliberate substitution.
 *
 * The obvious thing here is a founder: a face, a first name, a signed note, a
 * mailbox. That is the strongest version of this section and we are not
 * shipping it, because the three facts it needs (a real name, a real
 * neighbourhood, a monitored mailbox) are the client's to give and we do not
 * have them. A stock portrait and an invented signature on a page whose entire
 * claim is "we check things carefully" would be the argument against us.
 *
 * So this section answers a different credibility question — not "who are you"
 * but "how would I ever catch you out". Verifiability instead of personality:
 * everything below is something a stranger can go and check, or a commitment
 * that can later be held against us.
 *
 * When the client supplies the three facts, the founder note goes back above
 * this band. It does not replace it.
 */

const ITEMS: readonly { title: string; body: React.ReactNode }[] = [
  {
    title: 'The standard is written down, versioned and dated.',
    body: (
      <>
        Not a page of principles — the actual seven checks, what makes an issuer acceptable, and what we
        refuse to claim. If we change it, the version changes with it.{' '}
        <Link
          href="/verification"
          className="font-semibold whitespace-nowrap text-fg-primary underline decoration-line-decorative underline-offset-[3px] hover:decoration-[var(--hg-mk-accent)]"
        >
          Read it →
        </Link>
      </>
    ),
  },
  {
    title: 'We print the issuer’s name, not a label of our own.',
    body: 'Every listing names the body that issued the certificate. We don’t rank issuers or score them, because which bodies you accept is your judgement, not ours.',
  },
  {
    title: 'You can open the certificate itself.',
    body: 'Not a badge that stands in for a document — the document. Signed in, from the listing, on a link that expires in minutes and is never served from a public URL.',
  },
  {
    title: 'Nobody can buy their way up the list.',
    body: 'A restaurant cannot pay for or influence its position in the feed. There is no promoted tier and there is no plan to build one.',
  },
  {
    title: 'We’ll publish what we turn down.',
    body: 'From launch: how many applications we received, how many passed, and how many we rejected. A verifier who only ever reports approvals isn’t verifying anything.',
  },
];

export function Checkable() {
  return (
    <section aria-labelledby="checkable-heading" className="mt-16 lg:mt-24">
      <div className="lg:grid lg:grid-cols-[4fr_7fr] lg:items-start lg:gap-16">
        <div>
          <p className="m-0 font-mono text-marketing-eyebrow-phone text-mk-ink uppercase lg:text-marketing-eyebrow">
            How to catch us out
          </p>
          <h2
            id="checkable-heading"
            className="mt-3 mb-0 font-display text-marketing-section-phone text-fg-primary lg:mt-4 lg:text-marketing-section"
          >
            Everything here is checkable.
          </h2>
          <p className="mt-4 mb-0 max-w-[46ch] text-body-lg leading-relaxed text-mk-ink">
            We’re asking you to trust a list. The only honest way to earn that is to make it easy to prove us
            wrong.
          </p>
        </div>

        <ul className="mt-7 grid list-none p-0 lg:mt-0">
          {ITEMS.map((item) => (
            <li key={item.title} className="m-0 border-t border-line-decorative py-4 first:border-t-0 first:pt-0 lg:py-[22px]">
              <p className="m-0 mb-1.5 text-body-lg leading-tight font-bold text-fg-primary">{item.title}</p>
              <p className="m-0 max-w-[58ch] text-body-md leading-relaxed text-mk-ink">{item.body}</p>
            </li>
          ))}
        </ul>
      </div>

      {/* The honest empty state. This strip is the whole anti-fabrication policy
          in one sentence, and it is the most valuable thing on a pre-launch page. */}
      <p className="mt-8 mb-0 rounded-xl border border-line-decorative bg-surface-raised px-4 py-3.5 font-mono text-[10.5px] leading-loose tracking-[0.04em] text-mk-ink uppercase lg:mt-12 lg:px-5 lg:py-[18px] lg:text-[11px]">
        No reviews, no ratings, no customer counts and no partner logos on this page. We haven’t opened yet.
        When we do, every number here will be one you can check.
      </p>
    </section>
  );
}
