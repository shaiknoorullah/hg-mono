/**
 * The reserved halal namespace, resolved per colour scheme.
 *
 * **Lint L-3.** `color.halal.*` may be imported only by `HalalBadge`,
 * `HalalCertificationPanel`, the admin `HalalChecklist` and the registered map-pin
 * exception. This module is the certification tier's single doorway to it; nothing in
 * `content/` imports this file, and the tier barrel does not re-export it.
 *
 * **RULE H-2.** A halal state is never "a colour" — it is a composite
 * `{ fill, ring, glyph, label }` shipped as one token group and one component. That is why
 * this module returns whole seal descriptors and exposes no bare colour.
 *
 * **RULE H-3.** No entry below touches the danger ramp. A red halal state reads as a
 * religious ruling, and the platform explicitly does not make religious rulings.
 */
import { tokens } from '../../tokens';
import type { ColorScheme } from './theme';

const halal = tokens.color.halal;

/** How the shield glyph is drawn. Three channels, any two sufficient (04-a11y §3.2). */
export type ShieldForm = 'solid' | 'outline' | 'dashed';

/**
 * Everything needed to paint one seal. `ring` is `null` for every state except
 * `CERTIFIED`/`EXPIRING_SOON` — the brass ring is what makes the mark read as a *seal*
 * rather than a status chip, and it is claimed by the certified states alone.
 */
export interface SealPalette {
  readonly fill: string | 'transparent';
  readonly label: string;
  readonly ring: string | null;
  readonly borderStyle: 'solid' | 'dashed';
  readonly borderColor: string | null;
  readonly shield: ShieldForm;
}

export function certifiedSeal(scheme: ColorScheme): SealPalette {
  return {
    fill: scheme === 'dark' ? halal.certified.sealDark : halal.certified.seal,
    label: halal.certified.onSeal,
    ring: scheme === 'dark' ? halal.certified.ringDark : halal.certified.ring,
    borderStyle: 'solid',
    borderColor: null,
    shield: 'solid',
  };
}

export function expiredSeal(scheme: ColorScheme): SealPalette {
  return {
    fill: scheme === 'dark' ? halal.expired.sealDark : halal.expired.seal,
    label: halal.expired.onSeal,
    // No brass ring: the ring belongs to a live certification.
    ring: null,
    borderStyle: 'solid',
    borderColor: null,
    // Hollow shield — the state survives greyscale and survives losing the text.
    shield: 'outline',
  };
}

export function unverifiedSeal(scheme: ColorScheme): SealPalette {
  return {
    fill: halal.unverified.fill,
    label: scheme === 'dark' ? halal.unverified.textDark : halal.unverified.text,
    ring: null,
    borderStyle: 'dashed',
    borderColor: scheme === 'dark' ? halal.unverified.borderDark : halal.unverified.border,
    shield: 'dashed',
  };
}

/** The pressed fill for an interactive seal on the detail surface. */
export function certifiedSealPressed(): string {
  return halal.certified.sealPressed;
}

/** Panel background: the certification section sits on its own tint, not on card surface. */
export interface PanelPalette {
  readonly tint: string;
  readonly tintText: string;
  readonly tintBorder: string;
}

export function panelPalette(scheme: ColorScheme): PanelPalette {
  return scheme === 'dark'
    ? {
        tint: halal.certified.tintDark,
        tintText: halal.certified.tintTextDark,
        tintBorder: halal.certified.tintDark,
      }
    : {
        tint: halal.certified.tint,
        tintText: halal.certified.tintText,
        tintBorder: halal.certified.tintBorder,
      };
}

/**
 * The renewal-note row, and **only** that row.
 *
 * Brass-ochre, deliberately not the semantic warning orange: the certificate is valid
 * today, so this is a transparency signal, not an alert. The card badge for
 * `EXPIRING_SOON` is byte-identical to `CERTIFIED` and never reaches these values.
 */
export interface RenewalNotePalette {
  readonly tint: string;
  readonly text: string;
  readonly icon: string;
  readonly border: string;
}

export function renewalNotePalette(scheme: ColorScheme): RenewalNotePalette {
  return scheme === 'dark'
    ? {
        tint: halal.expiring.tintDark,
        text: halal.expiring.textDark,
        icon: halal.expiring.textDark,
        border: halal.expiring.border,
      }
    : {
        tint: halal.expiring.tint,
        text: halal.expiring.text,
        icon: halal.expiring.icon,
        border: halal.expiring.border,
      };
}
