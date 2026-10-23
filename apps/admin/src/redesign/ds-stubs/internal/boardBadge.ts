/**
 * How the admin boards draw a status Badge: a 4 px corner and, on the warning and info tints, the
 * lightest border of that tint (`STF/StaffList`: #FDDDC4 and #CBDFFC), not the strong one the shared
 * Badge draws. A className to pass to `Badge`; the shared Badge itself stays as it is.
 */
import { cx } from './cx';

const BORDER: Record<string, string> = {
  warning: 'border-[color:var(--hg-color-warning-100)]',
  info: 'border-[color:var(--hg-color-info-100)]',
};

export function boardBadge(variant: string): string {
  return cx('rounded-[4px]', BORDER[variant]);
}
