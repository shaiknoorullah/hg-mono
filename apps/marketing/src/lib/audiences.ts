/**
 * The three audience tracks.
 *
 * Every string here comes from docs/marketing/copy-deck.md (Gate B) — this file
 * is the deck transcribed, not new copy. Two rules travel with it:
 *
 *   1. Nothing goes on the page that is not in the deck's claims register. In
 *      particular: no restaurant, rider, order or waitlist COUNTS, and no
 *      testimonials. None of those exist yet.
 *   2. The customer headline is the deck's Option A ("Verified halal,
 *      delivered."). Option B ("Order without asking.") is the evidence-led
 *      alternative and is the first A/B test to run once there is traffic — it
 *      is recorded here so the test is a one-line change, not a rewrite.
 */

export const AUDIENCES = ['customer', 'restaurant', 'rider'] as const;
export type Audience = (typeof AUDIENCES)[number];

export type AudienceTrack = {
  id: Audience;
  /** Header pill label, and the aria-label of the group is "I want to". */
  tab: string;
  href: string;
  /** Header button. Points at the form; deliberately not the same words as the
      form's own submit, which would read as two attempts at the same ask. */
  headerCta: string;
  headline: readonly string[];
  /** The deck's untested alternative. Not rendered; kept so the test is cheap. */
  headlineAlt?: readonly string[];
  lede: string;
  form: {
    label: string;
    placeholder: string;
    type: 'tel' | 'email';
    autoComplete: string;
    inputMode?: 'tel' | 'email';
    submit: string;
    /** Sits under the button. */
    reassurance: string;
    /** CASL: unticked, adjacent to the field. Silence is never consent. */
    consent: string;
  };
  steps: { heading: string; items: readonly { title: string; body: string }[] };
  faq: readonly { q: string; a: string }[];
  finalCta: { heading: string; body: string };
};

