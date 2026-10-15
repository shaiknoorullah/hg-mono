/**
 * Test data for the verification console: contract fixtures, cloned and adjusted. A fixture is
 * never invented from nothing; the fields a test changes are the ones the state is about.
 */
import type { Schema } from '@hg/api-client';

import { fixture } from '../../testing';

export type Application = Schema['RestaurantApplication'];
export type Summary = Schema['RestaurantApplicationSummary'];
export type Certificate = Schema['HalalCertificate'];
export type KycDocument = Schema['KycDocument'];

/** `principalFor('ADMIN')` in the test kit. */
export const ADMIN_ID = '7c1d4f2a-0b3e-4c5d-8e6f-1a2b3c4d5e02';
export const OTHER_ADMIN_ID = '7f814633-d948-4cc7-ab1c-17dda2bf790e';

export const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

export function document(type: KycDocument['doc_type'], state: KycDocument['state'], over: Partial<KycDocument> = {}): KycDocument {
  const base = fixture<Application>('restaurant_application_pending_review').documents[0]!;
  return {
    ...base,
    id: `d0000000-0000-4000-8000-${String(Math.abs(hash(`${type}${state}${over.version ?? 1}`))).padStart(12, '0').slice(0, 12)}`,
    doc_type: type,
    state,
    version: 1,
    rejection_reason_code: null,
    review_note: null,
    valid_until: '2027-03-02',
    ...over,
  };
}

function hash(s: string): number {
  let h = 7;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

/** An application in review, claimed by you (the test admin) for another 30 minutes. */
export function applicationInReview(over: Partial<Application> = {}): Application {
  const app = fixture<Application>('restaurant_application_pending_review');
  const cert = fixture<Certificate>('halal_certificate_pending_transcribed_unchecked');
  return {
    ...app,
    display_name: 'Karahi House',
    city: 'Toronto',
    province: 'ON',
    onboarding_state: 'DOCUMENTS_REVIEW',
    submission_count: 1,
    assigned_admin_id: ADMIN_ID,
    review_lock_expires_at: minutesFromNow(30),
    submitted_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    sla_due_at: new Date(Date.now() + 86_400_000).toISOString(),
    profile: {
      ...app.profile,
      display_name: 'Karahi House',
      legal_name: 'Karahi House Restaurant Inc.',
      onboarding_state: 'DOCUMENTS_REVIEW',
      halal: { display_state: 'UNVERIFIED' },
    },
    documents: [
      document('BUSINESS_LICENCE', 'APPROVED'),
      document('HALAL_CERTIFICATE', 'IN_REVIEW', { valid_until: '2027-01-14' }),
      document('FOOD_SAFETY', 'IN_REVIEW'),
      document('OWNER_ID', 'APPROVED'),
    ],
    halal_certificate: { ...cert, restaurant_id: app.restaurant_id },
    blockers: ['Required document not approved: FOOD_SAFETY', 'No approved halal certificate'],
    address_pin_warning: null,
    ...over,
  };
}

export function summaryRow(over: Partial<Summary> = {}): Summary {
  return {
    restaurant_id: 'a1111111-0000-4000-8000-000000000001',
    display_name: 'Sufra Kitchen',
    city: 'Mississauga',
    province: 'ON',
    onboarding_state: 'DOCUMENTS_REVIEW',
    submission_count: 1,
    assigned_admin_id: null,
    review_lock_expires_at: null,
    submitted_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    sla_due_at: new Date(Date.now() + 86_400_000).toISOString(),
    ...over,
  };
}

export function envelope(code: string, message: string, details?: unknown) {
  return { error: { code, message, request_id: '01JTESTREQUEST0000000000000', ...(details === undefined ? {} : { details }) } };
}

export type Check = Schema['HalalCheck'];
export type CheckKey = Schema['HalalCheckKey'];
export type CheckResult = Schema['HalalCheckResult'];

/** A pending certificate, transcribed, nothing recorded yet (the contract fixture). */
export function pendingCertificate(over: Partial<Certificate> = {}): Certificate {
  return { ...fixture<Certificate>('halal_certificate_pending_transcribed_unchecked'), ...over };
}

/** Records `results` as the reviewer's (checked_at set) on a certificate; keys not named stay as they were. */
export function recorded(cert: Certificate, results: Partial<Record<CheckKey, CheckResult>>): Certificate {
  const checks = cert.checks.map((c) => {
    const result = results[c.check_key];
    return result ? { ...c, result, checked_at: new Date().toISOString() } : c;
  });
  return { ...cert, checks };
}

export const ALL_SEVEN_PASS: Partial<Record<CheckKey, CheckResult>> = {
  H1_LEGIBLE_COMPLETE: 'PASS',
  H2_ISSUER_ACCEPTED: 'PASS',
  H3_NAME_MATCH: 'PASS',
  H4_ADDRESS_MATCH: 'PASS',
  H6_SCOPE_SUFFICIENT: 'PASS',
};

/** The application the certificate belongs to, claimed by you, in review. */
export function applicationFor(cert: Certificate, over: Partial<Application> = {}): Application {
  return applicationInReview({ restaurant_id: cert.restaurant_id, halal_certificate: cert, ...over });
}

export function certificateFixture(name: string): Certificate {
  return fixture<Certificate>(name);
}
