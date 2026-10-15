/**
 * Test data for the rider onboarding area: contract fixtures, cloned and adjusted. A fixture is
 * never invented from nothing; the fields a test changes are the ones the state is about.
 */
import type { Schema } from '@hg/api-client';

import { fixture } from '../../testing';

export type Application = Schema['RiderApplication'];
export type Summary = Schema['RiderApplicationSummary'];
export type KycDocument = Schema['KycDocument'];

/** `principalFor('ADMIN')` in the test kit. */
export const ADMIN_ID = '7c1d4f2a-0b3e-4c5d-8e6f-1a2b3c4d5e02';
export const OTHER_ADMIN_ID = '7f814633-d948-4cc7-ab1c-17dda2bf790e';

export const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

export function envelope(code: string, message: string, details?: unknown) {
  return { error: { code, message, request_id: '01JTESTREQUEST0000000000000', ...(details === undefined ? {} : { details }) } };
}

/** An application in review, claimed by you for another 30 minutes: a car, five documents in review. */
export function applicationInReview(over: Partial<Application> = {}): Application {
  const app = fixture<Application>('rider_application_attempt_3');
  return {
    ...app,
    display_name: 'Fatima Noor',
    attempt_number: 2,
    onboarding_state: 'DOCUMENTS_REVIEW',
    assigned_admin_id: ADMIN_ID,
    review_lock_expires_at: minutesFromNow(30),
    submitted_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    sla_due_at: new Date(Date.now() + 86_400_000).toISOString(),
    computed_age_years: 32,
    blockers: ['No approved identity/vehicle document'],
    ...over,
  };
}

export function withDocument(app: Application, type: KycDocument['doc_type'], over: Partial<KycDocument>): Application {
  return { ...app, documents: app.documents.map((d) => (d.doc_type === type ? { ...d, ...over } : d)) };
}

/** Every document approved and nothing blocking: the state in which Approve rider opens. */
export function applicationReady(over: Partial<Application> = {}): Application {
  const app = applicationInReview({ blockers: [], ...over });
  return { ...app, documents: app.documents.map((d) => ({ ...d, state: 'APPROVED' as const })) };
}

export function summaryRow(over: Partial<Summary> = {}): Summary {
  return {
    rider_account_id: 'b1111111-0000-4000-8000-000000000001',
    display_name: 'Yusuf Ahmed',
    vehicle_type: 'BICYCLE',
    onboarding_state: 'DOCUMENTS_REVIEW',
    attempt_number: 1,
    assigned_admin_id: null,
    review_lock_expires_at: null,
    submitted_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    sla_due_at: new Date(Date.now() + 86_400_000).toISOString(),
    ...over,
  };
}
