/**
 * The business profile form as data (canvas ON `Profile-*`): the values, the checks the server
 * also makes (so a typo costs no round trip; the server still has the last word), the mapping
 * from `RestaurantProfileInput` field names to the five sections, and the local draft.
 *
 * Cuisines are not here. The contract requires 1 to 5 `cuisine_ids` from a server-managed
 * lookup, and no operation lets a restaurant read that lookup (an API gap, filed with the
 * review), so the form keeps whatever ids the saved profile already holds and never invents any.
 */
import type { Schema } from '@hg/api-client';
import type { RestaurantProfile } from './model';

export type ProfileInput = Schema['RestaurantProfileInput'];

export interface ProfileValues {
  display_name: string;
  legal_name: string;
  owner_first_name: string;
  owner_last_name: string;
  phone: string;
  public_phone: string;
  line1: string;
  line2: string;
  city: string;
  province: string;
  postal_code: string;
  latitude: number | null;
  longitude: number | null;
  description: string;
  avg_prep_minutes: string;
  gst_hst_number: string;
  timezone: string;
}

export type SectionKey = 'names' | 'contact' | 'location' | 'about' | 'tax';
export const SECTIONS: { key: SectionKey; title: string }[] = [
  { key: 'names', title: 'Names' },
  { key: 'contact', title: 'Phone numbers' },
  { key: 'location', title: 'Address and pin' },
  { key: 'about', title: 'About your restaurant' },
  { key: 'tax', title: 'Tax and time zone' },
];

export const FIELD_LABEL: Record<string, string> = {
  display_name: 'Name customers see',
  legal_name: 'Legal business name',
  owner_first_name: 'Owner’s first name',
  owner_last_name: 'Owner’s last name',
  phone_e164: 'Business phone',
  public_phone_e164: 'Phone customers can call',
  line1: 'Street address',
  city: 'City',
  province: 'Province',
  postal_code: 'Postal code',
  latitude: 'Pin for riders',
  longitude: 'Pin for riders',
  description: 'Description',
  avg_prep_minutes: 'Usual preparation time',
  gst_hst_number: 'GST/HST number',
  cuisine_ids: 'Cuisines',
};

export const FIELD_SECTION: Record<string, SectionKey> = {
  display_name: 'names',
  legal_name: 'names',
  owner_first_name: 'names',
  owner_last_name: 'names',
  phone_e164: 'contact',
  public_phone_e164: 'contact',
  line1: 'location',
  line2: 'location',
  city: 'location',
  province: 'location',
  postal_code: 'location',
  latitude: 'location',
  longitude: 'location',
  description: 'about',
  avg_prep_minutes: 'about',
  cuisine_ids: 'about',
  gst_hst_number: 'tax',
  timezone: 'tax',
};

/** The DOM id each field's control carries, for the error summary's links. */
export const FIELD_ID: Record<string, string> = {
  display_name: 'display_name',
  legal_name: 'legal_name',
  owner_first_name: 'owner_first_name',
  owner_last_name: 'owner_last_name',
  phone_e164: 'phone',
  public_phone_e164: 'public_phone',
  line1: 'line1',
  city: 'city',
  province: 'province',
  postal_code: 'postal',
  latitude: 'pin',
  longitude: 'pin',
  description: 'description',
  avg_prep_minutes: 'prep',
  gst_hst_number: 'gst',
  cuisine_ids: 'description',
};

export const EMPTY_VALUES: ProfileValues = {
  display_name: '',
  legal_name: '',
  owner_first_name: '',
  owner_last_name: '',
  phone: '',
  public_phone: '',
  line1: '',
  line2: '',
  city: '',
  province: 'ON',
  postal_code: '',
  latitude: null,
  longitude: null,
  description: '',
  avg_prep_minutes: '',
  gst_hst_number: '',
  timezone: 'America/Toronto',
};

/** "+14165550182" → "(416) 555-0182" for the field; anything else as it is. */
export function displayPhone(e164: string | null | undefined): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 ?? '');
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : (e164 ?? '');
}

