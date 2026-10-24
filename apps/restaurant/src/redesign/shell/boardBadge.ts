/**
 * How the restaurant boards draw a status `Badge` in the console chrome: 13 px type on a 19.5 px
 * line (the shared Badge sets none), and on the tints the lightest border of that tint (info
 * #CBDFFC, danger #F6CFCB, warning #FDDDC4), not the 25 % mix of the strong one the shared Badge
 * draws. A `style` to pass to `ShellBadge`, which wins over the shared classes; the shared Badge
 * itself stays as it is. The design system has no tint-border role for these yet
 * (https://github.com/shaiknoorullah/hg-mono/issues/1042).
 */
import type { CSSProperties } from 'react';

const BORDER: Record<string, string> = {
  warning: 'var(--hg-color-warning-100)',
  info: 'var(--hg-color-info-100)',
  danger: 'var(--hg-color-danger-100)',
};

export function boardBadge(variant: string): CSSProperties {
  const border = BORDER[variant];
  return { lineHeight: 1.5, ...(border ? { borderColor: border } : {}) };
}
