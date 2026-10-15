/**
 * The platform on-call engineer, named in the build config (`VITE_HG_ONCALL_NAME`,
 * `VITE_HG_ONCALL_PHONE`), because the owner names the person before launch (open question
 * "who is on call?" on the boards, where both read `[ON-CALL NAME]` and `[ON-CALL PHONE]`).
 *
 * When neither is set the page does NOT print a placeholder as if it were a number: staging and
 * local builds show the board's placeholders so the screen can be reviewed against its board;
 * production shows no call button, only the instruction to call the on-call engineer.
 */
const NAME = (import.meta.env['VITE_HG_ONCALL_NAME'] as string | undefined)?.trim() ?? '';
const PHONE = (import.meta.env['VITE_HG_ONCALL_PHONE'] as string | undefined)?.trim() ?? '';
const ENV = ((import.meta.env['VITE_HG_ENV'] as string | undefined) ?? '').trim().toLowerCase();

export interface OnCall {
  readonly name: string;
  readonly phone: string;
}

/** The runbook the boards link (the platform runbook, kept in the repository). */
export const RUNBOOK_URL = 'https://github.com/shaiknoorullah/hg-mono/issues/66';

export function onCallContact(name: string = NAME, phone: string = PHONE, env: string = ENV): OnCall | null {
  if (name && phone) return { name, phone };
  return env === 'dev' || env === 'staging' || env === 'local' ? { name: '[ON-CALL NAME]', phone: '[ON-CALL PHONE]' } : null;
}

/** `tel:` href that keeps only what a phone can dial. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '') || phone}`;
}