/** What the owner typed → E.164, or null when it cannot be a Canadian number. */
export function toE164(text: string): string | null {
  const trimmed = text.trim();
  const digits = trimmed.replace(/\D/g, '');
  const plus = trimmed.startsWith('+');
  let national: string;
  if (plus) {
    if (!digits.startsWith('1')) return null;
    national = digits.slice(1);
  } else if (digits.length === 11 && digits.startsWith('1')) national = digits.slice(1);
  else national = digits;
  return /^[2-9]\d{9}$/.test(national) ? `+1${national}` : null;
}

export function valuesFromProfile(p: RestaurantProfile | null | undefined, ownDisplayName = ''): ProfileValues {
  if (!p) return { ...EMPTY_VALUES, display_name: ownDisplayName };
  return {
    display_name: p.display_name ?? '',
    legal_name: p.legal_name ?? '',
    owner_first_name: p.owner_first_name ?? '',
    owner_last_name: p.owner_last_name ?? '',
    phone: displayPhone(p.phone_e164),
    public_phone: displayPhone(p.public_phone_e164),
    line1: p.address?.line1 ?? '',
    line2: p.address?.line2 ?? '',
    city: p.address?.city ?? '',
    province: p.address?.province ?? 'ON',
    postal_code: p.address?.postal_code ?? '',
    latitude: p.address ? p.address.latitude : null,
    longitude: p.address ? p.address.longitude : null,
    description: p.description ?? '',
    avg_prep_minutes: p.avg_prep_minutes ? String(p.avg_prep_minutes) : '',
    gst_hst_number: p.gst_hst_number ?? '',
    timezone: p.timezone ?? 'America/Toronto',
  };
}

export type FieldErrors = Partial<Record<string, string>>;

const POSTAL = /^[A-CEGHJ-NPR-TVXY][0-9][A-CEGHJ-NPR-TV-Z] ?[0-9][A-CEGHJ-NPR-TV-Z][0-9]$/;
const GST = /^[0-9]{9}RT[0-9]{4}$/;

/** Checks the contract states plainly. Keys are `RestaurantProfileInput` field names. */
export function validate(v: ProfileValues): FieldErrors {
  const e: FieldErrors = {};
  if (v.display_name.trim().length < 2) e['display_name'] = 'Enter the name customers know you by.';
  if (v.legal_name.trim().length < 2) e['legal_name'] = 'Enter your registered legal business name.';
  if (!toE164(v.phone)) e['phone_e164'] = 'Enter a Canadian phone number. HalalGoes works with +1 numbers only.';
  if (v.public_phone.trim() && !toE164(v.public_phone)) e['public_phone_e164'] = 'Enter a Canadian phone number. HalalGoes works with +1 numbers only.';
  if (!v.line1.trim()) e['line1'] = 'Enter the street address.';
  if (!v.city.trim()) e['city'] = 'Enter the city.';
  if (!POSTAL.test(v.postal_code.trim().toUpperCase())) e['postal_code'] = 'Enter a Canadian postal code, like M1J 2E1.';
  if (v.latitude === null || v.longitude === null) e['latitude'] = 'Pick your address from the search so we can place the pin.';
  const d = v.description.trim().length;
  if (d < 20) e['description'] = `Write at least 20 characters. You have ${d}.`;
  else if (v.description.length > 1000) e['description'] = 'Keep it to 1,000 characters or fewer.';
  const prep = Number(v.avg_prep_minutes);
  if (!Number.isInteger(prep) || prep < 5 || prep > 120) e['avg_prep_minutes'] = 'Enter a whole number of minutes between 5 and 120.';
  if (v.gst_hst_number.trim() && !GST.test(v.gst_hst_number.trim().toUpperCase())) e['gst_hst_number'] = 'This isn’t a GST/HST number. It should look like 123456789RT0001.';
  return e;
}

