/**
 * The address form's rules (boards `AC/AddressForm*`): what is checked before Save, what is sent,
 * what each failure means, and the pin nudge. Pure, so no screen is rendered here.
 */
import { HgApiError } from '@hg/api-client';
import type { Schema } from '@hg/api-client';

import { keysOf } from '../../../test/requests';
import {
  COPY,
  applyGeocoded,
  createInput,
  deleteFailure,
  deletedToast,
  draftFromAddress,
  emptyDraft,
  firstError,
  geoFailure,
  isDirty,
  isNotServed,
  labelKindOf,
  needsPinCheck,
  newSessionToken,
  normalizePostal,
  nudge,
  saveFailure,
  updateInput,
  validateDraft,
  type Address,
  type AddressDraft,
} from '../addressRules';

const HOME: Address = {
  id: 'b7b6c797-5584-44b3-ac8d-9af8e9572de8',
  label: 'Home',
  line1: '14 Ellesmere Rd',
  line2: null,
  unit: '402',
  buzzer: '402',
  city: 'Toronto',
  province: 'ON',
  postal_code: 'M1R 4E7',
  country: 'CA',
  latitude: 43.7,
  longitude: -79.3,
  timezone: 'America/Toronto',
  delivery_notes: 'Leave at the door, please.',
  is_default: true,
};

const filled = (patch: Partial<AddressDraft> = {}): AddressDraft => ({
  ...emptyDraft(),
  line1: '14 Ellesmere Rd',
  city: 'Toronto',
  postal: 'm1r4e7',
  pin: { latitude: 43.7, longitude: -79.3 },
  confirmed: true,
  ...patch,
});

const apiError = (status: number, code: string, details?: unknown) =>
  new HgApiError(status, { error: { code: code as never, message: code, request_id: 'T', details: details as never } });

describe('the name', () => {
  it('Home and Work are exact words, anything else is Other, nothing is No name', () => {
    expect(labelKindOf('Home')).toBe('HOME');
    expect(labelKindOf('Work')).toBe('WORK');
    expect(labelKindOf("Mum's place")).toBe('OTHER');
    expect(labelKindOf('home')).toBe('OTHER');
    expect(labelKindOf(null)).toBe('NONE');
    expect(labelKindOf('  ')).toBe('NONE');
  });
});

describe('postal code', () => {
  it('is uppercased with one space', () => {
    expect(normalizePostal('m1r4e7')).toBe('M1R 4E7');
    expect(normalizePostal(' M1R   4E7 ')).toBe('M1R 4E7');
  });
});

describe('validateDraft (the checks made before Save)', () => {
  it('a blank form names the street, city, postal code and pin, in that order', () => {
    const errors = validateDraft(emptyDraft(), null);
    expect(errors).toEqual({ line1: COPY.line1, city: COPY.city, postal: COPY.postal, pin: COPY.pin });
    expect(firstError(errors)).toBe('line1');
  });

  it('a postal code that is not Canadian is refused, a spaced or lower-case one is not', () => {
    expect(validateDraft(filled({ postal: 'M1R 4' }), null).postal).toBe(COPY.postal);
    expect(validateDraft(filled({ postal: '12345' }), null).postal).toBe(COPY.postal);
    expect(validateDraft(filled({ postal: 'm1r 4e7' }), null).postal).toBeUndefined();
  });

  it('a new address with a pin and a street needs the pin checked; ticking it clears that', () => {
    const d = filled({ confirmed: false });
    expect(needsPinCheck(d, null)).toBe(true);
    expect(validateDraft(d, null).confirm).toContain('14 Ellesmere Rd');
    expect(validateDraft({ ...d, confirmed: true }, null)).toEqual({});
    expect(firstError(validateDraft(d, null))).toBe('confirm');
  });

  it('the pin check waits for a street and a pin', () => {
    expect(needsPinCheck(filled({ line1: '' }), null)).toBe(false);
    expect(needsPinCheck(filled({ pin: null }), null)).toBe(false);
  });

  it('an edit asks again only when the pin was moved', () => {
    const base = draftFromAddress(HOME);
    expect(needsPinCheck(base, base)).toBe(false);
    expect(validateDraft(base, base)).toEqual({});
    const moved = { ...base, pin: { latitude: 43.70001, longitude: -79.3 }, confirmed: false };
    expect(needsPinCheck(moved, base)).toBe(true);
    expect(validateDraft(moved, base).confirm).toBeTruthy();
  });

  it('Other needs a name', () => {
    expect(validateDraft(filled({ labelKind: 'OTHER', label: ' ' }), null).label).toBe(COPY.other);
    expect(validateDraft(filled({ labelKind: 'OTHER', label: "Mum's place" }), null).label).toBeUndefined();
  });
});

