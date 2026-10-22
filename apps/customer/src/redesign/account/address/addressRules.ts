/**
 * The address form's rules, as pure functions (boards `AC/AddressForm*`; manifest section 2, A5).
 *
 * Everything here reads only what the contract returns or accepts (`Address`, `AddressInput`,
 * `AddressUpdateInput`, `GeocodedAddress`, `PublicConfig`). The server derives `timezone` and
 * fixes `country`, so neither is ever sent. The pin's position is what is saved, so a search
 * result only places the pin; dragging or nudging it afterwards changes what is stored.
 */
import { HgApiError, HgTransportError } from '@hg/api-client';
import type { Schema } from '@hg/api-client';

import { ADDRESS_LIMIT } from '../rules';

export type Address = Schema['Address'];
export type AddressInput = Schema['AddressInput'];
export type AddressUpdateInput = Schema['AddressUpdateInput'];
export type GeocodedAddress = Schema['GeocodedAddress'];
export type AddressSuggestion = Schema['AddressSuggestion'];
export type Province = Schema['Province'];

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export type LabelKind = 'NONE' | 'HOME' | 'WORK' | 'OTHER';

/** Every field the form edits. Text fields are exactly what is typed; trimming happens on send. */
export interface AddressDraft {
  line1: string;
  line2: string;
  city: string;
  province: Province;
  postal: string;
  unit: string;
  buzzer: string;
  notes: string;
  labelKind: LabelKind;
  /** The typed name when `labelKind` is OTHER. */
  label: string;
  /** New address only: edit applies "make default" at once, outside the form. */
  makeDefault: boolean;
  /** The pin. `null` until a search result, a nudge or "Use this spot" places it. */
  pin: GeoPoint | null;
  /** "The pin is on the entrance of {line1}" ticked. */
  confirmed: boolean;
}

export const FIELD_LIMITS = { line1: 200, line2: 200, city: 100, postal: 7, unit: 32, buzzer: 32, notes: 200, label: 30 } as const;

export const DEFAULT_PROVINCE: Province = 'ON';

export function emptyDraft(province: Province = DEFAULT_PROVINCE): AddressDraft {
  return {
    line1: '',
    line2: '',
    city: '',
    province,
    postal: '',
    unit: '',
    buzzer: '',
    notes: '',
    labelKind: 'NONE',
    label: '',
    makeDefault: false,
    pin: null,
    confirmed: false,
  };
}

/** Home and Work are quick picks that write exactly that word; anything else is "Other". */
export function labelKindOf(label: string | null | undefined): LabelKind {
  const l = (label ?? '').trim();
  if (!l) return 'NONE';
  if (l === 'Home') return 'HOME';
  if (l === 'Work') return 'WORK';
  return 'OTHER';
}

/** The draft an edit opens with: the stored address, its pin already confirmed. */
export function draftFromAddress(a: Address): AddressDraft {
  const kind = labelKindOf(a.label);
  return {
    line1: a.line1,
    line2: a.line2 ?? '',
    city: a.city,
    province: a.province,
    postal: a.postal_code,
    unit: a.unit ?? '',
    buzzer: a.buzzer ?? '',
    notes: a.delivery_notes ?? '',
    labelKind: kind,
    label: kind === 'OTHER' ? (a.label ?? '').trim() : '',
    makeDefault: a.is_default,
    pin: { latitude: a.latitude, longitude: a.longitude },
    confirmed: true,
  };
}

/** The name that is saved: Home, Work, the typed name, or none. */
export function labelOf(d: Pick<AddressDraft, 'labelKind' | 'label'>): string | undefined {
  if (d.labelKind === 'HOME') return 'Home';
  if (d.labelKind === 'WORK') return 'Work';
  if (d.labelKind === 'OTHER') return d.label.trim() || undefined;
  return undefined;
}

/** "m1r4e7" and "M1R  4E7" both become "M1R 4E7". Anything that is not six characters is left as typed. */
export function normalizePostal(value: string): string {
  const compact = value.replace(/\s+/g, '').toUpperCase();
  return compact.length === 6 ? `${compact.slice(0, 3)} ${compact.slice(3)}` : value.trim().toUpperCase();
}

/** The contract's `PostalCode` pattern. */
export const POSTAL_PATTERN = /^[A-CEGHJ-NPR-TVXY][0-9][A-CEGHJ-NPR-TV-Z] ?[0-9][A-CEGHJ-NPR-TV-Z][0-9]$/;

