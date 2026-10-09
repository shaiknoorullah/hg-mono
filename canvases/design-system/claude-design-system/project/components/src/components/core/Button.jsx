import React from 'react';
import { Icon } from './Icon.jsx';
import { Spinner, usePressKeys, cx } from '../internal/ui.jsx';
import '../internal/css.js';

/* Button — 02-components.md §1. Action is ORANGE; forest is chrome; there is no success button
   (RULE H-1: no filled green outside the halal namespace — a confirm action is `primary`).

   States are a closed set (rule 1): hover (pointer devices only, CSS), pressed (:active for
   pointer AND Enter/Space for keyboard, scale .98 at duration.instant), focus-visible (two-layer
   ring in border.brand, flipping on coloured fills), disabled (aria-disabled — still focusable so
   it can explain itself; clicks and Enter/Space are swallowed so a submit button cannot submit),
   loading (full colour, label kept, width frozen, aria-busy, re-entry ignored). */

const SIZES = {
  sm: { h: 36, px: 'var(--space-3)', font: 'var(--type-label-md-size)', gap: 6, icon: 16 },
  md: { h: 44, px: 'var(--space-4)', font: 'var(--type-label-lg-size)', gap: 8, icon: 20 },
  lg: { h: 52, px: 'var(--space-5)', font: 'var(--type-label-lg-size)', gap: 8, icon: 20 },
  xl: { h: 60, px: 'var(--space-6)', font: 'var(--type-heading-sm-size)', gap: 10, icon: 24 },
};

const VARIANTS = {
  primary: { bg: 'var(--action-primary)', fg: 'var(--text-on-brand)', border: 'transparent', on: 'hg-on-brand' },
  secondary: { bg: 'var(--action-secondary)', fg: 'var(--text-on-accent)', border: 'transparent', on: 'hg-on-accent' },
  tertiary: { bg: 'transparent', fg: 'var(--text-primary)', border: 'var(--border-interactive)', on: '' },
  ghost: { bg: 'transparent', fg: 'var(--text-primary)', border: 'transparent', on: '' },
  danger: { bg: 'var(--color-danger-500)', fg: 'var(--color-neutral-0)', border: 'transparent', on: 'hg-on-danger' },
};

export function Button({
  children, variant = 'primary', size = 'md', critical = false, fullWidth = false,
  iconStart, iconEnd, loading, disabled = false, destructive = false,
  onPress, onClick, onKeyDown, onKeyUp, href, type = 'button', accessibilityLabel, testId, style, className, ...rest
}) {
  const s = SIZES[size] || SIZES.md;
  const v = VARIANTS[variant] || VARIANTS.primary;
  const busy = loading === true;
  const inert = disabled || busy;
  const supportsLoading = loading !== undefined;
  const [pressed, keyHandlers] = usePressKeys(inert, onKeyDown, onKeyUp);

  const swallow = (e) => { e.preventDefault(); e.stopPropagation(); };
  const handleClick = (e) => {
    if (inert) { swallow(e); return; }
    if (onPress) onPress(e);
    if (onClick) onClick(e);
  };
  const handleKeyDown = (e) => {
    if (inert && (e.key === 'Enter' || e.key === ' ')) { swallow(e); return; }
    keyHandlers.onKeyDown(e);
  };

  const h = critical ? 72 : s.h;
  const lead = busy
    ? <Spinner size={s.icon} />
    : iconStart
      ? <Icon name={iconStart} size={s.icon} />
      : supportsLoading ? <span aria-hidden="true" style={{ inlineSize: s.icon, blockSize: s.icon, flex: '0 0 auto' }} data-slot="loading-reserve" /> : null;
  // Loading is supported but there is no start icon: a matching end spacer keeps the label centred,
  // and the start slot is already reserved, so switching to the spinner never changes the width.
  const trail = iconEnd
    ? (busy ? <span aria-hidden="true" style={{ inlineSize: s.icon, blockSize: s.icon, flex: '0 0 auto' }} /> : <Icon name={iconEnd} size={s.icon} />)
    : supportsLoading && !iconStart ? <span aria-hidden="true" style={{ inlineSize: s.icon, blockSize: s.icon, flex: '0 0 auto' }} /> : null;

  const common = {
    'data-testid': testId || 'Button',
    'data-variant': variant,
    'data-destructive': destructive || undefined,
    'data-pressed': pressed && !inert ? '' : undefined,
    'aria-disabled': disabled || undefined,
    'aria-busy': busy || undefined,
    'aria-label': accessibilityLabel,
    className: cx('hg-press hg-focus', v.on, size === 'sm' && !critical && 'hg-hit', className),
    onClick: handleClick,
    onKeyDown: handleKeyDown,
    onKeyUp: keyHandlers.onKeyUp,
    onBlur: keyHandlers.onBlur,
    style: {
      display: fullWidth ? 'flex' : 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: s.gap,
      boxSizing: 'border-box', minBlockSize: h, paddingInline: s.px, inlineSize: fullWidth ? '100%' : undefined,
      fontFamily: 'var(--font-ui)', fontSize: critical ? 'var(--type-heading-md-size)' : s.font,
      fontWeight: 'var(--font-weight-semibold)', lineHeight: 1.2, textAlign: 'center', whiteSpace: 'nowrap',
      textDecoration: 'none', color: v.fg, backgroundColor: v.bg,
      border: '1px solid ' + v.border, borderRadius: 'var(--radius-md)',
      opacity: disabled ? 'var(--state-disabled-opacity)' : 1,
      cursor: disabled ? 'not-allowed' : busy ? 'progress' : 'pointer',
      ...style,
    },
  };

  const content = <>{lead}<span>{children}</span>{trail}</>;

  if (href) {
    return (
      <a {...rest} {...common} href={inert ? undefined : href} role={inert ? 'link' : undefined} tabIndex={inert ? 0 : undefined}>{content}</a>
    );
  }
  return (
    <button type={type} {...rest} {...common}>{content}</button>
  );
}
