import Link from 'next/link';
import { DocPage, DocSection, RuledBlank } from '@/components/DocPage';
import { DISCLAIMER, PLACE } from '@/lib/claims';
import { pageMetadata } from '@/lib/site';

/**
 * Website and waitlist terms.
 *
 * DELIBERATELY NARROW. There is no delivery service, no account, no order and
 * no payment yet — so these terms cover the only things that actually exist:
 * this website and the waitlist. Writing marketplace terms for a marketplace
 * that isn't live would be describing a product nobody can use, on a site whose
 * whole argument is that we don't claim things that aren't true. The commercial
 * terms get written against the real product, before it opens.
 *
 * Note what is NOT bundled in here: consent to receive email. Under CASL that
 * consent has to be unbundled from general terms, so it lives with the form.
 * Do not move it into this document to tidy up the UI.
 */

const VERSION = 'v1.1';
const EFFECTIVE = '19 September 2026';

export const metadata = pageMetadata({
  title: 'Website and waitlist terms',
  description:
    'The terms that apply to the HalalGoes website and its pre-launch waitlist. Ontario, Canada.',
  path: '/terms',
});

export default function TermsPage() {
  return (
    <DocPage
      heading="Website and waitlist terms."
      standfirst="Short, because there is not much here yet. This site is a pre-launch page and an email waitlist — there is no app, no account and nothing to buy."
      version={VERSION}
      effective={EFFECTIVE}
    >
      <DocSection n="01" title="What this site is">
        <p>
          This website is operated by HalalGoes, a business based in {PLACE.province}, {PLACE.country}. It
          describes a halal food-delivery service we are building and lets you join a waitlist to hear when it
          opens.
        </p>
        <p>
          <strong>What it is not, today:</strong>
        </p>
        <ul>
          <li>There is no ordering service. You cannot place an order, and no restaurant is listed yet.</li>
          <li>There is no app to download and no account to create.</li>
          <li>Nothing on this site takes payment, and we never ask for card details.</li>
        </ul>
        <p>
          If anything on this page ever reads as an offer to sell you something, it isn’t one. When the
          service opens there will be separate terms covering orders, payments, refunds and delivery, and you
          will have to agree to those before you can use it.
        </p>
      </DocSection>

      <DocSection n="02" title="The waitlist">
        <p>
          If you give us your email address, we use it to tell you when we open in your area, and after that
          only when newly verified kitchens open near you. That is the whole purpose. The same applies to the
          restaurant and rider forms, for their own subject.
        </p>
        <ul>
          <li>Give us your own address, not somebody else’s.</li>
          <li>
            You can leave at any time — every email has a one-click unsubscribe, and you can ask us to delete
            your address outright.
          </li>
          <li>
            Joining the waitlist does not reserve anything, guarantee access, or create any obligation on
            either side.
          </li>
          <li>
            We may never launch. It is a plan, not a promise, and if we abandon it we will tell the people on
            the list.
          </li>
        </ul>
        <p>
          What we do with your address, how long we keep it and how to get it removed are in the{' '}
          <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </DocSection>

      <DocSection n="03" title="What we say about halal verification">
        <p>
          This site describes the checks we intend to run on a restaurant’s halal certificate before listing
          it, and the <Link href="/verification">verification standard</Link> sets them out in full. That
          description is of our own process. It is not a certification, an endorsement, or a religious ruling.
        </p>
        <p>
          <strong>{DISCLAIMER}</strong>
        </p>
        <p>
          Certifying bodies named on this site are named as a matter of fact, because we read the certificates
          they issue. We are not affiliated with any of them, none of them endorses us, and their names and
          marks belong to them.
        </p>
      </DocSection>

      <DocSection n="04" title="What we say about money">
        <p>
          Figures on this site — commission at launch, the delivery fee, what share of a tip reaches a rider,
          when payouts land — describe decisions we have taken for launch. They are settings, not offers:
          there is no promotional window, no partner tier and no countdown, and a setting can change. Where
          one does, we would rather tell you plainly that it can than sell you an offer that expires.
        </p>
        <p>
          Nothing on this site is a quotation, and no figure here forms part of a contract. The commercial
          terms for restaurants and riders are written against the real product, before it opens.
        </p>
      </DocSection>

      <DocSection n="05" title="Using the site">
        <p>Please don’t:</p>
        <ul>
          <li>Submit addresses that aren’t yours, or submit the form automatically or in bulk.</li>
          <li>Try to break, overload, probe or gain unauthorised access to the site or anything behind it.</li>
          <li>Scrape the site at a scale that affects it, or re-publish it as if it were yours.</li>
        </ul>
        <p>
          We may block access if any of that happens. You are welcome to link to this site, quote it with
          attribution, and share it.
        </p>
      </DocSection>

      <DocSection n="06" title="Our content">
        <p>
          The text, design, photography and the HalalGoes name on this site are ours or licensed to us, and
          stay that way. Quoting and linking is fine; wholesale copying is not.
        </p>
      </DocSection>

      <DocSection n="07" title="No warranty, and what we’re responsible for">
        <p>
          We publish this site in good faith and we check what goes on it. We can’t promise it will be
          available without interruption or free of every error, and we provide it “as is”.
        </p>
        <p>
          To the extent the law allows, we aren’t liable for indirect or consequential loss arising from your
          use of this website. Nothing here limits liability that cannot be limited by law — including for
          fraud, or for death or personal injury caused by negligence. Some of your rights as a consumer
          cannot be signed away, and these terms don’t try to.
        </p>
      </DocSection>

      <DocSection n="08" title="Changes">
        <p>
          We can change these terms. When we do, the version number and effective date at the top change with
          them, so you can tell. If a change materially affects people already on the waitlist, we will say so
          in an email rather than quietly amending this page.
        </p>
      </DocSection>

      <DocSection n="09" title="Law">
        <p>
          These terms are governed by the laws of the Province of {PLACE.province} and the federal laws of{' '}
          {PLACE.country} that apply there, and the courts of {PLACE.province} have jurisdiction.
        </p>
      </DocSection>

      <DocSection n="10" title="Contact">
        <p>
          Questions about these terms, or about anything on the site, go to the address below. It is not
          published yet — we are showing you the empty field rather than an address nobody is reading, for the
          same reason a specimen record shows ruled blanks instead of a plausible-looking restaurant.
        </p>
        <RuledBlank label="Contact address" />
      </DocSection>
    </DocPage>
  );
}
