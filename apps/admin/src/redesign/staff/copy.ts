/**
 * Staff screens' words, as data. Verbatim from the staff boards unless a line says otherwise.
 *
 * Where a board's sentence is not true of the server it is changed here and listed in the pull
 * request: the two-step sign-in is opt-in for staff (owner decision of 5 October 2026), a
 * deactivated account's email is refused rather than reactivated, and nothing in the console
 * removes access, resets sign-in or cancels an invite.
 */
export const LIST = {
  subtitle: 'Who can sign in to the admin console, what their role allows, and whether two-step sign-in is set up.',
  invite: 'Invite staff',
  inviteSecondSuper: 'Invite a second super admin',
  inviteSuper: 'Invite a super admin',
  inviteOffline: "Available when you're back online",
  caption: 'Staff accounts',
  loading: 'Loading staff accounts',
  error: { title: "Staff accounts didn't load", body: 'The server didn’t answer. Nothing was changed. Try again.' },
  loadMoreFailed: { title: "The next accounts didn't load", body: (kept: number) => `The server didn't answer in time. The ${kept} accounts above are kept.` },
  tryAgain: 'Try again',
  offline: { title: 'You’re offline.', body: 'Changes are off until the connection returns. Nothing you do now is saved for later.' },
  find: { label: 'Find by name or email', labelNameOnly: 'Find by name', help: (loaded: number) => `Searches the ${loaded} accounts loaded so far, on this device.` },
  findCount: (shown: number, loaded: number, query: string, more: boolean) =>
    `${shown} of ${loaded} loaded accounts ${shown === 1 ? 'matches' : 'match'} “${query}”.${more ? " More accounts aren't loaded yet and may match: load more to search them too." : ''}`,
  findNone: (query: string) => ({ title: `No loaded account matches “${query}”`, body: 'Check the spelling, or clear the search.' }),
  clearFind: 'Clear search',
  adminLine: (names: string) => (names ? `You can view staff accounts. Only a super admin can invite staff: ${names}.` : 'You can view staff accounts. Only a super admin can invite staff.'),
  onlyYou: {
    title: 'Only you so far',
    body: 'Invite the people who will review applications and help customers. Each one gets a link to set their own password; two-step sign-in is optional and they can turn it on later.',
    second: 'The platform must keep at least two active super admins, so start with a second super admin.',
  },
  superOnlyOne: { title: 'Only one super admin is active.', body: 'The platform needs two; invite another super admin.' },
  superInvited: (name: string) => ({
    title: 'Only one super admin is active.',
    body: `${name} was invited as a super admin but hasn't accepted yet. The platform must keep at least two active; their link works for 72 hours from when it was sent.`,
  }),
  you: 'You',
  neverSignedIn: 'Never',
  mfa: { on: 'Set up', off: 'Not set up', whenAccept: 'Set up when they accept', never: 'Never set up' },
  inviteExpired: 'Invite link expired',
  neverAccepted: '· invite never accepted',
  unknownRole: 'Unrecognised role',
  statusesTitle: 'What the statuses mean',
  statuses: [
    ['Invited', "hasn't accepted yet. The link works for 72 hours."],
    ['Suspended', "can't sign in. Restoring an account isn't in the console yet."],
    ['Deactivated', "can't sign in, and their sessions have ended."],
  ] as const,
  rolesTitle: 'What each role can do',
  roles: {
    SUPPORT_AGENT:
      "Reads the restaurant application queue and orders with personal details masked; opens a rider's application only from its support case. Cancels an order only before the restaurant accepts. Refunds up to a set daily limit. No review decisions and no staff list.",
    ADMIN:
      'Makes review decisions: documents, halal certificate checks, restaurant and rider applications, menu reviews and restaurant profile changes. Adds, changes or removes a menu item for a restaurant; those edits go live on save and are recorded in the audit log. Cancels an order at any stage; after the restaurant accepts, linking a support case is optional. Refunds up to a set daily limit. Sees names, roles and status in this list.',
    SUPER_ADMIN: "Everything an admin can do, plus inviting staff, changing an issuing body's status, and revoking a certificate. The platform must keep at least two active super admins.",
  },
  rolesNote: "Main differences shown; the full list is set by the platform and can't be edited. Changing someone's role isn't in the console yet. Nobody can change their own role or approve their own refund.",
} as const;

