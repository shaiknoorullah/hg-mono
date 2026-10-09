import React, { useCallback, useState } from 'react';
import { Icon } from '../core/Icon.jsx';

/* Small internal building blocks. Not exported from the bundle. */

/** Keyboard/touch-agnostic pressed state: :active covers pointer; this covers Enter/Space. */
export function usePressKeys(inert, onKeyDown, onKeyUp) {
  const [pressed, setPressed] = useState(false);
  const handlers = {
    onKeyDown: useCallback((e) => {
      if (!inert && (e.key === 'Enter' || e.key === ' ')) setPressed(true);
      if (onKeyDown) onKeyDown(e);
    }, [inert, onKeyDown]),
    onKeyUp: useCallback((e) => {
      if (e.key === 'Enter' || e.key === ' ') setPressed(false);
      if (onKeyUp) onKeyUp(e);
    }, [onKeyUp]),
    onBlur: useCallback(() => setPressed(false), []),
  };
  return [pressed, handlers];
}

/** Spinner: 16/20/24 px ring. Decorative; the owning control carries aria-busy + its name. */
export function Spinner({ size = 16, style }) {
  return (
    <span aria-hidden="true" className="hg-spin" style={{
      display: 'inline-block', flex: '0 0 auto', inlineSize: size, blockSize: size,
      borderRadius: 'var(--radius-full)', border: '2px solid currentColor',
      borderInlineEndColor: 'transparent', boxSizing: 'border-box', ...style,
    }} />
  );
}

/** Skeleton block at a given geometry. aria-hidden; the region owns aria-busy. */
export function Skel({ w = '100%', h = 16, r, style }) {
  return <span aria-hidden="true" className="hg-skel" style={{ display: 'block', inlineSize: w, blockSize: h, borderRadius: r, ...style }} />;
}

/** The structural tick used inside Checkbox / Radio-like controls — not an icon (01-foundations §11). */
export function Tick({ size = 14, weight = 2.5 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" style={{ display: 'block' }}>
      <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth={weight * 1.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The structural mixed-state bar for an indeterminate Checkbox. */
export function Bar({ size = 14 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" style={{ display: 'block' }}>
      <path d="M6 12h12" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" />
    </svg>
  );
}

/** Field chrome shared by Input and Select: label, helper, error (linked + announced). */
export function FieldText({ id, text, error }) {
  if (!text) return null;
  return error ? (
    <div id={id} role="alert" style={{
      display: 'flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--type-caption-size)',
      lineHeight: 'var(--type-caption-line)', color: 'var(--color-danger-600)',
    }}>
      <ErrorGlyph />{text}
    </div>
  ) : (
    <div id={id} style={{ fontSize: 'var(--type-caption-size)', lineHeight: 'var(--type-caption-line)', color: 'var(--text-tertiary)' }}>{text}</div>
  );
}

function ErrorGlyph() {
  return <Icon name="error" size="sm" />;
}

export function cx() {
  return Array.prototype.filter.call(arguments, Boolean).join(' ');
}
