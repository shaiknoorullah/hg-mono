/** The queue's words, verbatim from `RV/QueueGrid` and `RV/Queue-*`. */
export const QUEUE = {
  caption: 'Applications, fixed order: oldest first',
  captionSupport: 'Applications, fixed order: oldest first (read-only for support)',
  takeNext: 'Take next',
  continueReview: 'Continue review',
  tryAgain: 'Try again',
  clearFilters: 'Clear filters',
  slaOnly: 'SLA breached only',
  slaBreached: 'SLA breached',
  slaWaiting: 'Waiting on the restaurant',
  slaNotInReview: 'Not in review',
  loading: 'Loading applications',
  claimStrip: (name: string, endsAt: string) =>
    `Your claim ends at ${endsAt}. Decide ${name} before taking another; after ${endsAt} it returns to the queue.`,
  filtered: {
    title: 'No applications match these filters',
    body: 'Nothing matches the state and SLA filters right now. Clear the filters to see the whole queue.',
  },
  drained: {
    title: 'Onboarding queue is clear',
    body: 'Every application has a decision. New applications appear here, oldest first. Take next is off until one arrives.',
  },
  noRecords: {
    title: 'No restaurants have applied yet',
    body: 'Applications appear here once a restaurant submits all four required documents.',
  },
  error: {
    title: 'The queue didn’t load',
    body: 'The server didn’t respond. Nothing was claimed and your filters are kept.',
  },
  takeNull: {
    title: 'No application was free to take',
    body: 'Everything waiting is claimed by another reviewer or is with its restaurant. Nothing was claimed. Try again in a few minutes.',
  },
  takeFailed: {
    title: 'Take next didn’t work',
    body: 'The server didn’t respond. Nothing was claimed. Your place in the table is kept.',
  },
  takeHeld: {
    title: (name: string) => `You already hold ${name}`,
    body: (name: string, endsAt: string) =>
      `Nothing new was claimed. Decide ${name} first, or it stays claimed until ${endsAt}. Continue review, above, takes you back to it.`,
  },
} as const;
