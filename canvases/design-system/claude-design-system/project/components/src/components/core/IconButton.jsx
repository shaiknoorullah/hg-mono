import React from 'react';
import { Icon } from './Icon.jsx';
import { Spinner, usePressKeys, cx } from '../internal/ui.jsx';
import { reportClientError } from '../internal/report.js';
import '../internal/css.js';

/* IconButton — 02-components.md §2. A control whose only content is an icon.
   - accessibilityLabel is REQUIRED; the glyph is always aria-hidden.
   - A count badge is folded into the accessible name ("Cart, 3 items"), never a separate node.
   - sm (36) keeps its visual size but its hit area is expanded to 44 (::after overlay).
   - loading keeps the name, sets aria-busy and ignores presses. */

const SIZES = { sm: { box: 36, icon: 16 }, md: { box: 44, icon: 20 }, lg: { box: 56, icon: 24 } };
const VARIANTS = {
  plain: { bg: 'transparent', fg: 'var(--text-secondary)', on: '' },
  filled: { bg: 'var(--action-primary)', fg: 'var(--text-on-brand)', on: 'hg-on-brand' },
  tonal: { bg: 'var(--surface-subtle)', fg: 'var(--text-primary)', on: '' },
};

export function IconButton({
  icon, accessibilityLabel, variant = 'plain', size = 'md', shape = 'square', weight = 'linear',
  badge, badgeNoun, loading = false, disabled = false, onPress, onClick, onKeyDown, onKeyUp,
  testId, style, className, ...rest
}) {
  if (!accessibilityLabel) reportClientError('ICON_BUTTON_UNLABELLED', { icon });
  const s = SIZES[size] || SIZES.md;
  const v = VARIANTS[variant] || VARIANTS.plain;
  const inert = disabled || loading;
  const [pressed, keys] = usePressKeys(inert, onKeyDown, onKeyUp);
  const count = typeof badge === 'number' ? badge : null;
  const shown = count != null && count > 99 ? '99+' : count;
  const name = count != null && count > 0
    ? accessibilityLabel + ', ' + count + (badgeNoun ? ' ' + badgeNoun : '')
    : badge === true ? accessibilityLabel + (badgeNoun ? ', ' + badgeNoun : ', new') : accessibilityLabel;

  const swallow = (e) => { e.preventDefault(); e.stopPropagation(); };
  return (
    <button type="button" {...rest}
      data-testid={testId || 'IconButton'}
      data-pressed={pressed && !inert ? '' : undefined}
      aria-label={name}
      aria-disabled={disabled || undefined}
      aria-busy={loading || undefined}
      className={cx('hg-press hg-focus', v.on, s.box < 44 && 'hg-hit', className)}
      onClick={(e) => { if (inert) { swallow(e); return; } if (onPress) onPress(e); if (onClick) onClick(e); }}
      onKeyDown={(e) => { if (inert && (e.key === 'Enter' || e.key === ' ')) { swallow(e); return; } keys.onKeyDown(e); }}
      onKeyUp={keys.onKeyUp} onBlur={keys.onBlur}
      style={{
        position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        inlineSize: s.box, blockSize: s.box, flex: '0 0 auto', padding: 0, color: v.fg, backgroundColor: v.bg,
        border: '1px solid transparent', borderRadius: shape === 'circle' ? 'var(--radius-full)' : 'var(--radius-md)',
        opacity: disabled ? 'var(--state-disabled-opacity)' : 1,
        cursor: disabled ? 'not-allowed' : loading ? 'progress' : 'pointer', ...style,
      }}>
      {loading ? <Spinner size={s.icon} /> : typeof icon === 'string' ? <Icon name={icon} weight={weight} size={s.icon} /> : icon}
      {(count != null && count > 0) || badge === true ? (
        <span aria-hidden="true" style={{
          position: 'absolute', insetBlockStart: badge === true ? 6 : 2, insetInlineEnd: badge === true ? 6 : 2,
          minInlineSize: badge === true ? 8 : 18, blockSize: badge === true ? 8 : 18,
          paddingInline: badge === true ? 0 : 5, boxSizing: 'border-box',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--action-primary)', color: 'var(--text-on-brand)',
          fontSize: 'var(--type-label-sm-size)', fontWeight: 'var(--font-weight-bold)',
          fontVariantNumeric: 'var(--numeric-tabular)', borderRadius: 'var(--radius-full)',
          boxShadow: '0 0 0 2px var(--surface-raised)',
        }}>{badge === true ? null : shown}</span>
      ) : null}
    </button>
  );
}
