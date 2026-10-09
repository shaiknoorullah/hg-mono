import React from 'react';
import { Icon } from './Icon.jsx';

/* Badge — 02-components.md §9. A small, non-interactive status marker. NOT the halal badge.
   There is no `success` variant and no green of any kind (RULE H-1): the only filled green in
   the system is the halal seal. Never colour-only — a danger badge carries a word.
   Spec prop `style` (solid|tint|dot) is `appearance` here, because `style` is React's CSS prop. */

const VARIANTS = {
  neutral: { tint: 'var(--color-neutral-100)', tintText: 'var(--text-secondary)', tintBorder: 'var(--border-decorative)', solid: 'var(--color-neutral-800)', onSolid: 'var(--color-neutral-0)', dot: 'var(--text-tertiary)' },
  info: { tint: 'var(--color-info-50)', tintText: 'var(--color-info-700)', tintBorder: 'var(--color-info-100)', solid: 'var(--color-info-600)', onSolid: 'var(--color-neutral-0)', dot: 'var(--color-info-600)' },
  warning: { tint: 'var(--color-warning-50)', tintText: 'var(--color-warning-700)', tintBorder: 'var(--color-warning-100)', solid: 'var(--color-warning-600)', onSolid: 'var(--color-neutral-0)', dot: 'var(--color-warning-600)' },
  danger: { tint: 'var(--color-danger-50)', tintText: 'var(--color-danger-700)', tintBorder: 'var(--color-danger-100)', solid: 'var(--color-danger-500)', onSolid: 'var(--color-neutral-0)', dot: 'var(--color-danger-600)' },
  brand: { tint: 'var(--color-brand-50)', tintText: 'var(--color-brand-800)', tintBorder: 'var(--color-brand-100)', solid: 'var(--action-primary)', onSolid: 'var(--text-on-brand)', dot: 'var(--color-brand-600)' },
  outline: { tint: 'transparent', tintText: 'var(--text-secondary)', tintBorder: 'var(--border-interactive)', solid: 'transparent', onSolid: 'var(--text-secondary)', dot: 'var(--text-tertiary)' },
};

const SIZES = {
  sm: { h: 18, px: 6, font: 'var(--type-label-sm-size)', track: 'var(--type-label-sm-tracking)', icon: 12, dot: 6 },
  md: { h: 22, px: 8, font: 'var(--type-label-sm-size)', track: 'var(--type-label-sm-tracking)', icon: 14, dot: 6 },
  lg: { h: 26, px: 10, font: 'var(--type-label-md-size)', track: 'var(--type-label-md-tracking)', icon: 16, dot: 8 },
};

export function Badge({ children, label, variant = 'neutral', appearance = 'tint', size = 'md', icon, max, testId, style, ...rest }) {
  const v = VARIANTS[variant] || VARIANTS.neutral;
  const s = SIZES[size] || SIZES.md;
  let text = label != null ? label : children;
  if (typeof text === 'number' && typeof max === 'number' && text > max) text = max + '+';
  const solid = appearance === 'solid' && variant !== 'outline';
  const dot = appearance === 'dot';
  return (
    <span data-testid={testId || 'Badge'} data-variant={variant} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, boxSizing: 'border-box',
      blockSize: s.h, paddingInline: dot ? 0 : s.px,
      fontFamily: 'var(--font-ui)', fontSize: s.font, letterSpacing: s.track,
      fontWeight: 'var(--font-weight-semibold)', fontVariantNumeric: 'var(--numeric-tabular)',
      color: dot ? 'var(--text-secondary)' : solid ? v.onSolid : v.tintText,
      background: dot ? 'transparent' : solid ? v.solid : v.tint,
      border: dot ? 'none' : '1px solid ' + (solid ? 'transparent' : v.tintBorder),
      borderRadius: 'var(--radius-xs)', whiteSpace: 'nowrap', ...style,
    }} {...rest}>
      {dot ? <span aria-hidden="true" style={{ inlineSize: s.dot, blockSize: s.dot, borderRadius: 'var(--radius-full)', background: v.dot, flex: '0 0 auto' }} /> : null}
      {icon ? <Icon name={icon} size={s.icon} /> : null}
      {text}
    </span>
  );
}