describe('createInput', () => {
  it('sends the typed fields and the pin, trimmed, with the postal code normalised', () => {
    const body = createInput(filled({ unit: ' 402 ', buzzer: '402', notes: 'Side door', labelKind: 'HOME' }), false);
    expect(body).toEqual({
      line1: '14 Ellesmere Rd',
      city: 'Toronto',
      province: 'ON',
      postal_code: 'M1R 4E7',
      latitude: 43.7,
      longitude: -79.3,
      unit: '402',
      buzzer: '402',
      delivery_notes: 'Side door',
      label: 'Home',
    });
  });

  it('leaves out what was not typed, and sends is_default only when it is wanted', () => {
    const body = createInput(filled(), false);
    expect(Object.keys(body).sort()).toEqual(['city', 'latitude', 'line1', 'longitude', 'postal_code', 'province']);
    expect(createInput(filled(), true).is_default).toBe(true);
  });

  it('never carries a field the server owns, or anything that looks like money', () => {
    const keys = keysOf(createInput(filled({ unit: '1', buzzer: '2', notes: 'n', labelKind: 'WORK', line2: 'Tower' }), true));
    expect(keys).not.toContain('timezone');
    expect(keys).not.toContain('country');
    expect(keys.filter((k) => /price|amount|fee|total|tax/i.test(k))).toEqual([]);
  });

  it('refuses to be built without a pin (latitude and longitude are required)', () => {
    expect(() => createInput(filled({ pin: null }), false)).toThrow();
  });
});

describe('updateInput', () => {
  const base = draftFromAddress(HOME);

  it('sends only what changed', () => {
    expect(updateInput({ ...base, notes: 'Side door' }, base)).toEqual({ delivery_notes: 'Side door' });
    expect(updateInput(base, base)).toEqual({});
  });

  it('sends the pin only when it moved, both coordinates together', () => {
    const moved = { ...base, pin: { latitude: 43.7001, longitude: -79.3 } };
    expect(updateInput(moved, base)).toEqual({ latitude: 43.7001, longitude: -79.3 });
  });

  it('a cleared optional field goes as an empty string; the name is never cleared', () => {
    expect(updateInput({ ...base, unit: '', labelKind: 'NONE' }, base)).toEqual({ unit: '' });
  });

  it('renaming to Other writes the typed name', () => {
    expect(updateInput({ ...base, labelKind: 'OTHER', label: "Mum's place" }, base)).toEqual({ label: "Mum's place" });
  });

  it('never carries is_default: making it the default is its own action', () => {
    expect(Object.keys(updateInput({ ...base, makeDefault: false }, base))).not.toContain('is_default');
  });
});

describe('isDirty', () => {
  const base = draftFromAddress(HOME);
  it('an untouched edit is clean; any field or a moved pin is not', () => {
    expect(isDirty(base, base)).toBe(false);
    expect(isDirty({ ...base, line2: 'Tower' }, base)).toBe(true);
    expect(isDirty({ ...base, pin: { latitude: 43.8, longitude: -79.3 } }, base)).toBe(true);
    expect(isDirty({ ...base, makeDefault: !base.makeDefault }, base)).toBe(false);
  });
  it('a new form is clean until something is typed', () => {
    expect(isDirty(emptyDraft(), emptyDraft())).toBe(false);
    expect(isDirty({ ...emptyDraft(), city: 'Toronto' }, emptyDraft())).toBe(true);
  });
});

describe('search results', () => {
  const g: Schema['GeocodedAddress'] = {
    kind: 'ADDRESS',
    name: null,
    line1: '88 Harbour Street',
    city: 'Toronto',
    province: 'ON',
    postal_code: null,
    country: 'CA',
    latitude: 43.6412,
    longitude: -79.381,
    formatted: '88 Harbour Street, Toronto, Ontario',
  };

  it('a picked place fills what it knows, leaves a null alone and places the pin unconfirmed', () => {
    const d = applyGeocoded({ ...emptyDraft(), postal: 'M5J 0C3', confirmed: true }, g, { movePin: true });
    expect(d).toMatchObject({ line1: '88 Harbour Street', city: 'Toronto', postal: 'M5J 0C3', confirmed: false });
    expect(d.pin).toEqual({ latitude: 43.6412, longitude: -79.381 });
  });

  it('a pin lookup fills the same fields but keeps the pin where the customer put it', () => {
    const pin = { latitude: 43.0, longitude: -79.0 };
    const d = applyGeocoded({ ...emptyDraft(), pin, confirmed: true }, g, { movePin: false });
    expect(d.pin).toEqual(pin);
    expect(d.line1).toBe('88 Harbour Street');
  });

  it('a session token is a v4-shaped UUID and differs each time', () => {
    const a = newSessionToken();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newSessionToken()).not.toBe(a);
  });
});

describe('provinces', () => {
  it('is not served only when the config names a list that lacks it', () => {
    expect(isNotServed('QC', ['ON'])).toBe(true);
    expect(isNotServed('ON', ['ON'])).toBe(false);
    expect(isNotServed('QC', null)).toBe(false);
    expect(isNotServed('QC', [])).toBe(false);
  });
});

