/** The What's new copy, verbatim from the customer boards `AC/WhatsNew*` (canvas `account`). */
export const WHATS_NEW = {
  /** The Account row, and the page's title. */
  title: "What's new",
  rowSubline: (version: string) => `Version ${version}`,
  back: 'Account',
  sheetTitle: "What's new in HalalGoes",
  introOne: "Here's what changed in this update.",
  introMany: (n: number) => `Here's what changed in the ${n} updates since you last looked.`,
  gotIt: 'Got it',
  footerLine: "You can read these again in Account, then What's new.",
  version: (v: string) => `Version ${v}`,
  yourVersion: 'Your version',
  empty: {
    title: 'Nothing new to show yet',
    body: "When an update changes something you'll notice, we'll describe it here.",
    youHave: (version: string) => `You have version ${version}. The App Store and Google Play list what changed in every version.`,
    store: 'See notes in the app store',
  },
} as const;
