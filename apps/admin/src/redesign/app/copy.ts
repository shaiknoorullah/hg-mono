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
