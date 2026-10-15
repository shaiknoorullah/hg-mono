/** Application-level decisions (canvas SI `Ref-Rejections`, table 3). Slate, never red; the note is verbatim. */
export interface ApplicationView {
  title: (name: string) => string;
  body: (name: string) => string;
}

const n = (name: string) => name || 'Your restaurant';

const VIEWS: Record<string, ApplicationView> = {
  DOCUMENTS_INSUFFICIENT: { title: () => 'The documents weren’t enough to approve this application', body: () => 'The reviewer’s note below says what was missing.' },
  HALAL_CERTIFICATION_INVALID: { title: () => 'We couldn’t accept your halal certification', body: (name) => `We can’t list ${n(name)} as halal-certified with the certification we received.` },
  IDENTITY_UNVERIFIED: { title: () => 'We couldn’t confirm who owns the restaurant', body: () => 'The identity documents didn’t let us confirm the owner.' },
  OUTSIDE_SERVICE_AREA: { title: (name) => `${n(name)} is outside the area we serve`, body: () => 'HalalGoes delivers in Ontario at launch.' },
  PROHIBITED_CUISINE_OR_PRODUCT: { title: (name) => `We can’t list what ${n(name)} sells`, body: () => 'Some of what the restaurant sells can’t be listed on HalalGoes.' },
  SUSPECTED_FRAUD: { title: () => 'We couldn’t verify your application', body: () => 'We couldn’t confirm the details you sent.' },
  DUPLICATE_APPLICATION: { title: () => 'This restaurant already has an application', body: () => 'We’re already reviewing, or have reviewed, another application for this restaurant.' },
};

/** An unknown or missing code reads "A reviewer left a note": the raw code is never shown. */
export function rejectionApplicationView(code: string | null | undefined): ApplicationView {
  return (code && VIEWS[code]) || { title: () => 'A reviewer left a note', body: () => '' };
}
