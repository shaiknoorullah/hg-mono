/** Words on the issuing bodies screens, lifted from the `Bodies*` boards. */
export const BODIES = {
  title: 'Issuing bodies',
  subtitle: 'The registry the Issuer accepted check uses',
  filterLabel: 'Status',
  filters: [
    { value: 'ALL', label: 'Every status' },
    { value: 'PROPOSED', label: 'Proposed, waiting for review' },
    { value: 'ACCEPTED', label: 'Accepted' },
    { value: 'SUSPENDED', label: 'Suspended' },
    { value: 'RETIRED', label: 'Retired' },
    { value: 'REJECTED', label: 'Rejected' },
  ],
  caption: 'Issuing bodies, proposed first, then by name',
  captionSupport: 'Issuing bodies (support agents see name and status only)',
  foot: 'Accepting or reinstating a body widens what HalalGoes will call halal: each change needs a written justification.',
  footReadOnly: 'Only super admins change a body’s status.',
  loading: 'Loading issuing bodies',
  error: { title: 'Issuing bodies didn’t load', body: 'The server didn’t respond. Nothing was changed.' },
  empty: { title: 'No issuing bodies', body: 'There are no issuing bodies to show.' },
  emptyProposed: {
    title: 'No proposed bodies are waiting',
    body: 'When an admin proposes an issuer from a certificate, it appears here for review.',
  },
  showEvery: 'Show every status',
  waitingNote: 'Waiting for a super admin',
  changeNote: 'Super admins change status',
  confirmation: { needed: 'Needed before each approval', notNeeded: 'Not needed' },
  unknownStatus: 'Status not recognised',
} as const;

export const BODY_PANEL = {
  reviewTitle: (name: string) => `Review a proposed issuing body: ${name}`,
  changeTitle: (name: string) => `Change status: ${name}`,
  reviewSubtitle: 'A proposed body is accepted or rejected. Nothing else is possible from here.',
  changeSubtitle: (status: string) => `Now ${status}.`,
  statusLabel: 'New status',
  justification: 'Justification',
  justificationHelp: 'At least 20 characters. It is recorded with your name.',
  confirmation: 'Each certificate from this body must be confirmed with the issuer before approval',
  confirmationHelp: 'Only with Accept.',
  save: 'Save decision',
  cancel: 'Cancel',
  saved: (name: string, status: string) => `${name} is now ${status}.`,
  widens: 'Accepting or reinstating a body widens what HalalGoes will call halal. Only a certificate from an Accepted body passes the Issuer accepted check.',
  narrows:
    'Certificates already approved under this body are not revoked. No new certificate from it can be approved, and a restaurant whose only vouching certificate came from it loses its halal badge and, if live, is hidden from customers. Owners and managers are told.',
  mfa: {
    title: 'Two-step sign-in is needed for this',
    body: 'Changing a body’s status needs a session signed in with an authenticator code. Sign in again with your code, then repeat this change. Nothing was changed.',
  },
  forbidden: { title: 'You can’t do this', body: 'Only super admins change a body’s status. Nothing was changed.' },
  gone: { title: 'This body no longer exists', body: 'Reload the list. Nothing was changed.' },
  unknown: {
    title: 'The server didn’t answer in time',
    body: 'The change may or may not have been recorded. Press Save decision again: it is sent as the same request, so it is applied once.',
  },
} as const;
