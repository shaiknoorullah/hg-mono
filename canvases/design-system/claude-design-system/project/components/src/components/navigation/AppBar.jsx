import React from 'react';
import { IconButton } from '../core/IconButton.jsx';
import '../internal/css.js';

/* AppBar — 02-components.md §27.
   Variants: default (title + optional back + actions) · large (bigger title, customer home) ·
   search (a search field in place of the title — pass it as `search`) · contextual (selection
   mode: the title is the selection, e.g. "3 selected", and back becomes "Clear selection") ·
   transparent (over a hero; draws a scrim so the chrome stays legible).
   `tone` is the THEME surface only (cream · raised · chrome · field) — every colour is a role
   token, no rgba literals.
   - role="banner"; on web the title is the page's <h1> (titleIsPageHeading, default true).
   - Back is a 44px IconButton named "Back to {previous}" (backLabel) — never a bare "Back" when
     the destination is known.
   - Actions are IconButtons with real labels.
   - loading: an indeterminate 2px progress bar at the bottom edge.
   - elevated (scrolled): elevation 1 + hairline. Never scroll-hidden on rider/restaurant. */

const TONES = {
  cream: { bg: 'var(--surface-base)', fg: 'var(--text-primary)', sub: 'var(--text-secondary)', line: 'var(--border-decorative)', on: '' },
  raised: { bg: 'var(--surface-raised)', fg: 'var(--text-primary)', sub: 'var(--text-secondary)', line: 'var(--border-decorative)', on: '' },
  chrome: { bg: 'var(--surface-chrome)', fg: 'var(--text-on-accent)', sub: 'var(--color-neutral-200)', line: 'var(--color-accent-700)', on: 'hg-on-accent' },
  field: { bg: 'var(--color-accent-900)', fg: 'var(--color-neutral-100)', sub: 'var(--color-neutral-200)', line: 'var(--color-accent-800)', on: 'hg-on-accent' },
};

export function AppBar({
  variant = 'default', tone = 'cream', title, subtitle, backLabel, onBack, actions, search, loading = false,
  elevated = false, titleIsPageHeading = true, sticky = false, testId, style, ...rest
}) {
  const t = TONES[tone] || TONES.cream;
  const transparent = variant === 'transparent';
  const contextual = variant === 'contextual';
  const TitleTag = titleIsPageHeading ? 'h1' : 'div';
  const back = onBack ? (
    <IconButton icon={contextual ? 'close' : 'back'} accessibilityLabel={backLabel || (contextual ? 'Clear selection' : 'Back')} onPress={onBack}
      style={{ color: transparent ? 'var(--color-neutral-0)' : 'inherit', marginInlineStart: -8 }} />
  ) : null;
  return (
    <header role="banner" data-testid={testId || 'AppBar'} data-variant={variant} className={t.on || undefined} style={{
      position: sticky ? 'sticky' : 'relative', insetBlockStart: sticky ? 0 : undefined, zIndex: 'var(--z-app-bar)',
      display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minBlockSize: variant === 'large' ? 72 : 56, boxSizing: 'border-box',
      paddingInline: 'var(--space-4)', paddingBlock: variant === 'large' ? 'var(--space-3)' : 0,
      background: transparent ? 'linear-gradient(var(--surface-scrim), transparent)' : contextual ? 'var(--state-selected-tint)' : t.bg,
      color: transparent ? 'var(--color-neutral-0)' : t.fg,
      borderBlockEnd: transparent ? 'none' : '1px solid ' + (elevated ? t.line : 'transparent'),
      boxShadow: elevated && !transparent ? 'var(--elev-1)' : 'none', ...style,
    }} {...rest}>
      {back}
      <div style={{ flex: 1, minInlineSize: 0, display: 'grid', gap: 1 }}>
        {variant === 'search' && search ? search : (
          <>
            {title ? <TitleTag style={{
              margin: 0, fontSize: variant === 'large' ? 'var(--type-heading-xl-size)' : 'var(--type-heading-md-size)',
              fontWeight: 'var(--font-weight-semibold)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{title}</TitleTag> : null}
            {subtitle ? <div style={{ fontSize: 'var(--type-body-sm-size)', color: transparent ? 'var(--color-neutral-100)' : t.sub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subtitle}</div> : null}
          </>
        )}
      </div>
      {actions ? <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', color: 'inherit' }}>{actions}</div> : null}
      {loading ? (
        <div role="progressbar" aria-label="Loading" style={{ position: 'absolute', insetInline: 0, insetBlockEnd: 0, blockSize: 2, overflow: 'hidden' }}>
          <div className="hg-progress" style={{ inlineSize: '40%', blockSize: '100%', background: 'var(--action-primary)' }} />
        </div>
      ) : null}
    </header>
  );
}