export const PROVINCE_NAMES: Record<Province, string> = {
  AB: 'Alberta',
  BC: 'British Columbia',
  MB: 'Manitoba',
  NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia',
  NT: 'Northwest Territories',
  NU: 'Nunavut',
  ON: 'Ontario',
  PE: 'Prince Edward Island',
  QC: 'Quebec',
  SK: 'Saskatchewan',
  YT: 'Yukon',
};

/** The address is in a province we do not serve yet. `null` served list = config not read: never block. */
export function isNotServed(province: Province, served: readonly Province[] | null): boolean {
  return served !== null && served.length > 0 && !served.includes(province);
}

/* --------------------------------------------------------------------------------------------- */
/* Validation                                                                                      */
/* --------------------------------------------------------------------------------------------- */

export const COPY = {
  line1: 'Enter the street address, like 14 Ellesmere Rd.',
  city: 'Enter the city.',
  postal: 'Enter a full postal code, like M1R 4E7.',
  postalServer: "This postal code wasn't accepted. Check it, like M1R 4E7.",
  pin: 'Drag the pin onto your entrance so your rider can find you.',
  other: 'Type a name for this address, or choose another.',
} as const;

export interface FormErrors {
  line1?: string;
  line2?: string;
  city?: string;
  postal?: string;
  unit?: string;
  buzzer?: string;
  notes?: string;
  label?: string;
  pin?: string;
  confirm?: string;
}

/** The order errors are announced and scrolled to: fields first, the pin, then the pin check. */
export const ERROR_ORDER: ReadonlyArray<keyof FormErrors> = ['line1', 'line2', 'city', 'postal', 'unit', 'buzzer', 'notes', 'label', 'pin', 'confirm'];

export function firstError(errors: FormErrors): keyof FormErrors | null {
  return ERROR_ORDER.find((k) => errors[k]) ?? null;
}

/** Whether "Check the pin" is asked: a pin, a street, and (on edit) a pin that was moved. */
export function needsPinCheck(draft: AddressDraft, base: AddressDraft | null): boolean {
  if (!draft.pin || !draft.line1.trim()) return false;
  return base === null || pinMoved(draft.pin, base.pin);
}

export function pinMoved(pin: GeoPoint | null, stored: GeoPoint | null): boolean {
  if (!pin || !stored) return pin !== stored;
  return pin.latitude !== stored.latitude || pin.longitude !== stored.longitude;
}

/** The checks made before Save. They never call the server. */
export function validateDraft(draft: AddressDraft, base: AddressDraft | null): FormErrors {
  const errors: FormErrors = {};
  if (!draft.line1.trim()) errors.line1 = COPY.line1;
  if (!draft.city.trim()) errors.city = COPY.city;
  if (!POSTAL_PATTERN.test(normalizePostal(draft.postal))) errors.postal = COPY.postal;
  if (draft.labelKind === 'OTHER' && !draft.label.trim()) errors.label = COPY.other;
  if (!draft.pin) errors.pin = COPY.pin;
  else if (needsPinCheck(draft, base) && !draft.confirmed) {
    errors.confirm = `Check the pin, then tick this box. If the pin isn't on the entrance of ${draft.line1.trim()}, drag it there first.`;
  }
  return errors;
}

/* --------------------------------------------------------------------------------------------- */
/* What is sent                                                                                    */
/* --------------------------------------------------------------------------------------------- */

/** `createAddress`. Optional text is sent only when typed; the pin is required, so this needs one. */
export function createInput(draft: AddressDraft, makeDefault: boolean): AddressInput {
  if (!draft.pin) throw new Error('createInput needs a pin');
  const label = labelOf(draft);
  return {
    line1: draft.line1.trim(),
    city: draft.city.trim(),
    province: draft.province,
    postal_code: normalizePostal(draft.postal),
    latitude: draft.pin.latitude,
    longitude: draft.pin.longitude,
    ...(draft.line2.trim() ? { line2: draft.line2.trim() } : {}),
    ...(draft.unit.trim() ? { unit: draft.unit.trim() } : {}),
    ...(draft.buzzer.trim() ? { buzzer: draft.buzzer.trim() } : {}),
    ...(draft.notes.trim() ? { delivery_notes: draft.notes.trim() } : {}),
    ...(label ? { label } : {}),
    ...(makeDefault ? { is_default: true } : {}),
  };
}

const norm = (s: string) => s.trim();

/**
 * `updateAddress`: only what changed. A cleared optional field is sent as an empty string (the
 * schema allows it); the name cannot be cleared, so a draft that lost its name sends none (board
 * `AC/AddressForm-edit`: "Needs API: allow clearing label"). `is_default` is never part of Save:
 * it has its own button and applies at once.
 */
