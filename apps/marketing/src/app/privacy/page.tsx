import Link from 'next/link';
import { DocPage, DocSection, RuledBlank } from '@/components/DocPage';
import { PLACE } from '@/lib/claims';
import { pageMetadata } from '@/lib/site';

/**
 * Privacy policy for the pre-launch site.
 *
 * Written against what THIS site actually does — one email field on three
 * tracks, a consent sentence stored verbatim, session-scoped attribution, and
 * self-hosted analytics that do not run until somebody says yes. Every claim
 * below was checked against the code rather than copied from a template: see
 * src/app/actions/waitlist.ts, src/lib/waitlist-store.ts, src/lib/attribution.ts,
 * src/lib/consent.ts and src/components/Analytics.tsx.
 *
 * It differs from the Astro site's version in three ways that matter, all of
 * them because the code differs: there are three audiences rather than two,
 * there is no optional city field, and analytics now exist (behind consent)
 * where before there were none. If any of that changes again — a CRM wired to
 * WAITLIST_WEBHOOK_URL, an advertising pixel actually added — this document
 * changes in the same commit.
 */

const VERSION = 'v1.1';
const EFFECTIVE = '19 September 2026';

export const metadata = pageMetadata({
  title: 'Privacy policy',
  description:
    'What HalalGoes collects from this pre-launch website, why, how long we keep it, and how to get it removed. Ontario, Canada.',
  path: '/privacy',
});

export default function PrivacyPage() {
  return (
    <DocPage
      heading="Privacy policy."
      standfirst="One email address, and nothing we can identify you by beyond that. Here is exactly what happens to it."
      version={VERSION}
      effective={EFFECTIVE}
    >
      <DocSection n="01" title="The short version">
        <ul>
          <li>We collect your email address, and only if you type it in.</li>
          <li>
            We use it to email you when we open, and afterwards only about newly verified kitchens near you.
          </li>
          <li>We do not sell it, rent it, or pass it to restaurants or anyone else for their own marketing.</li>
          <li>You can have it deleted at any time, and you don’t have to give a reason.</li>
          <li>Nothing measures you until you agree to it, and declining is one click.</li>
        </ul>
        <p>The rest of this page is the detail behind those five lines.</p>
      </DocSection>

      <DocSection n="02" title="What we collect">
        <h3>Your email address</h3>
        <p>
          Collected only when you submit the waitlist form. All three forms — ordering, listing a restaurant,
          and delivering — ask for an email address on the same basis.
        </p>
        <p>
          <strong>We do not ask for a phone number.</strong> We would have liked to text you once at launch,
          and we are not set up to send one lawfully yet, so we are not collecting numbers we could not use.
          If one is ever submitted to our form endpoint it is discarded rather than stored.
        </p>
        <h3>How you arrived</h3>
        <p>
          If you reach the site from a campaign link, we read the <code>utm_*</code> parameters and the
          referring page and keep them in your browser’s session storage, so that if you sign up we know which
          channel worked. It is cleared when you close the tab, it contains no information about you, and it
          is read back only at the moment you submit the form.
        </p>
        <p>
          We also record which form you used — the one in the page header area, or the one at the foot of the
          page. That is a word, not an identifier.
        </p>
        <h3>Ordinary server logs</h3>
        <p>
          Our host records requests, including IP addresses, as part of running and securing the site. We
          don’t use those logs to build a profile of you.
        </p>
        <h3>What we do not collect</h3>
        <p>
          No name, no phone number, no address, no payment details, no account. There is nothing to buy on
          this site and nothing to log into.
        </p>
      </DocSection>

      <DocSection n="03" title="Your consent, and the record of it">
        <p>
          Canada’s anti-spam legislation requires your express consent before we send you commercial email.
          You give that by ticking the box beside the field — it ships unticked, and an unticked box is a no,
          not a maybe.
        </p>
        <p>
          We store <strong>the exact sentence you were shown</strong>, the date and time, and which form on
          the page you were using — so that if the wording on the site ever changes, the record still shows
          what you actually agreed to. If we cannot record all of that, we refuse the submission rather than
          keep your address.
        </p>
      </DocSection>

      <DocSection n="04" title="Analytics and cookies">
        <p>
          <strong>Nothing measures you unless you say yes.</strong> When you first arrive you are asked, in a
          bar rather than a wall, and both buttons are the same size — accepting is not made easier than
          declining. Until you choose, no measurement script is loaded at all: the tag sits in the page inert,
          and consent is what turns it into a script the browser will run.
        </p>
        <p>
          If you accept, we load <strong>Umami</strong>, which is analytics software we run on our own server.
          It counts page views and where they came from. It sets no cookie, it does not follow you to other
          sites, and it does not record anything personal. We do not use Google Analytics.
        </p>
        <p>
          The consent panel also lists <strong>advertising pixels</strong>. We have not added one yet. The
          toggle exists ahead of time so that when we do advertise, it is already off by default and already
          yours to refuse, rather than appearing one day switched on.
        </p>
        <p>
          Your choice is stored in your browser under <code>hg-consent</code> so we do not ask again on every
          visit. You can change it at any time from <em>Cookie preferences</em> in the footer, and withdrawing
          is as easy as giving it.
        </p>
      </DocSection>

      <DocSection n="05" title="Who else touches it">
        <p>
          Our website and its form endpoint are hosted by Vercel, which processes requests on our behalf. When
          we connect an email tool to send the launch announcement, it will process your address on our behalf
          too, under contract and for no other purpose.
        </p>
        <p>
          We do not sell or rent personal information, and we do not pass your address to restaurants. Data
          may be stored or processed outside {PLACE.country}, which means it can be subject to the laws of the
          country it is held in.
        </p>
      </DocSection>

      <DocSection n="06" title="How long we keep it">
        <p>
          Until you unsubscribe or ask us to delete it, or until we decide not to launch — at which point we
          tell the list and then delete it. We keep the consent record itself for as long as the law requires
          us to be able to prove consent, and no longer.
        </p>
      </DocSection>

      <DocSection n="07" title="Your rights">
        <p>Under Canadian privacy law you can ask us to:</p>
        <ul>
          <li>Tell you what we hold about you, and give you a copy.</li>
          <li>Correct it if it is wrong.</li>
          <li>Delete it.</li>
          <li>Stop emailing you — which you can also do yourself from any email we send.</li>
        </ul>
        <p>
          We will not make you explain why, and asking costs you nothing. If you are unhappy with how we
          handle a request, you can complain to the Office of the Privacy Commissioner of Canada.
        </p>
      </DocSection>

      <DocSection n="08" title="Security">
        <p>
          The site is served over HTTPS, the form endpoint re-validates everything before it stores anything,
          and access to the list is limited to the people who need it. No system is perfect, and we would
          rather say that than claim otherwise.
        </p>
      </DocSection>

      <DocSection n="09" title="Changes">
        <p>
          If this policy changes, the version and date at the top change with it. If a change affects what we
          do with an address we already hold, we will email the list rather than quietly edit this page.
        </p>
      </DocSection>

      <DocSection n="10" title="Contact">
        <p>
          Privacy questions and deletion requests go to the address below. It is not published yet — we are
          showing you the empty field rather than an address nobody is reading. Until it is live, replying to
          any email we send you reaches us. What we check before we list a kitchen is set out in{' '}
          <Link href="/verification">the verification standard</Link>.
        </p>
        <RuledBlank label="Privacy contact" />
      </DocSection>
    </DocPage>
  );
}
