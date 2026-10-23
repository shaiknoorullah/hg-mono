/** Words on the menu review and edit-on-behalf screens, lifted from the boards. */
export const REVIEWS = {
  title: 'Menu reviews',
  listCaption: 'Waiting for review, oldest first',
  count: (n: number, more: boolean) => `Showing ${n}${more ? ' so far' : ''}`,
  loading: 'Loading menu versions',
  error: { title: 'Menu reviews didn’t load', body: 'The server didn’t respond. Nothing was changed.' },
  empty: {
    title: 'Nothing waiting for review',
    body: 'Every menu change restaurants sent has a decision. Items an admin adds or edits for a restaurant are approved when saved and recorded with their name.',
  },
  notWaiting: {
    title: 'This version isn’t waiting for review',
    body: 'It was decided, withdrawn or replaced. The queue shows what is still waiting.',
  },
  pickOne: 'Pick a version to read it and decide.',
  hint: 'Words, photos and dietary and allergen tags wait for review before customers see them',
  notCertificate:
    'The halal status customers see comes from the restaurant’s approved certificate, never from a menu item. A restaurant can’t tag an item Halal certified.',
  consequence: 'Approving makes this version live at once. Rejecting sends the restaurant your reason word for word; they can fix it and send it again.',
  waiting: 'Waiting for review',
  rejectTitle: (name: string | undefined, version: number | undefined) => `Reject version ${version ?? '(number not recorded)'} of ${name ?? 'this item'}`,
  rejectBody: 'The restaurant sees the reason and your note word for word. The live version stays on the menu until a new one is approved.',
  decisionOff: 'Approve and Reject are off while the panel is open.',
  approved: (name: string | undefined, v: number | undefined) => `Approved version ${v ?? '(number not recorded)'} of ${name ?? 'the item'}. It is live now.`,
  rejected: (name: string | undefined, v: number | undefined) => `Rejected version ${v ?? '(number not recorded)'} of ${name ?? 'the item'}. The restaurant has your reason.`,
  locked: (state: string | null) => ({
    title: 'This restaurant’s menu is locked',
    body: `The restaurant is ${state ? state.toLowerCase() : 'suspended or banned'}. Its pending versions stay in the queue and stay readable, but they can’t be decided until the suspension is lifted. Nothing was changed.`,
  }),
  alreadyDecided: {
    title: 'Someone else decided this version first',
    body: 'Nothing was sent from here. The queue no longer lists it. The server does not say who decided or when.',
  },
  itemDeleted: {
    title: 'The restaurant removed this item',
    body: 'A version of a removed item can’t be decided. Nothing was sent from here.',
  },
  forbidden: { title: 'You can’t decide menu versions', body: 'Your role does not include menu review. Nothing was changed.' },
  unknown: {
    title: 'The server didn’t answer in time',
    body: 'The decision may or may not have been recorded. Press the button again: it is sent as the same request, so it is applied once.',
  },
  backToQueue: 'Back to the queue',
  editItem: 'Edit this item for the restaurant',
} as const;

export const ON_BEHALF = {
  title: 'Menu item',
  heading: (restaurantId: string) => `Edit a menu item for restaurant ${restaurantId}`,
  intro:
    'For when a restaurant asks HalalGoes to fix something it can’t, or support needs a dish off the menu now. Your edit goes live when you save and is recorded with your name.',
  blank: 'Leave a field blank to keep it as it is. The server does not let this screen read the item, so the current values are not shown.',
  pricePrefix: 'The price is checked by the server. Between $0.50 and $500.00.',
  save: 'Save and publish',
  saving: 'Saving. Nothing goes live until the server confirms.',
  cancel: 'Cancel',
  fieldsFixing: (n: number) => `${n} ${n === 1 ? 'field needs' : 'fields need'} fixing. Nothing was saved.`,
  saved: 'Saved and live',
  savedBody: 'Your edit is live and recorded with your name.',
  notSaved: { title: 'Not saved', body: 'The server did not confirm. Your edits stay in the form; nothing was published.' },
  unknown: {
    title: 'The server didn’t answer in time',
    body: 'The edit may or may not have been saved. Press Save and publish again to check: it changes the same fields to the same values.',
  },
  notWritable: { title: 'That field can’t be set here', body: 'The halal claim comes from the restaurant’s certificate and can’t be written on an item. Nothing was saved.' },
  pending: {
    title: 'The restaurant has an edit waiting for review',
    body: 'Decide that version first. A restaurant’s own edit is never silently discarded. Nothing was saved.',
    action: 'Open menu reviews',
  },
  gone: { title: 'This item isn’t on the restaurant’s menu', body: 'It was removed or never existed. Nothing was saved.' },
  forbidden: { title: 'You can’t edit menus', body: 'Your role does not include menu editing. Nothing was saved.' },
  removeHeading: 'Remove from the menu',
  removeBody: 'Customers stop seeing it at once. Orders already placed keep the item exactly as they bought it.',
  removeOpen: 'Remove this item…',
  removeTitle: 'Remove this item from the restaurant’s menu?',
  removeConfirmBody: 'Customers stop seeing it at once. Orders already placed keep the item exactly as they bought it. A version waiting for review is withdrawn. Recorded with your name.',
  keep: 'Keep it',
  remove: 'Remove',
  removed: { title: 'Item removed', body: 'Customers no longer see it. Orders already placed keep it. Recorded with your name in the audit log.' },
  backToMenuReviews: 'Back to menu reviews',
  removeFailed: { title: 'Not removed', body: 'The server did not confirm. The item is still on the menu.' },
} as const;
