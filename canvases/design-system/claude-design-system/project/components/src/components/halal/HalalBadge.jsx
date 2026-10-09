import React, { useEffect } from 'react';
import { HalalShield } from './HalalShield.jsx';
import { Icon } from '../core/Icon.jsx';
import { HALAL_VISIBLE_LABEL, HALAL_ACCESSIBLE_LABEL } from './halal-contract.js';
import { reportClientError } from '../internal/report.js';
import { formatAbsoluteDate, parseWireDate } from '../internal/format.js';
import '../internal/css.js';

/* HalalBadge — 02-components.md §12. The server's `halal_display_state`, rendered as a SEAL.
   The four contract states are the entire API: there is no colour, label, variant, icon,
   showLabel or onTint prop, so no caller can make this component say something else.

   state          renders
   CERTIFIED      filled seal (halal.certified.seal), 1.5px brass OUTER ring, solid shield, "Halal certified"
   EXPIRING_SOON  its own look (owner decision): amber halal.expiring.tint plate, 1.5px expiring border,
                  solid-clock shield in halal.expiring.icon, label in halal.expiring.text, no ring:
                  "Halal certified · expires 14 Oct" (expiresOn as a short date). No parseable
                  expiresOn -> "Halal certified" on the same amber plate. Never red (the certificate
                  is valid today) and never the solid green seal, which stays CERTIFIED's.
   EXPIRED        filled slate seal (halal.expired.seal), OUTLINE shield, no ring, "Certification expired".
                  Slate, never red: red reads as haram, a ruling the platform does not make.
   UNVERIFIED     surface card|detail -> nothing. operational -> dashed outline, dashed shield, "Not verified"
   null / undefined / unknown -> NOTHING, and reportClientError('HALAL_DISPLAY_STATE_MISSING').
                  There is no "assume certified".

   The whole badge is the seal: the label sits ON the plate (>= 7:1; the expiring plate is the
   measured 5.91:1 of contrast.light.expiring-text-on-expiring-tint), heights 20 / 24 / 32,
   radius.md. Solid green here is the ONLY solid green in the system.
   Interaction: only surface="detail" may take onPress -> a button with a chevron and a >= 44px
   hit area. Never animates. */

const RENDER_KEY = { CERTIFIED: 'certified', EXPIRING_SOON: 'expiring', EXPIRED: 'expired', UNVERIFIED: 'unverified' };

const SKIN = {
  certified: { shield: 'solid', bg: 'var(--color-halal-certified-seal)', fg: 'var(--color-halal-certified-on-seal)', knockout: 'var(--color-halal-certified-seal)', ring: '0 0 0 1.5px var(--color-halal-certified-ring)', border: 'none' },
  expiring: { shield: 'solid-clock', bg: 'var(--color-halal-expiring-tint)', fg: 'var(--color-halal-expiring-text)', icon: 'var(--color-halal-expiring-icon)', knockout: 'var(--color-halal-expiring-tint)', ring: 'none', border: '1.5px solid var(--color-halal-expiring-border)' },
  expired: { shield: 'outline', bg: 'var(--color-halal-expired-seal)', fg: 'var(--color-halal-expired-on-seal)', knockout: 'transparent', ring: 'none', border: 'none' },
  unverified: { shield: 'dashed', bg: 'var(--color-halal-unverified-fill)', fg: 'var(--color-halal-unverified-text)', knockout: 'transparent', ring: 'none', border: '1.5px dashed var(--color-halal-unverified-border)' },
};

const SHORT_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Wire date -> "14 Oct" (UTC, a fixed English table so no locale can turn it into "Sept." or "oct.").
    Only the visible expiring label is short; the spoken name keeps the absolute "14 October 2026". */
function formatShortDate(value) {
  const d = parseWireDate(value);
  return d ? d.getUTCDate() + ' ' + SHORT_MONTH[d.getUTCMonth()] : null;
}

const SIZE = {
  sm: { h: 20, px: 'var(--space-2)', gap: 4, icon: 'var(--icon-sm)' },
  md: { h: 24, px: 'var(--space-2)', gap: 4, icon: 'var(--icon-sm)' },
  lg: { h: 32, px: 'var(--space-3)', gap: 4, icon: 'var(--icon-md)' },
};

export function HalalBadge({ state, size = 'md', surface = 'card', restaurantId, certifyingBodyName, expiresOn, onPress, testId, style, className }) {
  const known = typeof state === 'string' && Object.prototype.hasOwnProperty.call(RENDER_KEY, state);
  useEffect(() => {
    if (!known) reportClientError('HALAL_DISPLAY_STATE_MISSING', { restaurantId, received: state, surface });
  }, [known, state, restaurantId, surface]);
  if (!known) return null;
  if (state === 'UNVERIFIED' && surface !== 'operational') return null;

  const key = RENDER_KEY[state];
  const skin = SKIN[key];
  const dims = SIZE[size] || SIZE.md;
  const pressable = surface === 'detail' && typeof onPress === 'function';

  let name = HALAL_ACCESSIBLE_LABEL[state];
  let label = HALAL_VISIBLE_LABEL[state];
  if (surface === 'detail' && key === 'certified' && certifyingBodyName) {
    const until = formatAbsoluteDate(expiresOn);
    name = 'Halal certified by ' + certifyingBodyName + '.' + (until ? ' Valid until ' + until + '.' : '');
  }
  if (key === 'expiring') {
    const short = formatShortDate(expiresOn);
    const until = formatAbsoluteDate(expiresOn);
    if (short) label += ' · expires ' + short;
    if (surface === 'detail' && certifyingBodyName) name = 'Halal certified by ' + certifyingBodyName + '.';
    else if (until) name = 'Halal certified.';
    if (until) name += ' Expires ' + until + '.';
  }
  if (pressable) name += ' Double tap for certificate details.';

  const box = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: dims.gap, boxSizing: 'border-box',
    blockSize: dims.h, paddingInline: dims.px, whiteSpace: 'nowrap', verticalAlign: 'middle',
    backgroundColor: skin.bg, color: skin.fg, border: skin.border, boxShadow: skin.ring, borderRadius: 'var(--radius-md)',
    fontFamily: 'var(--font-ui)', fontSize: 'var(--type-label-sm-size)', lineHeight: 1,
    letterSpacing: 'var(--type-label-sm-tracking)', fontWeight: 'var(--font-weight-semibold)', ...style,
  };
  const seal = (
    <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', gap: dims.gap }}>
      {skin.icon
        ? <HalalShield variant={skin.shield} size={dims.icon} knockout={skin.knockout} style={{ color: skin.icon }} />
        : <HalalShield variant={skin.shield} size={dims.icon} knockout={skin.knockout} />}
      <span>{label}</span>
      {pressable ? <Icon name="chevron-right" size={14} /> : null}
    </span>
  );

  if (!pressable) {
    return <span role="img" aria-label={name} data-testid={testId || 'HalalBadge'} data-halal-render={key} className={className} style={box}>{seal}</span>;
  }
  return (
    <button type="button" aria-label={name} data-testid={testId || 'HalalBadge'} data-halal-render={key}
      className={['hg-focus hg-hit hg-press', key === 'certified' ? 'hg-on-halal' : '', className].filter(Boolean).join(' ')}
      onClick={onPress} style={{ ...box, cursor: 'pointer', position: 'relative' }}>
      {seal}
    </button>
  );
}
