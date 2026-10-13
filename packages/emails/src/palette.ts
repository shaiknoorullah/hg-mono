/**
 * The email-safe palette: the design system's light-scheme colour roles,
 * resolved to plain six-digit hex at build time.
 *
 * Email clients ignore CSS custom properties, most ignore `prefers-color-scheme`,
 * and several mangle eight-digit hex with alpha, so every value here is a solid
 * `#RRGGBB` lifted from the generated tokens in `@hg/ui-web/tokens`
 * (source: docs/design/tokens.json). Nothing is hand-copied: when a token
 * changes, `pnpm --filter @hg/emails build` re-exports every template with it.
 *
 * Two colour rules from AGENTS.md "Non-negotiable invariants" (#9 and #10,
 * ../../AGENTS.md#3-non-negotiable-invariants) shape what is *not* here:
 *
 *   - Never red for a halal state. No danger role and no brand orange is
 *     exported, so no template can paint a certificate email red. A lapsed
 *     certificate uses the design system's cool slate (`halal.expired`), and
 *     an upcoming expiry uses its `halal.expiring` tint.
 *   - Solid green is reserved for the halal seal. No template shows a halal
 *     status, so the seal colours are not exported at all, and the success
 *     role is not either: an approval is told in words, not in green.
 *
 * test/templates.test.ts enforces both with the design system's own
 * no-green-solids check.
 */
import { color, font, roles } from '@hg/ui-web/tokens';

const light = roles.light;

/** Each colour role an email uses, as solid hex. */
export const palette = {
  /** The page behind the card. */
  page: light.surface.sunken,
  /** The card that holds the message. */
  card: light.surface.raised,
  /** Hairlines between header, body and footer. */
  border: light.border.decorative,
  text: light.text.primary,
  textMuted: light.text.secondary,
  textFaint: light.text.tertiary,
  link: light.text.link,
  /** The one call-to-action button: the inverse surface, a neutral, never a status colour. */
  buttonBg: light.surface.inverse,
  buttonText: light.text.onInverse,
  /** A quoted note, such as the reason an admin gave. */
  noteBg: light.surface.subtle,
  noteBorder: light.border.decorative,
  /** A halal certificate that is about to expire. */
  expiringBg: color.halal.expiring.tint,
  expiringBorder: color.halal.expiring.border,
  expiringText: color.halal.expiring.text,
  /** A halal certificate that has lapsed: cool slate, "we can't currently vouch". */
  expiredBg: color.halal.expired.tint,
  expiredBorder: color.halal.expired.border,
  expiredText: color.halal.expired.text,
} as const;

/** A role in the email palette. */
export type PaletteRole = keyof typeof palette;

/** The UI font stack; email clients fall back through it to Arial. */
export const fontStack = font.family.ui.map((f) => (f.includes(' ') ? `'${f}'` : f)).join(', ');