export const DETAIL = {
  closeLabel: 'Close',
  loading: 'Loading this account…',
  notFound: {
    title: "This account couldn't be opened",
    body: "No staff account in the loaded list matches this link. It may be on a page that isn't loaded yet, or the link may be wrong. The staff list behind this panel is still here.",
    loadMore: 'Load more accounts',
  },
  listFailed: { title: "This account couldn't be opened", body: 'The staff list didn’t load, so this account can’t be found. Try again.' },
  labels: { email: 'Email', mfa: 'Two-step sign-in', last: 'Last sign-in', added: 'Added', id: 'Account ID', role: 'Role', status: 'Status' },
  mfaNote: 'Two-step sign-in is optional for staff. Moving money needs it.',
  neverSignedIn: 'Never',
  copyId: 'Copy account ID',
  copied: 'Account ID copied',
  copyFailed: 'Couldn’t copy. Select the ID and copy it.',
  changes: 'Changes to this account',
  none: "Changing the role, suspending, restoring and resending an invite aren't in the console yet.",
  active: {
    lead: 'Someone leaving, or an account you think is misused? Remove access now: the platform on-call engineer does it for you until the console can.',
    remove: 'Remove access now',
    reset: 'Reset two-step sign-in',
    resetHelp: "Lost authenticator app? Reset two-step sign-in after you've confirmed who they are. There are no recovery codes.",
  },
  invited: {
    body: "They haven't accepted yet. Resending an invite isn't in the console yet. To stop them joining, cancel the invite.",
    expired:
      "They can't accept. Resending an invite isn't in the console yet. If nobody resends it, the account is deactivated 7 days after the link expired; to close it sooner, cancel the invite.",
    cancel: 'Cancel this invite',
    linkEnds: 'Link works until',
  },
  suspended: "They can't sign in. Restoring an account isn't in the console yet: call the platform on-call engineer and give them the account ID.",
  deactivated: "They can't sign in, and their sessions have ended. Bringing them back isn't in the console yet. Inviting the same email again is refused while the account exists.",
  unknownRole: {
    body: "The server sent a role this console doesn't know, so it's shown exactly as sent. Call the platform on-call engineer to find out what it allows, and give them the account ID. If you don't expect this account to have access, remove it now.",
  },
  self: { body: 'This is your account. Nobody can change their own role or status. Change your password, or sign out everywhere if you lose a phone or laptop, from Your account.', open: 'Open Your account' },
  admin: (names: string) =>
    names
      ? `To remove this person's access or reset their two-step sign-in, ask a super admin: ${names}. Other changes aren't in the console yet.`
      : "To remove this person's access or reset their two-step sign-in, ask a super admin. Other changes aren't in the console yet.",
} as const;

