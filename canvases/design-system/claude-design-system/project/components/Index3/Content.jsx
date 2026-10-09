/* Content.jsx: every factual line the marketing kit shows, transcribed from
   apps/marketing/src/lib/claims.ts (claims win) and apps/marketing/src/lib/audiences.ts (voice).
   Rule from claims.ts: if a line cannot carry a source, it does not go on the page.
   Removed on purpose (claims.ts REJECTED or K-findings): named cities / "Greater Toronto Area",
   "keep every dollar / the whole ticket", "we'll tell you before it changes" (no notice period
   exists), "no minimum payout" (unsourced), "a broken seal gets you a refund", "live in two
   working days", "no contract, no exclusivity", any SMS promise, the badge download (K-27). */

const MK = {
  DISCLAIMER: 'Certification verified by HalalGoes on the date shown on each listing. HalalGoes does not itself certify food.',
  PLACE: 'Ontario',
  MONEY: { commission: '0%', deliveryBase: '$2.99', deliveryPerKm: '$1.00', payoutDay: 'Monday', tip: '100%' },
  COMMISSION_FINE_PRINT: '0% commission applies at launch. Commission is set per restaurant and is switchable, so we do not describe it as permanent. Payment processing fees still apply.',
};

/* claims.ts CHECKS, halal_checklist_version = 1, verbatim. by: human | system | both */
const CHECKS = [
  { key: 'H1_LEGIBLE_COMPLETE', title: 'The document is readable, whole, and unaltered', by: 'human',
    body: 'Every page present, nothing obscured, no sign the certificate has been edited. A person looks at the scan.' },
  { key: 'H2_ISSUER_ACCEPTED', title: 'The issuer is one we accept', by: 'both',
    body: 'The certifying body is on our accepted registry at the moment of review — and we print its name on the listing, so you can judge the issuer for yourself.' },
  { key: 'H3_NAME_MATCH', title: 'The certificate names this business', by: 'human',
    body: 'The legal name on the certificate is the restaurant’s registered legal name, or a recorded alias of it. Not a parent brand.' },
  { key: 'H4_ADDRESS_MATCH', title: 'The certificate covers this address', by: 'human',
    body: 'The certified address matches the premises being listed — or the certificate explicitly names multiple premises and this is one of them.' },
  { key: 'H5_DATES_VALID', title: 'It is in force today, with time left on it', by: 'system',
    body: 'Issued in the past, and not expiring within our minimum remaining window. The server computes this. No admin can wave it through.' },
  { key: 'H6_SCOPE_SUFFICIENT', title: 'It covers the food, not just the supplier', by: 'human',
    body: 'The scope has to cover the whole establishment or the kitchen. A certificate that only covers a meat supplier fails this check — it is the exact thing that gets mistaken for a restaurant being certified.' },
  { key: 'H7_UNIQUE_NOT_REUSED', title: 'It has not been used by anyone else', by: 'system',
    body: 'The certificate number is not already approved for a different restaurant. Also computed by the server, also not overridable.' },
];
const BY_LABEL = { human: 'A person', system: 'The server', both: 'Person + server' };

/* claims.ts ISSUERS: names only, never logos (CertifierRow.tsx: logos need permission). */
const ISSUERS = [
  { name: 'Halal Monitoring Authority (HMA Canada)', where: 'Ontario, Canada' },
  { name: 'Islamic Society of North America Canada (ISNA Canada)', where: 'Ontario, Canada' },
  { name: 'Halal Food Standards Alliance of America (HFSAA)', where: 'United States — certificates issued to Canadian establishments are accepted' },
];

/* claims.ts STATES */
const STATES = [
  { state: 'certified', display: 'CERTIFIED', label: 'Halal certified', body: 'A current certificate is on file, a person has checked it against all seven points, and the record says who checked it and when.', mono: 'RECORD SHOWN ON THE LISTING' },
  { state: 'expired', display: 'EXPIRED', label: 'Expired', body: 'The restaurant comes off the app until it is renewed. An expired certificate means our information has lapsed — not that anything is wrong with the food.', mono: 'DELISTED WITHIN 60 SECONDS' },
  { state: 'review', label: 'Under review', body: 'We have the paperwork and we have not finished checking it. Nothing is ever auto-approved on a timer.', mono: 'NOT VISIBLE TO CUSTOMERS' },
  { state: 'none', label: 'No record', body: 'If we have not read a certificate, you see nothing at all. Never a maybe, never an optimistic badge.', mono: 'NO BADGE RENDERED' },
];

