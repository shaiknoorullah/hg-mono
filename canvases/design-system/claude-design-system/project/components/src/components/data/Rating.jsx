import React, { useRef } from 'react';
import { Icon } from '../core/Icon.jsx';
import '../internal/css.js';

/* Rating — 02-components.md §21. Variants: display (one star + "4.6 (312)") · stars (five
   glyphs, PARTIAL fills — 4.5 shows four and a half, never rounds up to five) · input (a real
   radiogroup: arrow keys move and select, 44px targets, announces on change).
   Null-safe: value null/undefined renders "New" with the name "No ratings yet" — never 0.0 and
   never a crash. Stars are ink, not amber (no new colour, no competition with the orange CTA).
   ONE accessible name for the whole group: "4.6 out of 5 stars, 312 reviews". */

const PX = { sm: 14, md: 16, lg: 20 };
const TEXT = { sm: 'var(--type-body-sm-size)', md: 'var(--type-body-md-size)', lg: 'var(--type-heading-sm-size)' };

function Star({ fill, px }) {
  // fill in [0,1]: the bold (filled) glyph is clipped over the linear one, inline-start first.
  return (
    <span aria-hidden="true" style={{ position: 'relative', display: 'inline-block', inlineSize: px, blockSize: px }}>
      <span style={{ position: 'absolute', inset: 0, opacity: 0.35 }}><Icon name="star" size={px} /></span>
      <span style={{ position: 'absolute', insetBlock: 0, insetInlineStart: 0, inlineSize: (fill * 100) + '%', overflow: 'hidden' }}>
        <Icon name="star" weight="bold" size={px} />
      </span>
    </span>
  );
}

export function Rating({ value, count, size = 'md', variant = 'display', showCount = true, onChange, label = 'Your rating', testId, style, ...rest }) {
  const px = PX[size] || PX.md;
  const has = typeof value === 'number' && isFinite(value);
  const v = has ? Math.max(0, Math.min(5, Math.round(value * 10) / 10)) : null;
  const refs = useRef([]);

  if (variant === 'input') {
    const current = v == null ? 0 : Math.round(v);
    const pick = (n) => { if (onChange) onChange(n); const el = refs.current[n - 1]; if (el) el.focus(); };
    return (
      <div role="radiogroup" aria-label={label} data-testid={testId || 'Rating'} style={{ display: 'inline-flex', gap: 0, ...style }} {...rest}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} ref={(el) => { refs.current[n - 1] = el; }} type="button" role="radio"
            aria-checked={current === n} aria-label={n + (n === 1 ? ' star' : ' stars')}
            tabIndex={current === n || (current === 0 && n === 1) ? 0 : -1}
            className="hg-press hg-focus"
            onClick={() => pick(n)}
            onKeyDown={(e) => {
              const k = e.key;
              if (k === 'ArrowRight' || k === 'ArrowUp') { e.preventDefault(); pick(Math.min(5, n + 1)); }
              else if (k === 'ArrowLeft' || k === 'ArrowDown') { e.preventDefault(); pick(Math.max(1, n - 1)); }
              else if (k === 'Home') { e.preventDefault(); pick(1); }
              else if (k === 'End') { e.preventDefault(); pick(5); }
            }}
            style={{ display: 'grid', placeItems: 'center', minInlineSize: 44, minBlockSize: 44, padding: 0, border: 'none', backgroundColor: 'transparent', color: 'var(--text-primary)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}>
            <Icon name="star" weight={n <= current ? 'bold' : 'linear'} size={px + 8} />
          </button>
        ))}
      </div>
    );
  }

  const name = v == null
    ? 'No ratings yet'
    : v.toFixed(1) + ' out of 5 stars' + (typeof count === 'number' ? ', ' + count + (count === 1 ? ' review' : ' reviews') : '');
  return (
    <span role="img" aria-label={name} data-testid={testId || 'Rating'} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-primary)',
      fontFamily: 'var(--font-ui)', fontSize: TEXT[size] || TEXT.md, fontVariantNumeric: 'var(--numeric-tabular)', ...style,
    }} {...rest}>
      {v == null ? (
        <span aria-hidden="true" style={{ fontWeight: 'var(--font-weight-semibold)', color: 'var(--text-secondary)' }}>New</span>
      ) : variant === 'stars' ? (
        <span aria-hidden="true" style={{ display: 'inline-flex', gap: 1 }}>
          {[0, 1, 2, 3, 4].map((i) => <Star key={i} px={px} fill={Math.max(0, Math.min(1, v - i))} />)}
        </span>
      ) : (
        <>
          <span aria-hidden="true"><Icon name="star" weight="bold" size={px} /></span>
          <span aria-hidden="true" style={{ fontWeight: 'var(--font-weight-semibold)' }}>{v.toFixed(1)}</span>
        </>
      )}
      {v != null && showCount && typeof count === 'number' ? (
        <span aria-hidden="true" style={{ color: 'var(--text-tertiary)' }}>({count})</span>
      ) : null}
    </span>
  );
}