describe('nudge', () => {
  const pin = { latitude: 43.6532, longitude: -79.3832 };
  it('10 m north is about 0.00009 degrees of latitude and does not move the longitude', () => {
    const n = nudge(pin, 'north', 10);
    expect(n.longitude).toBe(pin.longitude);
    expect(n.latitude - pin.latitude).toBeCloseTo(10 / 111_320, 5);
  });
  it('south reverses north, east and west move the longitude only', () => {
    expect(nudge(nudge(pin, 'north', 10), 'south', 10)).toEqual(pin);
    const e = nudge(pin, 'east', 10);
    expect(e.latitude).toBe(pin.latitude);
    expect(e.longitude).toBeGreaterThan(pin.longitude);
    expect(nudge(pin, 'west', 1).longitude).toBeLessThan(pin.longitude);
  });
});

describe('geoFailure', () => {
  it('429 reads how long to wait from the details', () => {
    expect(geoFailure(apiError(429, 'RATE_LIMITED', { retry_after_seconds: 20 }))).toEqual({ kind: 'rate_limited', retryAfterSeconds: 20 });
    expect(geoFailure(apiError(429, 'RATE_LIMITED'))).toEqual({ kind: 'rate_limited', retryAfterSeconds: 30 });
  });
  it('503 is unavailable, 404 is no match, anything else is a failure to try again', () => {
    expect(geoFailure(apiError(503, 'GEOCODER_UNAVAILABLE'))).toEqual({ kind: 'unavailable' });
    expect(geoFailure(apiError(404, 'GEOCODE_NO_MATCH'))).toEqual({ kind: 'no_match' });
    expect(geoFailure(new Error('x'))).toEqual({ kind: 'failed' });
  });
});

describe('saveFailure', () => {
  it('a 422 marks the field it names; a postal code gets its own banner', () => {
    const f = saveFailure(apiError(422, 'VALIDATION_FAILED', [{ field: 'postal_code', code: 'pattern', message: 'bad' }]), { isEdit: false, savedCount: 1 });
    expect(f).toMatchObject({ kind: 'validation', errors: { postal: COPY.postalServer }, banner: { title: 'Check the postal code' } });
  });
  it('a 422 on another field shows the server message there, with the general banner', () => {
    const f = saveFailure(apiError(422, 'VALIDATION_FAILED', [{ field: 'delivery_notes', code: 'max', message: 'Too long' }]), { isEdit: true, savedCount: 1 });
    expect(f).toMatchObject({ kind: 'validation', errors: { notes: 'Too long' }, banner: { title: 'Check what you entered' } });
  });
  it('a 409 on create is the limit only at 20 saved, otherwise a conflict', () => {
    expect(saveFailure(apiError(409, 'CONFLICT'), { isEdit: false, savedCount: 20 })).toEqual({ kind: 'limit' });
    expect(saveFailure(apiError(409, 'CONFLICT'), { isEdit: false, savedCount: 3 })).toEqual({ kind: 'conflict' });
    expect(saveFailure(apiError(409, 'CONFLICT'), { isEdit: true, savedCount: 20 })).toEqual({ kind: 'conflict' });
  });
  it('PROVINCE_NOT_SERVED, a vanished address and a server error each have their own meaning', () => {
    expect(saveFailure(apiError(422, 'PROVINCE_NOT_SERVED'), { isEdit: false, savedCount: 0 })).toEqual({ kind: 'notServed' });
    expect(saveFailure(apiError(404, 'NOT_FOUND'), { isEdit: true, savedCount: 1 })).toEqual({ kind: 'gone' });
    expect(saveFailure(apiError(500, 'INTERNAL_ERROR'), { isEdit: false, savedCount: 0 })).toEqual({ kind: 'failed' });
    expect(saveFailure(new TypeError('Network request failed'), { isEdit: false, savedCount: 0 })).toEqual({ kind: 'failed' });
  });
});

describe('delete', () => {
  it('ADDRESS_IN_USE, already gone, and still saved', () => {
    expect(deleteFailure(apiError(409, 'ADDRESS_IN_USE'))).toBe('in_use');
    expect(deleteFailure(apiError(404, 'NOT_FOUND'))).toBe('gone');
    expect(deleteFailure(apiError(500, 'INTERNAL_ERROR'))).toBe('failed');
  });

  const other: Address = { ...HOME, id: 'x', label: 'Work', line1: '2075 Kennedy Rd', is_default: false };
  it('the toast comes from the refreshed list: none left, a new default named, none promoted', () => {
    expect(deletedToast([], true)).toBe('You have no saved addresses now.');
    expect(deletedToast([{ ...other, is_default: true }], true)).toBe('Work is now your default address.');
    expect(deletedToast([other], true)).toBe('You have no default address now.');
  });
  it('deleting a non-default address says nothing about the default', () => {
    expect(deletedToast([{ ...HOME }], false)).toBe("Your other saved addresses haven't changed.");
  });
  it('an address with no name is called by its street', () => {
    expect(deletedToast([{ ...other, label: null, is_default: true }], true)).toBe('2075 Kennedy Rd is now your default address.');
  });
});
