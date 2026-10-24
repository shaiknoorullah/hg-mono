/** The shell's own page copy (WP-1), as data. Verbatim from `RV/Shell-Forbidden` where drawn. */
export const FORBIDDEN = {
  heading: 'No permission',
  title: 'You don’t have permission for this',
  body: (roleLabel: string, needs: string) =>
    `Your role, ${roleLabel}, doesn’t include the permission this page needs: ${needs}. Nothing was changed. If you need it, ask a super admin.`,
} as const;

export const NOT_FOUND = {
  heading: 'Page not found',
  title: 'There’s no page at this address',
  body: 'The link may be old or mistyped. Nothing was changed.',
} as const;

export const NOT_BUILT = {
  title: 'Not built yet',
  body: (page: string, wp: string) => `${page} comes with ${wp} of the admin redesign. Nothing on this page works yet.`,
} as const;

/**
 * The staff pages draw their own 403 (`STF/StaffSupportDenied`, `STF/StaffDetailSupportDenied`):
 * the app bar keeps the page's name and the card says why in staff terms. Every other route keeps
 * the generic "No permission" page above, because no board draws a specific one.
 */
export const STAFF_FORBIDDEN = {
  title: 'Staff accounts are for admins and super admins',
  list: (roleLabel: string) => `You're signed in as a ${roleLabel}, so this page isn't in your menu.`,
  detail: (roleLabel: string) =>
    `This link opens a staff account, and you're signed in as a ${roleLabel}, so it isn't available to you. Nothing about the account is shown.`,
  /** The list board adds the role note; the detail board stops at "ask a super admin" (`STF/StaffDetailSupportDenied`). */
  help: "If you need access, ask a super admin. Changing a role isn't available in the console yet.",
  detailHelp: 'If you need access, ask a super admin.',
  detailSubtitle: 'Opened from a link to one staff account',
} as const;
