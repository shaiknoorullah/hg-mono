/**
 * Consent configuration for Klaro.
 *
 * Two positions this file takes, both deliberate:
 *
 * 1. **Everything is off until someone says yes.** `default: false` and
 *    `required: false` on every service, and no service fires on page load.
 *    That is stricter than PIPEDA needs for cookieless analytics, and it is the
 *    same rule the product applies to a halal claim: silence is never consent.
 *    A platform whose entire pitch is "we checked, we didn't assume" cannot
 *    opt people into tracking by default.
 *
 * 2. **Declining is as easy as accepting.** `acceptAll` and `declineAll` both
 *    render, as buttons of equal weight. A banner with one obvious button and a
 *    buried link is a dark pattern, and increasingly an unlawful one.
 */

export type ConsentServiceName = 'umami' | 'ads';

export const KLARO_CONFIG = {
  // Bumping this invalidates stored consent and re-asks. Bump it whenever a
  // service is added, or when one starts doing something new.
  version: 1,
  elementID: 'hg-consent',
  storageMethod: 'localStorage',
  storageName: 'hg-consent',
  cookieExpiresAfterDays: 180,

  // Render the notice but do not block the page behind a modal: a wall in front
  // of the content is a worse first impression than a bar beneath it, and it
  // pushes people to click accept to make it go away, which is not consent.
  mustConsent: false,
  acceptAll: true,
  hideDeclineAll: false,
  hideLearnMore: false,
  noticeAsModal: false,

  // Nothing here is legitimate-interest. If it is not consented, it is off.
  default: false,
  required: false,

  translations: {
    en: {
      consentNotice: {
        title: 'Cookies',
        description:
          'We would like to measure how this page is used, and — once we advertise — whether an ad led you here. Nothing is switched on until you say so.',
        learnMore: 'Choose',
      },
      consentModal: {
        title: 'What we would like to use',
        description:
          'Everything below is off by default and stays off unless you turn it on. You can change this at any time from the link in the footer.',
      },
      acceptAll: 'Accept all',
      acceptSelected: 'Save choices',
      decline: 'Decline',
      close: 'Close',
      ok: 'Accept all',
      save: 'Save choices',
      poweredBy: '',
      purposes: {
        analytics: { title: 'Measurement' },
        advertising: { title: 'Advertising' },
      },
      umami: {
        title: 'Umami',
        description:
          'Our own analytics, running on our own server. It counts page views and where they came from. It sets no cookie, follows nobody between sites, and records no personal data.',
      },
      ads: {
        title: 'Advertising pixels',
        description:
          'Lets an ad platform know that a visit turned into a signup, so we stop paying for ads that do not work. This one does follow you between sites, which is why it is off unless you allow it.',
      },
    },
  },

  services: [
    {
      name: 'umami' satisfies ConsentServiceName,
      purposes: ['analytics'],
      default: false,
      required: false,
      // No cookies to clear, so no reload is needed when it is switched off —
      // the script simply never runs again.
      cookies: [],
    },
    {
      name: 'ads' satisfies ConsentServiceName,
      purposes: ['advertising'],
      default: false,
      required: false,
      // Withdrawing advertising consent has to reload: a pixel already in the
      // page cannot be un-run, and leaving it live would make the toggle a lie.
      onlyOnce: false,
      cookies: [/^_fbp$/, /^_gcl/, /^_ttp$/],
    },
  ],
} as const;