export function updateInput(draft: AddressDraft, base: AddressDraft): AddressUpdateInput {
  const out: AddressUpdateInput = {};
  if (norm(draft.line1) !== norm(base.line1)) out.line1 = norm(draft.line1);
  if (norm(draft.line2) !== norm(base.line2)) out.line2 = norm(draft.line2);
  if (norm(draft.city) !== norm(base.city)) out.city = norm(draft.city);
  if (draft.province !== base.province) out.province = draft.province;
  if (normalizePostal(draft.postal) !== normalizePostal(base.postal)) out.postal_code = normalizePostal(draft.postal);
  if (norm(draft.unit) !== norm(base.unit)) out.unit = norm(draft.unit);
  if (norm(draft.buzzer) !== norm(base.buzzer)) out.buzzer = norm(draft.buzzer);
  if (norm(draft.notes) !== norm(base.notes)) out.delivery_notes = norm(draft.notes);
  const label = labelOf(draft);
  if (label && label !== labelOf(base)) out.label = label;
  if (draft.pin && pinMoved(draft.pin, base.pin)) {
    out.latitude = draft.pin.latitude;
    out.longitude = draft.pin.longitude;
  }
  return out;
}

/** Anything changed since the form opened (the guard on leaving). "Make default" does not count. */
export function isDirty(draft: AddressDraft, base: AddressDraft): boolean {
  return (
    norm(draft.line1) !== norm(base.line1) ||
    norm(draft.line2) !== norm(base.line2) ||
    norm(draft.city) !== norm(base.city) ||
    draft.province !== base.province ||
    normalizePostal(draft.postal) !== normalizePostal(base.postal) ||
    norm(draft.unit) !== norm(base.unit) ||
    norm(draft.buzzer) !== norm(base.buzzer) ||
    norm(draft.notes) !== norm(base.notes) ||
    labelOf(draft) !== labelOf(base) ||
    pinMoved(draft.pin, base.pin)
  );
}

/* --------------------------------------------------------------------------------------------- */
/* Search results                                                                                  */
/* --------------------------------------------------------------------------------------------- */

/**
 * A picked place fills the fields it knows (a field the provider does not know is `null` and is
 * left as typed) and places the pin. A reverse lookup fills the same fields but keeps the pin where
 * the customer put it: the pin's position is what is saved, not the address's own point.
 */
export function applyGeocoded(draft: AddressDraft, g: GeocodedAddress, { movePin }: { movePin: boolean }): AddressDraft {
  const next: AddressDraft = {
    ...draft,
    line1: g.line1 ?? draft.line1,
    city: g.city ?? draft.city,
    province: g.province,
    postal: g.postal_code ?? draft.postal,
  };
  if (movePin) {
    next.pin = { latitude: g.latitude, longitude: g.longitude };
    next.confirmed = false;
  }
  return next;
}

