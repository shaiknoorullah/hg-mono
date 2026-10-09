import React from 'react';
import { usePressKeys, cx } from '../internal/ui.jsx';
import '../internal/css.js';

/* Card — 02-components.md §15. The generic surface.
   Variants: elevated (elevation 1, surface.raised) · outlined (1px border.decorative) ·
   filled (surface.subtle) · interactive (elevated + hover/press, requires onPress or href).
   An interactive card is ONE tab stop with ONE accessible name: it renders as a link (href) or
   a role="button" element with Enter/Space activation, the two-layer focus ring, hover
   (elevation +1, pointer devices only) and pressed (scale .99). Nested links or buttons inside a
   pressable card are forbidden — if a card needs two actions, it is not pressable. */

const VARIANTS = {
  elevated: { bg: 'var(--surface-raised)', border: '1px solid transparent', shadow: 'var(--elev-1)' },
  outlined: { bg: 'var(--surface-raised)', border: '1px solid var(--border-decorative)', shadow: 'none' },
  filled: { bg: 'var(--surface-subtle)', border: '1px solid transparent', shadow: 'none' },
  interactive: { bg: 'var(--surface-raised)', border: '1px solid transparent', shadow: 'var(--elev-1)' },
};

export function Card({
  children, variant, padding = 'var(--density-card-padding)', radius = 'lg', onPress, href,
  accessibilityLabel, media, header, footer, testId, style, className, ...rest
}) {
  const pressable = Boolean(onPress || href);
  const kind = variant || (pressable ? 'interactive' : 'elevated');
  const v = VARIANTS[kind] || VARIANTS.elevated;
  const [pressed, keys] = usePressKeys(!pressable);
  const body = (
    <>
      {media ? <div style={{ margin: 'calc(-1 * ' + padding + ')', marginBlockEnd: padding, overflow: 'hidden', borderStartStartRadius: 'inherit', borderStartEndRadius: 'inherit' }}>{media}</div> : null}
      {header ? <div style={{ marginBlockEnd: 'var(--space-3)' }}>{header}</div> : null}
      {children}
      {footer ? <div style={{ marginBlockStart: 'var(--space-4)' }}>{footer}</div> : null}
    </>
  );
  const shared = {
    'data-testid': testId || 'Card',
    'data-variant': kind,
    'data-pressed': pressed ? '' : undefined,
    className: cx(pressable && 'hg-focus hg-lift hg-press hg-press-card', className),
    style: {
      display: 'block', boxSizing: 'border-box', backgroundColor: v.bg, color: 'var(--text-primary)',
      borderRadius: 'var(--radius-' + radius + ')', padding, border: v.border, boxShadow: v.shadow,
      textDecoration: 'none', textAlign: 'start', cursor: pressable ? 'pointer' : undefined,
      '--hg-lift-shadow': 'var(--elev-2)',
      transition: 'box-shadow var(--duration-base) var(--ease-standard), transform var(--duration-instant) var(--ease-standard)',
      ...style,
    },
  };
  if (href) {
    return <a href={href} aria-label={accessibilityLabel} {...rest} {...shared} {...keys}>{body}</a>;
  }
  if (onPress) {
    return (
      <div role="button" tabIndex={0} aria-label={accessibilityLabel} {...rest} {...shared}
        onClick={onPress}
        onKeyDown={(e) => { keys.onKeyDown(e); if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (e.key === 'Enter') onPress(e); } }}
        onKeyUp={(e) => { keys.onKeyUp(e); if (e.key === ' ') onPress(e); }}
        onBlur={keys.onBlur}>{body}</div>
    );
  }
  return <div {...rest} {...shared}>{body}</div>;
}