/* claims.ts SEAL — do not overstate: a broken seal is reported by the customer, it never blocks or refunds automatically. */
const SEAL = [
  { step: 'AT THE KITCHEN', title: 'The kitchen seals the bag.', body: 'A tamper-evident label goes across the opening as they finish packing, and it is bound to your order alone. A seal never moves between orders.' },
  { step: 'AT PICKUP', title: 'Your rider scans it on collection.', body: 'The scan is what moves the order to picked up. Each code works once — a second use is rejected by the database.' },
  { step: 'AT YOUR DOOR', title: 'It is scanned again when it reaches you.', body: 'If a seal arrives broken you can report it with a photo, and the whole scan trail goes to a person to sort out.' },
];

const AUDIENCE_OPTIONS = [
  { value: 'customer', label: 'Order food' },
  { value: 'restaurant', label: 'List your restaurant' },
  { value: 'rider', label: 'Deliver with us' },
];

const TRACKS = {
  customer: {
    eyebrow: 'Launching in Ontario', eyebrowIcon: 'map', headerCta: 'Join the waitlist',
    headline: ['Verified halal,', 'delivered.'],
    lede: 'Seven checks on every restaurant, before it reaches you.',
    form: { label: 'Email address', placeholder: 'you@example.com', submit: 'Notify me', reassurance: 'No spam. One email, the day we open in your area.',
      consent: 'I agree to receive one launch email from HalalGoes, and news of newly verified kitchens near me afterwards. Unsubscribe any time.' },
    countLine: '[XX] certified restaurants ready for launch day', /* K-52 rejected by owner: kept as is */
    steps: { heading: 'How ordering works', items: [
      { icon: 'search', title: 'Pick a restaurant', body: 'Everything you can see has passed all seven checks. The seal on a listing comes down the day the certificate lapses.' },
      { icon: 'cart', title: 'Order', body: 'You see the full total before you pay. Change your mind before the restaurant accepts and the order is cancelled free — nothing is taken.' },
      { icon: 'map', title: 'Follow it to the door', body: 'Your rider’s position updates as they go, so you know whether to answer the door now or in ten minutes.' },
    ] },
    benefits: { heading: 'Why HalalGoes', sub: 'For people ordering', items: [
      { icon: 'check', title: 'A verified selection', body: 'Every listing carries the certifying body and the date we checked it.' },
      { icon: 'orders', title: 'The total before you pay', body: 'The amount shown is the amount charged. The delivery fee is $2.99 plus $1.00 per kilometre, and all of it goes to your rider.' },
      { title: 'Tips reach the rider', body: '100% of your tip goes to the person who brings your order.' },
    ] },
    faq: [
      ['What does “verified” mean here?', 'A person reads the restaurant’s halal certificate and records seven checks against it: that it is legible and complete, that the issuing body is one we accept, that the legal name matches, that the premises address matches, that the dates are valid today, that the scope covers everything sold, and that the certificate is not already in use by another restaurant. All seven have to pass.'],
      ['Whose certificates do you accept?', 'HMA Canada, HFSAA and ISNA Canada. A certificate from any one of them satisfies the issuer check. The list can grow as we accept more bodies; it is never typed in free-hand.'],
      ['What happens when a certificate expires?', 'The restaurant comes off the app until it is renewed. We don’t leave a badge up in hope, and an expired certificate means our information has lapsed — not that anything is wrong with the food.'],
      ['Do you decide what’s halal?', 'No. We check certificates issued by recognised bodies and report what we find. We don’t make religious rulings, and we don’t rank one certifier’s standard above another’s.'],
      ['What do you do with my email address?', 'Write to you when we open in your area, and after that only when there are newly verified kitchens near you. We don’t sell it and we don’t pass it to restaurants.'],
      ['When are you launching?', 'Ontario first. We’re pre-launch — this page is a waitlist, not a download, and there’s nothing to install yet.'],
    ],
    finalCta: { heading: 'Be there on day one.', body: 'One email the day we open in your area. Nothing before then.' },
  },
  restaurant: {
    eyebrow: 'Restaurants · Ontario', headerCta: 'Get early access',
    headline: ['0% commission', 'at launch.'],
    lede: 'A person checks your certificate seven ways, and your listing shows the record — who issued it, and when we checked it.',
    finePrint: MK.COMMISSION_FINE_PRINT, /* K-54 */
    form: { label: 'Email address', placeholder: 'owner@yourrestaurant.ca', submit: 'Get early access', reassurance: 'A person reads your certificate. Nothing is auto-approved, on a timer or otherwise.',
      consent: 'I agree to receive email about listing my restaurant. Unsubscribe any time.' },
    countLine: '[XX] restaurants already on the launch list', /* K-52 rejected by owner: kept as is */
    steps: { heading: 'What listing looks like', items: [
      { title: 'Send us four documents', body: 'Your business licence, your halal certificate, your food-safety permit, and owner ID. Certificates and ID sit in private storage — nothing is public.' },
      { icon: 'check', title: 'We check the certificate seven ways', body: 'If something’s missing we tell you which check failed, not just “rejected”. Every rejection carries a reason code.' },
      { title: 'Go live at 0% commission', body: 'Commission is 0% at launch, set per restaurant and switchable. Payouts land every Monday.' },
    ] },
    benefits: { heading: 'Why HalalGoes', sub: 'For restaurants', items: [
      { title: '0% commission at launch', body: 'Per restaurant and switchable. Payment processing fees still apply.' },
      { icon: 'clock', title: 'Paid every Monday', body: 'Payouts go out weekly, every Monday.' },
      { icon: 'orders', title: 'No paid ranking', body: 'A restaurant cannot pay for or influence its position in the feed.' },
    ] },
    faq: [
      ['What does 0% commission actually mean?', 'We take no commission on the order at launch. Commission is set per restaurant and can be switched, so we do not describe it as permanent. Payment processing fees still apply.'],
      ['What do you need from me?', 'Your business licence, your halal certificate, your food-safety permit and owner ID. The certificate and the ID are stored privately; what customers see is the issuing body, the certificate number, the dates and the day we verified it.'],
      ['What if my certificate is rejected?', 'You get the specific check that failed rather than a generic refusal, so you know whether it is a scope question, an address mismatch or a renewal you have not filed yet.'],
      ['When do I get paid?', 'Every Monday.'],
      ['Can I pay to rank higher?', 'No. A restaurant cannot pay for or influence its position in the feed.'],
    ],
    finalCta: { heading: 'List before we launch.', body: 'Leave your email and we will walk you through onboarding.' },
  },
  rider: {
    eyebrow: 'Riders · Ontario', headerCta: 'Start delivering',
    headline: ['The delivery fee', 'is yours. All of it.'],
    lede: '$2.99 plus $1.00 per kilometre, paid to you every Monday.',
    form: { label: 'Email address', placeholder: 'you@example.com', submit: 'Start delivering', reassurance: 'We’ll email you when we start onboarding riders in your area.',
      consent: 'I agree to receive one launch email from HalalGoes. Unsubscribe any time.' },
    steps: { heading: 'How the money works', items: [
      { icon: 'orders', title: 'The fee is the fee', body: '$2.99 for the delivery plus $1.00 per kilometre. That is what the customer pays for delivery, and it is what you are paid.' },
      { title: 'All of it reaches you', body: 'We take no cut of the delivery fee. Tips are yours too — 100% of every tip.' },
      { icon: 'clock', title: 'Paid every Monday', body: 'Payouts go out weekly, every Monday.' },
    ] },
    benefits: null,
    faq: [
      ['How much do I earn per delivery?', '$2.99 plus $1.00 per kilometre, and all of it is yours. A four-kilometre delivery is $6.99 to you.'],
      ['Do you take a cut of the delivery fee?', 'No. One hundred percent of the delivery fee goes to the rider.'],
      ['When am I paid?', 'Every Monday.'],
      ['What about tips?', 'A tip is added by the customer on top of the delivery fee, and 100% of it is yours.'],
    ],
    finalCta: { heading: 'Deliver from day one.', body: 'We’ll email you when we start onboarding riders in your area.' },
  },
};

/* Sample blog content: illustrative layout only, marked as sample. */
const POSTS = [
  { slug: 'seven-checks', title: 'What the seven checks are for', date: 'Sample date', dek: 'Each check exists because of a specific way a certificate can be misread. Here is which one catches what.' },
  { slug: 'scope', title: 'Why a supplier certificate is not a restaurant certificate', dek: 'Check six, and the mistake it exists to catch.' },
  { slug: 'expiry', title: 'What happens the day a certificate lapses', dek: 'Delisted, not flagged — and why that is the honest choice.' },
];

Object.assign(window, { MK, CHECKS, BY_LABEL, ISSUERS, STATES, SEAL, AUDIENCE_OPTIONS, TRACKS, POSTS });