export const TRACKS: Record<Audience, AudienceTrack> = {
  customer: {
    id: 'customer',
    tab: 'Order food',
    href: '/',
    headerCta: 'Join the waitlist',
    headline: ['Verified', 'halal,', 'delivered.'],
    headlineAlt: ['Order', 'without', 'asking.'],
    lede: 'Seven checks on every restaurant, before it reaches you.',
    form: {
      label: 'Mobile number',
      placeholder: '+1 416 555 0134',
      type: 'tel',
      inputMode: 'tel',
      autoComplete: 'tel',
      submit: 'Notify me',
      reassurance: 'No spam. One text, when we launch in your city.',
      consent: 'I agree to receive one launch notification by text. Unsubscribe any time.',
    },
    steps: {
      heading: 'How ordering works',
      items: [
        {
          title: 'Pick a restaurant',
          body: 'Everything you can see has passed all seven checks. The seal on a listing is the outcome of the sheet above, and it comes down the day the certificate lapses.',
        },
        {
          title: 'Order',
          body: 'You see the full total before you pay. Change your mind before the restaurant accepts and the order is cancelled free — nothing is taken.',
        },
        {
          title: 'Follow it to the door',
          body: 'Your rider’s position updates as they go, so you know whether to answer the door now or in ten minutes.',
        },
      ],
    },
    faq: [
      {
        q: 'What does “verified” mean here?',
        a: 'A person reads the restaurant’s halal certificate and records seven checks against it: that it is legible and complete, that the issuing body is one we accept, that the legal name matches, that the premises address matches, that the dates are valid today, that the scope covers everything sold, and that the certificate is not already in use by another restaurant. All seven have to pass. Six of seven is a rejection with a reason, not a seal.',
      },
      {
        q: 'Whose certificates do you accept?',
        a: 'HMA Canada, HFSAA and ISNA Canada. A certificate from any one of them satisfies the issuer check. The list can grow as we accept more bodies; it is never typed in free-hand.',
      },
      {
        q: 'What happens when a certificate expires?',
        a: 'The seal comes down the same day. The listing shows a neutral “we can’t currently vouch” state and you can’t order from it until it’s renewed. We don’t leave a badge up in hope.',
      },
      {
        q: 'Do you decide what’s halal?',
        a: 'No. We check certificates issued by recognised bodies and report what we find. We don’t make religious rulings, and we don’t rank one certifier’s standard above another’s.',
      },
      {
        q: 'Is the whole restaurant halal, or just some items?',
        a: 'That’s check six. We record what the certificate’s scope covers, and if it doesn’t cover everything sold, the restaurant doesn’t go live.',
      },
      {
        q: 'What do you do with my number?',
        a: 'One text when we launch in your city. That’s it — it isn’t sold, and it isn’t used for anything else. You can unsubscribe from that message.',
      },
      {
        q: 'When are you launching?',
        a: 'Ontario first. We’ll text you the day it’s live in your city.',
      },
    ],
    finalCta: {
      heading: 'Be there on day one.',
      body: 'One text when we launch in your city. Nothing before then.',
    },
  },

  restaurant: {
    id: 'restaurant',
    tab: 'List your restaurant',
    href: '/restaurants',
    headerCta: 'Get early access',
    headline: ['0%', 'commission', 'at launch.'],
    lede: 'Keep the whole ticket. We make our money later, and we’ll tell you before we do.',
    form: {
      label: 'Email address',
      placeholder: 'owner@yourrestaurant.ca',
      type: 'email',
      inputMode: 'email',
      autoComplete: 'email',
      submit: 'Get early access',
      reassurance: 'No contract, no exclusivity, no setup fee.',
      consent: 'I agree to receive email about listing my restaurant. Unsubscribe any time.',
    },
    steps: {
      heading: 'What listing looks like',
      items: [
        {
          title: 'Send us four documents',
          body: 'Your business licence, your halal certificate, your food-safety permit, and owner ID. Nothing else, and nothing is public — certificates and ID sit in private storage.',
        },
        {
          title: 'We check the certificate seven ways',
          body: 'If something’s missing we tell you which check failed, not just “rejected”. Every rejection carries a reason code.',
        },
        {
          title: 'Go live at 0% commission',
          body: 'You keep the whole ticket. Payouts land every Monday, automatically, with no minimum and no threshold to reach.',
        },
      ],
    },
    faq: [
      {
        q: 'What does 0% commission actually mean?',
        a: 'We take nothing from the order at launch. The per-restaurant commission field exists and is switchable, so the promise we can keep is notice — we will tell you before it changes, not after.',
      },
      {
        q: 'What do you need from me?',
        a: 'Your business licence, your halal certificate, your food-safety permit and owner ID. The certificate and the ID are stored privately and are never shown on your public page; what customers see is the issuing body, the certificate number, the dates and the day we verified it.',
      },
      {
        q: 'What if my certificate is rejected?',
        a: 'You get the specific check that failed rather than a generic refusal, so you know whether it is a scope question, an address mismatch or simply a renewal you have not filed yet.',
      },
      {
        q: 'When do I get paid?',
        a: 'Every Monday, automatically. There is no minimum payout and no threshold to reach first.',
      },
      {
        q: 'Is there a contract?',
        a: 'No contract, no exclusivity and no setup fee. You can list with us and with anyone else.',
      },
    ],
    finalCta: {
      heading: 'List before we launch.',
      body: '0% commission at launch, and we’ll tell you before that changes.',
    },
  },

  rider: {
    id: 'rider',
    tab: 'Deliver with us',
    href: '/riders',
    headerCta: 'Start delivering',
    headline: ['The delivery', 'fee is yours.', 'All of it.'],
    lede: '$2.99 plus $1.00 per kilometre, paid to you. Every Monday, automatically, with no minimum.',
    form: {
      label: 'Mobile number',
      placeholder: '+1 416 555 0134',
      type: 'tel',
      inputMode: 'tel',
      autoComplete: 'tel',
      submit: 'Start delivering',
      reassurance: 'No minimum payout. No waiting for a threshold.',
      consent: 'I agree to receive one launch notification by text. Unsubscribe any time.',
    },
    steps: {
      heading: 'How the money works',
      items: [
        {
          title: 'The fee is the fee',
          body: '$2.99 for the delivery plus $1.00 per kilometre. That is what the customer pays for delivery, and it is what you are paid.',
        },
        {
          title: 'All of it reaches you',
          body: 'We take no cut of the delivery fee. Not a service charge, not a platform fee, not a percentage — none of it.',
        },
        {
          title: 'Paid every Monday',
          body: 'Automatically, with no minimum payout. You are not waiting to clear a threshold before your own money is released.',
        },
      ],
    },
    faq: [
      {
        q: 'How much do I earn per delivery?',
        a: '$2.99 plus $1.00 per kilometre, and all of it is yours. A four-kilometre delivery is $6.99 to you.',
      },
      {
        q: 'Do you take a cut of the delivery fee?',
        a: 'No. One hundred percent of the delivery fee goes to the rider. That is a decision, not an introductory offer.',
      },
      {
        q: 'When am I paid?',
        a: 'Every Monday, automatically. No minimum payout, and nothing to claim.',
      },
      {
        q: 'What about tips?',
        a: 'A tip is added by the customer on top of the delivery fee, and it is yours.',
      },
    ],
    finalCta: {
      heading: 'Deliver from day one.',
      body: 'We’ll text you when we start onboarding riders in your city.',
    },
  },
};
