/**
 * Live design-system `Badge`. `@hg/ui-web` has no Badge (its `Chip` is interactive), so this
 * draws the live component's markup directly with role tokens.
 *
 * NOT the halal badge: there is no `success` and no `accent` variant, so nothing here can
 * paint a filled green (lint L-4). `appearance="solid"` with `danger` is never used for a
 * halal state (rule 9).
 */
import type { CSSProperties, ReactNode } from 'react';

import { cx } from '../internal/cx';
import { Icon, type AnyIconName } from './Icon.adapter';

export interface BadgeProps {
  children?: ReactNode;
  /** Alternative to children. */
  label?: ReactNode;
  variant?: 'neutral' | 'info' | 'warning' | 'danger' | 'brand' | 'outline';
  /** tint (default) · solid · dot. */
  appearance?: 'tint' | 'solid' | 'dot';
  /** sm 18 · md 22 · lg 26. */
  size?: 'sm' | 'md' | 'lg';
  icon?: AnyIconName;
  /** For numeric content: above `max` renders "{max}+". */
  max?: number;
  testId?: string;
  style?: CSSProperties;
  className?: string;
}

const TINT: Record<NonNullable<BadgeProps['variant']>, string> = {
  neutral: 'bg-surface-subtle text-fg-secondary border border-line-decorative',
  info: 'bg-feedback-info-tint text-feedback-info-tint-text border border-feedback-info-border',
  warning: 'bg-feedback-warning-tint text-feedback-warning-tint-text border border-feedback-warning-border',
  danger: 'bg-feedback-danger-tint text-feedback-danger-tint-text border border-feedback-danger-border',
  brand: 'bg-brand-50 text-fg-primary border border-line-brand',
  outline: 'bg-transparent text-fg-secondary border border-line-interactive',
};

const SOLID: Record<NonNullable<BadgeProps['variant']>, string> = {
  neutral: 'bg-surface-inverse text-fg-on-inverse',
  info: 'bg-feedback-info-solid text-feedback-info-on-solid',
  warning: 'bg-feedback-warning-solid text-feedback-warning-on-solid',
  danger: 'bg-feedback-danger-solid text-feedback-danger-on-solid',
  brand: 'bg-action-primary-bg text-action-primary-fg',
  outline: 'bg-transparent text-fg-secondary border border-line-interactive',
};

const DOT: Record<NonNullable<BadgeProps['variant']>, string> = {
  neutral: 'bg-fg-tertiary',
  info: 'bg-feedback-info-icon',
  warning: 'bg-feedback-warning-icon',
  danger: 'bg-feedback-danger-icon',
  brand: 'bg-action-primary-bg',
  outline: 'bg-line-interactive',
};

const SIZE = { sm: 'h-[18px] px-1.5 text-label-sm', md: 'h-[22px] px-2 text-label-sm', lg: 'h-[26px] px-2.5 text-label-md' };

export function Badge({
  children,
  label,
  variant = 'neutral',
  appearance = 'tint',
  size = 'md',
  icon,
  max,
  testId = 'Badge',
  style,
  className,
}: BadgeProps): React.JSX.Element {
  let content: ReactNode = children ?? label;
  if (typeof content === 'number' && max !== undefined && content > max) content = `${max}+`;
  if (appearance === 'dot') {
    return (
      <span data-testid={testId} className={cx('inline-flex items-center gap-1.5 text-label-sm text-fg-secondary', className)} style={style}>
        <span aria-hidden="true" className={cx('size-2 shrink-0 rounded-full', DOT[variant])} />
        {content}
      </span>
    );
  }
  return (
    <span
      data-testid={testId}
      data-variant={variant}
      className={cx(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-sm font-semibold',
        SIZE[size],
        appearance === 'solid' ? SOLID[variant] : TINT[variant],
        className,
      )}
      style={style}
    >
      {icon ? <Icon name={icon} size="sm" /> : null}
      {content}
    </span>
  );
}
