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
  },
};
