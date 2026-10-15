/**
 * The platform on-call engineer, whom a super admin calls for the account changes the console
 * cannot make yet (remove access, reset two-step sign-in, cancel an invite, restore).
 *
 * The name and number are not in the repository and are not invented here (naming them is
 * https://github.com/shaiknoorullah/hg-mono/issues/169): they come from the
 * build's environment. Without them the panels say so instead of showing a made-up number.
 */
export interface OnCallContact {
  readonly name: string;
  readonly phone: string;
}

export function onCallContact(env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>): OnCallContact | null {
  const name = env['VITE_HG_ONCALL_NAME']?.trim();
  const phone = env['VITE_HG_ONCALL_PHONE']?.trim();
  return name && phone ? { name, phone } : null;
}

/** The incident runbook (https://github.com/shaiknoorullah/hg-mono/issues/66). */
export const RUNBOOK_URL = 'https://github.com/shaiknoorullah/hg-mono/issues/66';

/** `tel:` wants digits and a leading plus only. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}
