/**
 * How the admin boards draw a status Badge: a 4 px corner and, on the warning and info tints, the
 * lightest border of that tint (`STF/StaffList`: #FDDDC4 and #CBDFFC), not the strong one the shared
 * Badge draws. A `style` to pass to `Badge`, which wins over the shared classes; the shared Badge
 * itself stays as it is.
 */
import type { CSSProperties } from 'react';

const BORDER: Record<string, string> = {
  warning: 'var(--hg-color-warning-100)',
  info: 'var(--hg-color-info-100)',
};

export function boardBadge(variant: string, lineHeight?: string): CSSProperties {
  const border = BORDER[variant];
  return { borderRadius: 4, ...(border ? { borderColor: border } : {}), ...(lineHeight ? { lineHeight } : {}) };
}