/** A random v4-shaped UUID for `session_token`. Not a secret: it only groups one search for billing. */
export function newSessionToken(random: () => number = Math.random): string {
  const hex = (n: number) => Math.floor(random() * 16 ** n).toString(16).padStart(n, '0');
  const variant = (8 + Math.floor(random() * 4)).toString(16);
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${variant}${hex(3)}-${hex(8)}${hex(4)}`;
}

/* --------------------------------------------------------------------------------------------- */
/* The pin                                                                                         */
/* --------------------------------------------------------------------------------------------- */

export type Compass = 'north' | 'south' | 'east' | 'west';
export const STEP_METRES = ['1', '10'] as const;
export type StepMetres = (typeof STEP_METRES)[number];

const METRES_PER_DEGREE = 111_320;

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** One press of Move north / south / east / west: the pin moves by the chosen step. */
export function nudge(pin: GeoPoint, direction: Compass, metres: number): GeoPoint {
  const dLat = metres / METRES_PER_DEGREE;
  const dLng = metres / (METRES_PER_DEGREE * Math.max(Math.cos((pin.latitude * Math.PI) / 180), 0.01));
  const latitude = direction === 'north' ? pin.latitude + dLat : direction === 'south' ? pin.latitude - dLat : pin.latitude;
  const longitude = direction === 'east' ? pin.longitude + dLng : direction === 'west' ? pin.longitude - dLng : pin.longitude;
  return { latitude: round6(Math.max(-90, Math.min(90, latitude))), longitude: round6(Math.max(-180, Math.min(180, longitude))) };
}

/* --------------------------------------------------------------------------------------------- */
/* Failures                                                                                        */
/* --------------------------------------------------------------------------------------------- */

export type GeoFailure =
  | { kind: 'rate_limited'; retryAfterSeconds: number }
  | { kind: 'unavailable' }
  | { kind: 'no_match' }
  | { kind: 'invalid' }
  | { kind: 'failed' };

const DEFAULT_RETRY_SECONDS = 30;

/** What an address-search call failing means (`suggestAddresses`, `getPlaceAddress`, `reverseGeocode`). */
export function geoFailure(e: unknown): GeoFailure {
  if (e instanceof HgApiError) {
    if (e.status === 429 || e.code === 'RATE_LIMITED') {
      const details = e.details as unknown as { retry_after_seconds?: unknown } | undefined;
      const n = Number(details?.retry_after_seconds);
      return { kind: 'rate_limited', retryAfterSeconds: Number.isFinite(n) && n > 0 ? Math.ceil(n) : DEFAULT_RETRY_SECONDS };
    }
    if (e.status === 503 || e.code === 'GEOCODER_UNAVAILABLE') return { kind: 'unavailable' };
    if (e.status === 404 || e.code === 'GEOCODE_NO_MATCH') return { kind: 'no_match' };
    if (e.status === 422) return { kind: 'invalid' };
  }
  return { kind: 'failed' };
}

export type SaveFailure =
  | { kind: 'validation'; errors: FormErrors; banner: { title: string; body: string } }
  | { kind: 'notServed' }
  | { kind: 'limit' }
  | { kind: 'conflict' }
  | { kind: 'gone' }
  | { kind: 'failed' };

const FIELD_OF: Record<string, keyof FormErrors> = {
  line1: 'line1',
  line2: 'line2',
  city: 'city',
  postal_code: 'postal',
  unit: 'unit',
  buzzer: 'buzzer',
  delivery_notes: 'notes',
  label: 'label',
  latitude: 'pin',
  longitude: 'pin',
};

/**
 * What a failed save means. A 422 marks the fields it names (`details: [{field, code, message}]`);
 * the contract has no code for the 20-address limit, so a 409 on create is the limit when the
 * customer already has 20 and any other conflict otherwise.
 */
export function saveFailure(e: unknown, { isEdit, savedCount }: { isEdit: boolean; savedCount: number }): SaveFailure {
  if (e instanceof HgTransportError || !(e instanceof HgApiError)) return { kind: 'failed' };
  if (e.code === 'PROVINCE_NOT_SERVED') return { kind: 'notServed' };
  if (e.status === 404) return { kind: 'gone' };
  if (e.status === 409) return savedCount >= ADDRESS_LIMIT && !isEdit ? { kind: 'limit' } : { kind: 'conflict' };
  if (e.status === 422) {
    const errors: FormErrors = {};
    const details = Array.isArray(e.details) ? e.details : [];
    for (const d of details) {
      const key = FIELD_OF[d.field];
      if (!key || errors[key]) continue;
      errors[key] = key === 'postal' ? COPY.postalServer : d.message;
    }
    if (errors.postal) {
      return {
        kind: 'validation',
        errors,
        banner: {
          title: 'Check the postal code',
          body: "We couldn't save this address because the postal code wasn't accepted. Everything else you typed is still here.",
        },
      };
    }
    return {
      kind: 'validation',
      errors,
      banner: {
        title: 'Check what you entered',
        body: "We couldn't save this address because a field wasn't accepted. Everything else you typed is still here.",
      },
    };
  }
  return { kind: 'failed' };
}

/** `deleteAddress`: 409 ADDRESS_IN_USE, 404 (already gone), or anything else (still saved). */
export type DeleteFailure = 'in_use' | 'gone' | 'failed';

export function deleteFailure(e: unknown): DeleteFailure {
  if (e instanceof HgApiError) {
    if (e.code === 'ADDRESS_IN_USE' || e.status === 409) return 'in_use';
    if (e.status === 404) return 'gone';
  }
  return 'failed';
}

/** The text on the delete confirmation. */
export function deleteDescription(a: Pick<Address, 'label' | 'line1' | 'is_default'>): string {
  const name = (a.label ?? '').trim() || a.line1;
  return `“${name}”, ${a.line1}, will be removed from your saved addresses.${a.is_default ? ' It is your default, so another saved address will become your default.' : ''}`;
}

/**
 * The toast after a delete, built from the refreshed list (never from what the screen assumed).
 * Deleting the default names an address as the new default only if one now has `is_default` true;
 * deleting any other address changes nothing else.
 */
export function deletedToast(remaining: readonly Address[], wasDefault: boolean): string {
  if (remaining.length === 0) return 'You have no saved addresses now.';
  if (!wasDefault) return "Your other saved addresses haven't changed.";
  const d = remaining.find((a) => a.is_default);
  if (!d) return 'You have no default address now.';
  return `${(d.label ?? '').trim() || d.line1} is now your default address.`;
}
