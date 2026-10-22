/** The What's new copy, as data. Verbatim from the settings boards `WhatsNew-*` (canvas `PartWhatsNew`) where they draw it. */
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

export const WHATS_NEW = {
  menuItem: "What's new",
  menuItemNew: "What's new · new notes",
  section: "What's new",
  panelTitle: "What's new since you last looked",
  panelTitleUpToDate: "What's new",
  close: "Close what's new",
  gotIt: 'Got it',
  newToYou: 'New to you',
  version: 'Version',
  sinceIntro: (n: number) => `${WORDS[n] ?? String(n)} ${plural(n, 'update', 'updates')} since you last looked. Newest first.`,
  firstIntro: (version: string) => `You're on version ${version}. This is the latest update.`,
  allIntro: (version: string) => `You're on version ${version}. Every update, newest first.`,
  upToDate: {
    title: "You're up to date",
    body: (version: string) => `You're on version ${version} and you've seen its notes. Notes for the next update appear here.`,
  },
  error: {
    title: "Couldn't load the release notes",
    body: "This doesn't affect your orders or your account.",
    retry: 'Try again',
  },
  loading: 'Loading the release notes',
  settingsStatus: (version: string) => `Version ${version}`,
} as const;
