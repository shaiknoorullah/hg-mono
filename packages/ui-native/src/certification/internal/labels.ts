/**
 * The fixed copy of the certification tier.
 *
 * Every string here is **reviewed and not templatable by callers**. C-12 R7 fixes the
 * visible copy; 04-accessibility.md §3.1 fixes the spoken copy; C-12 AC2 asserts by
 * snapshot that the exact accessible label "Halal certified" appears on all six card
 * surfaces. That assertion is the reason none of this is parameterised and the reason
 * `HalalBadge` has no `label` prop.
 *
 * The visible label and the accessible label never diverge for a halal state
 * (04-accessibility.md §3.6) — where they differ below, they differ only by the sentence
 * that explains the consequence, never by the claim.
 */
import type { HalalDisplayState } from '@hg/api-client';

/** The four states, as a value, so switches can be proven exhaustive. */
export const HALAL_DISPLAY_STATES = [
  'CERTIFIED',
  'EXPIRING_SOON',
  'EXPIRED',
  'UNVERIFIED',
] as const satisfies readonly HalalDisplayState[];

export function isHalalDisplayState(value: unknown): value is HalalDisplayState {
  return (HALAL_DISPLAY_STATES as readonly string[]).includes(value as string);
}

/**
 * Visible copy. `EXPIRING_SOON` reads "Halal certified" because it *is* certified today —
 * downgrading the badge would tell a customer the status is in doubt, which is false.
 */
export const VISIBLE_LABEL: Readonly<Record<HalalDisplayState, string>> = {
  CERTIFIED: 'Halal certified',
  EXPIRING_SOON: 'Halal certified',
  EXPIRED: 'Certification expired',
  UNVERIFIED: 'Not verified',
};

/** Spoken copy. Meaningful sentences — never "image", never the enum name. */
export const ACCESSIBLE_LABEL: Readonly<Record<HalalDisplayState, string>> = {
  CERTIFIED: 'Halal certified',
  EXPIRING_SOON: 'Halal certified',
  EXPIRED: 'Halal certification expired. This restaurant cannot take orders.',
  UNVERIFIED: 'Halal certification not verified.',
};

/** C-12 R7. Always present, never collapsible, never reworded. */
export function standingDisclaimer(verifiedAtIso: string | null | undefined): string {
  const on = verifiedAtIso ? formatAbsoluteDate(verifiedAtIso) : null;
  return on
    ? `Certification verified by HalalGoes on ${on}. HalalGoes does not itself certify food.`
    : 'HalalGoes does not itself certify food.';
}

/**
 * "14 March 2027".
 *
 * Absolute, always — C-12 forbids "expires in 7 months" in display, and 04-accessibility
 * §3.3 extends that to speech. A relative expiry invites a customer to do certification
 * arithmetic the platform should be doing for them.
 *
 * `format: date` values ("2027-03-14") are parsed field-by-field rather than through
 * `new Date(string)`, which would read them as UTC midnight and render the previous day
 * everywhere in Canada.
 */
export function formatAbsoluteDate(value: string): string {
  const date = parseContractDate(value);
  if (!date) return value;
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).formatToParts(date);
  const get = (t: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === t)?.value ?? '';
  const day = get('day');
  const month = get('month');
  const year = get('year');
  return day && month && year ? `${day} ${month} ${year}` : value;
}

function parseContractDate(value: string): Date | null {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * The detail-surface announcement (04-accessibility.md §3.3).
 *
 * The certifying body's name is in the **first sentence**. C-12 R6 forbids the platform
 * from ranking or editorialising certifiers and C-04 refuses to encode madhhab, which
 * means the customer applies their own standard — so they must be told *who* certified it
 * without having to open a panel.
 */
export function detailAccessibleLabel(input: {
  state: HalalDisplayState;
  certifyingBodyName?: string | null;
  expiresOn?: string | null;
  pressable: boolean;
}): string {
  const { state, certifyingBodyName, expiresOn, pressable } = input;
  if (state !== 'CERTIFIED' && state !== 'EXPIRING_SOON') {
    return [ACCESSIBLE_LABEL[state], pressable ? 'Double tap for certificate details.' : null]
      .filter(Boolean)
      .join(' ');
  }
  const sentences = [
    certifyingBodyName ? `Halal certified by ${certifyingBodyName}.` : 'Halal certified.',
    expiresOn ? `Valid until ${formatAbsoluteDate(expiresOn)}.` : null,
    pressable ? 'Double tap for certificate details.' : null,
  ];
  return sentences.filter(Boolean).join(' ');
}

/** A-15 scopes, in plain English. The enum name is never shown to a human. */
export const SCOPE_LABEL: Readonly<Record<string, string>> = {
  WHOLE_ESTABLISHMENT: 'Covers the whole establishment',
  KITCHEN_ONLY: 'Covers the kitchen',
  SPECIFIC_MENU_ITEMS: 'Covers specific menu items',
  SUPPLIER_CHAIN_ONLY: 'Covers the supplier chain',
};
