/** Words on the orders pages, lifted from the boards (`ORD/OrdersGrid` and its views). */
export const ORDERS = {
  subtitle: 'Every restaurant, newest first. Every lookup is audited.',
  disputesSubtitle: 'Orders in the Disputed state. All open disputes are loaded, then sorted by next deadline.',
  caption: 'Orders',
  captionRunning: 'Orders still running',
  captionDisputes: 'Disputed orders',
  loading: 'Loading orders',
  loadingDisputes: 'Loading disputes',
  empty: { title: 'No orders yet', body: 'Orders appear here as soon as a customer places one.' },
  noCode: (code: string) => ({
    title: `No order matches ${code}`,
    body: 'Check the code with the customer. Codes look like HG-8F3K2Q: HG, a dash, then six letters and digits, never I, L, O or U.',
  }),
  filtered: { title: 'No orders match these filters', body: 'Remove a filter above, or clear them all.' },
  error: { title: 'Orders didn’t load', body: 'Your filters are kept. Nothing was changed.' },
  moreFailed: (shown: number) => `More orders didn’t load. The ${shown} above are unchanged.`,
  endOfList: 'That’s every order for these filters.',
  offline: (noun: string) => `Showing ${noun} as of the last load. You can still open an order. Anything that changes an order is off until you reconnect, and nothing is queued.`,
  offlineTitle: 'You’re offline.',
  clear: 'Clear filters',
  tryAgain: 'Try again',
  refresh: 'Refresh',
  moreFilters: 'More filters',
  fewerFilters: 'Fewer filters',
  codeLabel: 'Order code',
  codeHelp: 'Like HG-8F3K2Q',
  restaurantLabel: 'Restaurant id',
  restaurantHelp: 'Checked as an id before searching. Picking by name needs an API: an id works now.',
  accountLabel: 'Account id',
  accountHelp: 'Checked as an id before searching.',
  notAnId: 'That isn’t an id. Ids look like 0191fa11-7c20-7e55-a1d0-2b8e41c99e04, so it wasn’t searched.',
  searchNote:
    'Searching by customer phone, email or name is not available yet. Until then, ask the customer for the code on their receipt, or use their account id.',
  runningNote: 'Still running: every order that has a deadline, Created through Rider arrived, Delivered and Disputed.',
} as const;

export const DISPUTES = {
  empty: { title: 'No open disputes', body: 'Nothing needs a decision. When a customer, restaurant or support reports a problem, the order appears here.' },
  noCode: (code: string) => ({
    title: `No disputed order matches ${code}`,
    body: 'That code isn’t in dispute, or doesn’t exist. Search it on Orders to see where it stands.',
  }),
  error: { title: 'Disputes didn’t load', body: 'Nothing was changed. Try again.' },
  loadingAll: (total: number | null) =>
    `Loading the rest of the open disputes before sorting by deadline. An older dispute can be the most urgent, so nothing is ordered until all ${total ?? 'of them'} are here.`,
  failedMore: (missing: number | null, loaded: number) =>
    `${missing === null ? 'The other open disputes' : `The other ${missing} open disputes`} didn’t load, so these ${loaded} aren’t in deadline order and one of the missing ones may be due sooner. Nothing was changed.`,
  endOfList: (total: number) => `That’s every open dispute: all ${total}, in deadline order.`,
  sorted: (loaded: number, total: number) => `${loaded} of ${total} open, sorted by next deadline, soonest first`,
  progress: (loaded: number, total: number | null) =>
    `Loading all open disputes: ${loaded}${total === null ? '' : ` of ${total}`} so far. Not sorted until all are here.`,
  failedCount: (loaded: number, total: number | null) => `${loaded}${total === null ? '' : ` of ${total}`} loaded, newest first. Not in deadline order.`,
} as const;
