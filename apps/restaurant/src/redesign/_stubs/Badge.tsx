/**
 * TEMPORARY STUB for the DS `Badge` (live index.d.ts; ds-request(web): Badge).
 * Delete when `@hg/ui-web/ds` exports it. `@hg/ui-web` today has only the outline `Chip`.
 *
 * Status words live in the label; colour is never the only signal. No green tone exists here
 * on purpose (solid green is reserved to `color.halal.*`): "healthy/ok" is `neutral`.
 */
import type { ReactNode } from 'react';
import { Icon, type IconName } from '@hg/ui-web/primitives';

export type BadgeVariant = 'neutral' | 'info' | 'warning' | 'danger' | 'brand';

export interface BadgeProps {
  label: ReactNode;
  variant?: BadgeVariant;
  appearance?: 'tint' | 'solid';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  className?: string;
  testId?: string;
}

const TINT: Record<BadgeVariant, string> = {
  neutral: 'bg-surface-subtle text-fg-primary border-line-decorative',
  info: 'bg-feedback-info-tint text-feedback-info-tint-text border-feedback-info-border',
  warning: 'bg-feedback-warning-tint text-feedback-warning-tint-text border-feedback-warning-border',
  danger: 'bg-feedback-danger-tint text-feedback-danger-tint-text border-feedback-danger-border',
  brand: 'bg-brand-50 text-brand-800 border-line-brand',
};

const SOLID: Record<BadgeVariant, string> = {
  neutral: 'bg-surface-inverse text-fg-on-inverse border-transparent',
  info: 'bg-feedback-info-solid text-feedback-info-on-solid border-transparent',
  warning: 'bg-feedback-warning-solid text-feedback-warning-on-solid border-transparent',
  danger: 'bg-feedback-danger-solid text-feedback-danger-on-solid border-transparent',
  brand: 'bg-action-primary-bg text-action-primary-fg border-transparent',
};

const SIZE = {
  sm: 'min-h-5 px-1.5 text-[12px] gap-1',
  md: 'min-h-6 px-2 text-[13px] gap-1',
  lg: 'min-h-8 px-2.5 text-[15px] gap-1.5',
} as const;

export function Badge({ label, variant = 'neutral', appearance = 'tint', size = 'md', icon, className, testId }: BadgeProps) {
  const tone = appearance === 'solid' ? SOLID[variant] : TINT[variant];
  return (
    <span
      data-testid={testId}
      data-variant={variant}
      className={`inline-flex items-center whitespace-nowrap rounded-full border font-semibold ${tone} ${SIZE[size]} ${className ?? ''}`}
    >
      {icon ? <Icon name={icon} size={size === 'lg' ? 18 : 14} /> : null}
      <span>{label}</span>
    </span>
  );
}
