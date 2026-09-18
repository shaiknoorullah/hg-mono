import { SITE, absolute } from '@/lib/site';
import { type AudienceTrack } from '@/lib/audiences';

/**
 * JSON-LD.
 *
 * Only two types, both of which we can back: Organization (who we are) and
 * FAQPage (questions that are genuinely on the page, with the answers that are
 * genuinely on the page). Nothing describes a product, a rating or an offer —
 * there are no products yet, no reviews at all, and marking up either would be
 * a structured-data claim we could not support, which is both a manual action
 * from Google and exactly the behaviour this site exists to argue against.
 */

function Ld({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      // The content is our own, built from constants in this repo — no user
      // input reaches it.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export function OrganizationLd() {
  return (
    <Ld
      data={{
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: SITE.name,
        url: absolute('/'),
        logo: absolute('/icon.svg'),
        description:
          'A halal food-delivery marketplace for Ontario. Every restaurant passes seven checks against its halal certificate before it goes live.',
        areaServed: { '@type': 'AdministrativeArea', name: 'Ontario, Canada' },
      }}
    />
  );
}

export function FaqLd({ track }: { track: AudienceTrack }) {
  return (
    <Ld
      data={{
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: track.faq.map(({ q, a }) => ({
          '@type': 'Question',
          name: q,
          acceptedAnswer: { '@type': 'Answer', text: a },
        })),
      }}
    />
  );
}
