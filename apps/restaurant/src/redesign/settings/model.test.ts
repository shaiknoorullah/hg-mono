/**
 * Settings rules (restaurant settings, #658): the halal section's states, who may edit, the
 * profile body a settings save sends, and how a failed password change reads.
 */
import { describe, expect, it } from 'vitest';
import { canManage, currentDocuments, daysBetween, docStateView, halalSectionView, passwordFailure, profileBody, type KycDocument } from './model';
import { fixture } from '../test/fakeApi';

const TODAY = '2026-10-16';
const cert = (over: Partial<KycDocument> = {}): KycDocument => ({ ...fixture('restaurant_document_pack_complete').find((d: KycDocument) => d.doc_type === 'HALAL_CERTIFICATE'), ...over });

describe('halal section', () => {
  it('draws no badge when the field is missing, and claims nothing', () => {
    const v = halalSectionView(undefined, null, TODAY, true);
    expect(v.badge).toBeNull();
    expect(v.missing).toBe(true);
    expect(v.canUpload).toBe(false);
  });

  it('draws no badge for not verified, no certificate or a rejected one', () => {
    const none = halalSectionView({ display_state: 'UNVERIFIED' }, null, TODAY, true);
    const rejected = halalSectionView({ display_state: 'UNVERIFIED' }, cert({ state: 'REJECTED', review_note: 'The date is cut off.' }), TODAY, true);
    expect(none.badge).toBeNull();
    expect(none.summary).toBe('No certificate on record');
    expect(rejected.badge).toBeNull();
    expect(rejected.body).toContain('Reason from HalalGoes: The date is cut off.');
  });

  it('says "we can\'t currently vouch" when expired and offers the renewal', () => {
    const v = halalSectionView({ display_state: 'EXPIRED', expires_on: '2026-09-12' }, cert({ state: 'EXPIRED' }), TODAY, true);
    expect(v.tone).toBe('expired');
    expect(v.title).toBe('We can’t currently vouch for your halal certificate');
    expect(v.canUpload).toBe(true);
  });

  it('opens uploads 60 days before expiry and says why before that', () => {
    const early = halalSectionView({ display_state: 'CERTIFIED', expires_on: '2027-11-12' }, cert(), TODAY, true);
    expect(early.canUpload).toBe(false);
    expect(early.uploadReason).toBe('You can upload a renewal from 13 September 2027.');
    const soon = halalSectionView({ display_state: 'CERTIFIED', expires_on: '2026-12-01' }, cert(), TODAY, true);
    expect(soon.canUpload).toBe(true);
  });

  it('locks a second upload while one is in review, and shows a rejected renewal under a live certificate', () => {
    const review = halalSectionView({ display_state: 'EXPIRING_SOON', expires_on: '2026-10-28' }, cert({ state: 'IN_REVIEW' }), TODAY, true);
    expect(review.canUpload).toBe(false);
    expect(review.renewal?.kind).toBe('review');
    const rej = halalSectionView({ display_state: 'EXPIRING_SOON', expires_on: '2026-10-28' }, cert({ state: 'REJECTED', review_note: 'Not legible' }), TODAY, true);
    expect(rej.renewal).toEqual({ kind: 'rejected', note: 'Not legible' });
    expect(rej.canUpload).toBe(true);
  });

  it('never offers an upload to staff', () => {
    expect(halalSectionView({ display_state: 'EXPIRED', expires_on: '2026-09-12' }, null, TODAY, false).canUpload).toBe(false);
    expect(canManage([{ role: 'RESTAURANT_STAFF' }])).toBe(false);
    expect(canManage([{ role: 'RESTAURANT_MANAGER' }])).toBe(true);
  });
});

describe('documents', () => {
  it('keeps one current row per type and never calls an expired document red or green', () => {
    const rows = currentDocuments([cert({ version: 1, state: 'SUPERSEDED' }), cert({ version: 2, state: 'EXPIRED' })]);
    expect(rows).toHaveLength(1);
    expect(docStateView('EXPIRED').tone).toBe('neutral');
    expect(docStateView('REJECTED').tone).toBe('warning');
  });
});

describe('profile save', () => {
  it('changes only the immediate fields and copies the reviewed ones from the fresh read', () => {
    const fresh = fixture('restaurant_profile');
    const body = profileBody(fresh, { owner_first_name: 'Zainab', phone: '(416) 555-0199' });
    expect(body.owner_first_name).toBe('Zainab');
    expect(body.phone_e164).toBe('+14165550199');
    expect(body.display_name).toBe(fresh.display_name);
    expect(body.legal_name).toBe(fresh.legal_name);
    expect(body.description).toBe(fresh.description);
    expect(body.line1).toBe(fresh.address.line1);
    expect(body.cuisine_ids).toEqual(fresh.cuisine_ids);
  });
});

describe('daysBetween and password failures', () => {
  it('counts calendar days', () => {
    expect(daysBetween('2026-10-16', '2026-10-28')).toBe(12);
    expect(daysBetween('2026-10-16', '2026-10-15')).toBe(-1);
  });
  it('reads a 401 or a 422 INVALID_CREDENTIALS as a wrong current password', () => {
    expect(passwordFailure(401, '')).toBe('wrong-current');
    expect(passwordFailure(422, 'INVALID_CREDENTIALS')).toBe('wrong-current');
    expect(passwordFailure(422, 'BREACHED_PASSWORD')).toBe('weak');
    expect(passwordFailure(429, 'RATE_LIMITED')).toBe('rate-limited');
    expect(passwordFailure(null, '')).toBe('network');
  });
});