export const ONCALL = {
  back: 'Back to account',
  call: 'Call the platform on-call engineer.',
  noContact: {
    title: 'The on-call contact isn’t set up in this build',
    body: 'Ask the owner for the platform on-call engineer’s name and number, and read the runbook meanwhile.',
  },
  callButton: (name: string, phone: string) => `Call ${name} · ${phone}`,
  runbook: 'Open the platform runbook',
  giveId: 'Give them the account ID.',
  stay: 'Stay on the call until they confirm.',
  remove: {
    title: (name: string) => `Remove ${name}’s access`,
    urgent: 'Do this now, not at the end of the day',
    until: (name: string, role: string) => `Until access is removed, ${name} can still sign in and act as ${role}.`,
    why: "The console can't remove access yet, so the platform on-call engineer does it for you, at any hour:",
    ask: 'Ask them to deactivate the account and end every session.',
    askNote: 'Sessions end within a minute, on every device.',
    after: (name: string) => `${name}'s status here then changes to Deactivated.`,
  },
  reset: {
    title: (name: string) => `Reset two-step sign-in for ${name}`,
    intro:
      "Use this when someone has lost their authenticator app or phone. There are no recovery codes. The console can't reset it yet, so the platform on-call engineer does it for you, at any hour, once you've confirmed who is asking:",
    confirm: (name: string) => `Confirm it’s really ${name}.`,
    confirmBody: (name: string) =>
      `Only a super admin does this. Contact ${name} by a route you already trust, never details the caller gives you, and have them match two details on the account, such as their work email and their role. A message or email alone isn’t enough: someone with their email could be asking.`,
    tell: 'Tell them how you confirmed it.',
    tellBody: 'For example: called back on the number on file, matched work email and role. They put it in the audit log with your name.',
    after: 'Their authenticator then stops working and all their sessions end. Tell them to sign in with their password; they can turn two-step sign-in on again from Your account.',
  },
  cancel: {
    title: (name: string) => `Cancel ${name}’s invite`,
    urgent: "Cancel it now if they shouldn't join",
    until: (name: string) => `Until it’s cancelled, the link in their email works until it expires, and ${name} could set up an account.`,
    expiredWarn: "The link has already expired, so they can't set up an account. Cancelling closes the account now instead of 7 days after the link expired.",
    why: "The console can't cancel an invite yet, so the platform on-call engineer does it for you, at any hour:",
    ask: 'Ask them to deactivate the account so the link stops working.',
    askNote: (name: string) => `${name} can't set up an account after that. There are no sessions to end: they never signed in.`,
    after: (name: string) => `${name}’s status here then changes from Invited to Deactivated. To invite them later, ask the platform on-call engineer: inviting the same email is refused while the account exists.`,
  },
} as const;

export const INVITE = {
  title: 'Invite a staff member',
  intro: 'They get an email link that works for 72 hours. They set their own password; two-step sign-in is optional and they can turn it on later. You never see or set their password.',
  name: 'Full name',
  email: 'Work email',
  role: 'Role',
  roleHelp: 'Choose the smallest role that lets them do the job. The invite is recorded in the audit log with your name.',
  secondSuper: "You're the only active super admin. Choose Super admin so the platform has two.",
  cancel: 'Cancel',
  send: 'Send invite',
  sending: 'Sending the invite',
  sendAgain: 'Send again',
  offlineHelp: "Available when you're back online",
  fixForm: 'Fix the fields marked below, then send again.',
  duplicate: {
    title: 'No invite was sent',
    known: (name: string, role: string, status: string) => `${name} (${role}, ${status}) already uses this email. Nothing was changed.`,
    unknown: 'This email already belongs to an account. Nothing was changed.',
    unloaded: "The matching account isn't in the loaded list, so there is no name or link.",
    open: (name: string) => `Open ${name}’s account`,
  },
  rejected: { title: 'No invite was sent', body: 'The server turned these details down. Fix the field marked below, then send again.' },
  limited: { title: 'No invite was sent', body: 'Too many invitations today. Try again tomorrow.' },
  unknown: {
    title: "We couldn't confirm the invite was sent",
    body: 'The server didn’t answer in time, so it may or may not have been sent. Your details are still here. Sending again won’t make a second invite: if the first one went through, this email is already taken and we’ll check the list for it.',
    offline: 'You went offline while sending, so it may or may not have been sent. Your details are still here. Send again when you’re back online.',
  },
  forbidden: { title: "You can't invite staff any more", body: 'Your role changed while this page was open. No invite was sent.', cont: 'Continue' },
  sent: {
    title: (name: string) => `Invite sent to ${name}`,
    body: (email: string) => `They’ll get an email at ${email}. The link works for 72 hours.`,
    recovered: (name: string) => `The invite to ${name} did go through. Their account is in the list as Invited.`,
    open: (name: string) => `Open ${name}’s account`,
  },
} as const;