export function toInput(v: ProfileValues, cuisineIds: readonly string[]): ProfileInput {
  const phone = toE164(v.phone)!;
  const pub = v.public_phone.trim() ? toE164(v.public_phone) : null;
  return {
    display_name: v.display_name.trim(),
    legal_name: v.legal_name.trim(),
    ...(v.owner_first_name.trim() ? { owner_first_name: v.owner_first_name.trim() } : {}),
    ...(v.owner_last_name.trim() ? { owner_last_name: v.owner_last_name.trim() } : {}),
    phone_e164: phone,
    ...(pub ? { public_phone_e164: pub } : {}),
    ...(v.gst_hst_number.trim() ? { gst_hst_number: v.gst_hst_number.trim().toUpperCase() } : {}),
    description: v.description.trim(),
    line1: v.line1.trim(),
    ...(v.line2.trim() ? { line2: v.line2.trim() } : {}),
    city: v.city.trim(),
    province: v.province as ProfileInput['province'],
    postal_code: v.postal_code.trim().toUpperCase() as ProfileInput['postal_code'],
    latitude: v.latitude as number,
    longitude: v.longitude as number,
    timezone: v.timezone,
    cuisine_ids: [...cuisineIds],
    avg_prep_minutes: Number(v.avg_prep_minutes),
  };
}

/** Section status line, in the boards' words. */
export function sectionStatus(key: SectionKey, v: ProfileValues, serverErrors: FieldErrors): { text: string; tone: 'ok' | 'warn' | 'todo' } {
  const bad = Object.keys(serverErrors).filter((f) => FIELD_SECTION[f] === key);
  if (bad.length > 0) return { text: bad.length === 1 ? `${FIELD_LABEL[bad[0]!] ?? 'A field'} needs a change` : `${bad.length} fields need a change`, tone: 'warn' };
  const e = validate(v);
  const left = Object.keys(e).filter((f) => FIELD_SECTION[f] === key);
  if (left.length === 0) return { text: 'Done', tone: 'ok' };
  if (key === 'location') return { text: 'Address and pin needed', tone: 'todo' };
  return { text: left.length === 1 ? '1 required field left' : `${left.length} required fields left`, tone: 'todo' };
}

// ── The tab-lifetime draft ───────────────────────────────────────────────────────────────────
// Kept in sessionStorage: it survives a reload of this tab and dies with the tab, so an owner's
// name, phone and address never sit in durable browser storage on a shared kitchen machine. The
// GST/HST number (derived from a sole proprietor's own number) is never written. Sign-out clears
// every draft (`clearAllDrafts`).

const DRAFT_PREFIX = 'hg_restaurant_profile_draft_v2:';
const DRAFT_KEY = (restaurantId: string) => `${DRAFT_PREFIX}${restaurantId}`;

export interface Draft {
  savedAt: string;
  values: ProfileValues;
}

export function readDraft(restaurantId: string): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY(restaurantId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Draft;
    if (!parsed || typeof parsed.savedAt !== 'string' || !parsed.values) return null;
    return { savedAt: parsed.savedAt, values: { ...parsed.values, gst_hst_number: '' } };
  } catch {
    return null;
  }
}

export function writeDraft(restaurantId: string, values: ProfileValues): void {
  try {
    const { gst_hst_number: _omitted, ...safe } = values;
    void _omitted;
    sessionStorage.setItem(DRAFT_KEY(restaurantId), JSON.stringify({ savedAt: new Date().toISOString(), values: safe }));
  } catch {
    /* storage blocked or full: the form still works, it just won't survive a reload */
  }
}

export function clearDraft(restaurantId: string): void {
  try {
    sessionStorage.removeItem(DRAFT_KEY(restaurantId));
  } catch {
    /* nothing stored */
  }
}

/** Sign-out: nothing of the owner's is left behind in this tab. */
export function clearAllDrafts(): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(DRAFT_PREFIX)) sessionStorage.removeItem(k);
    }
  } catch {
    /* nothing stored */
  }
}
