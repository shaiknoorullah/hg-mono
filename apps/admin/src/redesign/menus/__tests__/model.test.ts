import { describe, expect, it } from 'vitest';

import { buildUpdate, checkEdit, checkReject, dietaryTagLabel, EMPTY_EDIT, rejectInput } from '../model';

describe('rejecting a menu version', () => {
  it('needs a reason, and a note of 20 characters only when the reason is Other', () => {
    expect(checkReject({ reason: '', note: '' }).reason).toBeTruthy();
    expect(checkReject({ reason: 'POOR_IMAGE_QUALITY', note: '' })).toEqual({});
    expect(checkReject({ reason: 'OTHER', note: 'x'.repeat(19) }).note).toBeTruthy();
    expect(checkReject({ reason: 'OTHER', note: 'x'.repeat(20) })).toEqual({});
    expect(checkReject({ reason: 'POOR_IMAGE_QUALITY', note: 'x'.repeat(1001) }).note).toBeTruthy();
  });

  it('sends the reason and, when written, the note trimmed', () => {
    expect(rejectInput({ reason: 'MISSING_ALLERGEN', note: '  Add sesame.  ' })).toEqual({ decision: 'REJECT', reason_code: 'MISSING_ALLERGEN', review_note: 'Add sesame.' });
    expect(rejectInput({ reason: 'MISSING_ALLERGEN', note: '' })).toEqual({ decision: 'REJECT', reason_code: 'MISSING_ALLERGEN' });
  });
});

describe('a halal tag on a menu item', () => {
  it('is never worded as a verification', () => {
    expect(dietaryTagLabel('HALAL_CERTIFIED')).toMatch(/not checked here/);
    expect(dietaryTagLabel('SPICY')).toBe('Spicy');
  });
});

describe('editing an item on behalf of a restaurant', () => {
  it('sends only the fields that were filled in, the price as integer cents', () => {
    expect(buildUpdate(EMPTY_EDIT)).toBeNull();
    expect(buildUpdate({ ...EMPTY_EDIT, name: ' Shawarma plate ', priceCents: 1850, prep: '15' })).toEqual({ name: 'Shawarma plate', price_cents: 1850, prep_minutes: 15 });
  });

  it('keeps to the contract limits and asks for at least one change', () => {
    expect(checkEdit(EMPTY_EDIT).nothing).toBeTruthy();
    expect(checkEdit({ ...EMPTY_EDIT, name: 'A' }).name).toBeTruthy();
    expect(checkEdit({ ...EMPTY_EDIT, priceCents: 49 }).price).toBeTruthy();
    expect(checkEdit({ ...EMPTY_EDIT, priceCents: 50001 }).price).toBeTruthy();
    expect(checkEdit({ ...EMPTY_EDIT, priceCents: 50 })).toEqual({});
    expect(checkEdit({ ...EMPTY_EDIT, prep: '121' }).prep).toBeTruthy();
    expect(checkEdit({ ...EMPTY_EDIT, prep: '1.5' }).prep).toBeTruthy();
    expect(checkEdit(EMPTY_EDIT, true).price).toBeTruthy();
  });
});
