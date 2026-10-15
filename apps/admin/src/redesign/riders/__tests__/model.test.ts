import { describe, expect, it } from 'vitest';

import { contractSpec } from '../../testing/contract';
import { ALL_STATES, STATE_LABEL, VEHICLE_LABEL, reviewTargetOf, claimText, filterText, DEFAULT_STATES } from '../queue/model';
import { claimOf } from '../../verification/shared/claim';
import { DOC_LABEL, REJECTION_REASON_LABEL, applicationReasons, decisionGate, documentReasons, modeOf, readiness, requiredDocTypes } from '../application/model';
import { checklistFor } from '../application/checklists';
import { ADMIN_ID, applicationInReview, applicationReady, minutesFromNow, summaryRow, withDocument } from './support';

const enumOf = (name: string) => contractSpec().components.schemas[name]?.enum ?? [];

describe('rider labels follow the contract', () => {
  it('has a word for every onboarding state, vehicle, document type and rejection reason the contract defines', () => {
    expect(Object.keys(STATE_LABEL).sort()).toEqual([...enumOf('RiderOnboardingState')].sort());
    expect(Object.keys(VEHICLE_LABEL).sort()).toEqual([...enumOf('VehicleType')].sort());
    expect(Object.keys(DOC_LABEL).sort()).toEqual([...enumOf('RiderDocType')].sort());
    expect(Object.keys(REJECTION_REASON_LABEL).sort()).toEqual([...enumOf('DocumentRejectionReasonCode')].sort());
    expect(ALL_STATES).toHaveLength(10);
  });

  it('never offers a suspected forgery or alteration reason, and filters reasons by document type', () => {
    for (const type of requiredDocTypes('CAR')) {
      expect(documentReasons(type)).not.toContain('SUSPECTED_FORGERY');
      expect(documentReasons(type)).not.toContain('SUSPECTED_ALTERATION');
      expect(documentReasons(type)).not.toContain('ADDRESS_MISMATCH');
    }
    expect(documentReasons('VEHICLE_INSURANCE')).toContain('PLATE_MISMATCH');
    expect(documentReasons('PROFILE_PHOTO')).not.toContain('PLATE_MISMATCH');
    expect(applicationReasons('BICYCLE')).not.toContain('PLATE_MISMATCH');
  });

  it('asks a bicycle rider for three documents and a motorised rider for five', () => {
    expect(requiredDocTypes('BICYCLE')).toEqual(['GOVERNMENT_ID', 'WORK_ELIGIBILITY', 'PROFILE_PHOTO']);
    expect(requiredDocTypes('MOTORCYCLE')).toHaveLength(5);
    const names = checklistFor('VEHICLE_REGISTRATION', { plate: 'CKRT 482' }).map((c) => c.label);
    expect(names.some((n) => n.includes('(CKRT 482)'))).toBe(true);
  });
});

describe('queue cells', () => {
  it('shows the review target only while a reviewer owes a decision, and flags a missed one', () => {
    const row = summaryRow({ sla_due_at: minutesFromNow(-90) });
    expect(reviewTargetOf(row).kind).toBe('missed');
    expect(reviewTargetOf(summaryRow({ onboarding_state: 'ACTIVE' })).kind).toBe('decided');
    expect(reviewTargetOf(summaryRow({ onboarding_state: 'REGISTERED' })).kind).toBe('not-in-review');
  });

  it('reads an ended claim as unclaimed, with when it ended', () => {
    const mine = summaryRow({ assigned_admin_id: ADMIN_ID, review_lock_expires_at: minutesFromNow(-3) });
    expect(claimText(mine, claimOf(mine, ADMIN_ID)).primary).toBe('Unclaimed');
    expect(claimText(mine, claimOf(mine, ADMIN_ID)).secondary).toMatch(/your claim ended/);
    const theirs = summaryRow({ assigned_admin_id: 'someone-else', review_lock_expires_at: minutesFromNow(-3) });
    expect(claimText(theirs, claimOf(theirs, ADMIN_ID)).secondary).toMatch(/previous claim ended/);
  });

  it('names the default filter and the all-states filter', () => {
    expect(filterText(DEFAULT_STATES)).toBe('Documents review');
    expect(filterText(ALL_STATES)).toBe('All 10 states');
  });
});

describe('who may approve', () => {
  it('opens Approve only when every required document is approved, nothing blocks and the rider is 18 or older', () => {
    const ready = applicationReady();
    expect(decisionGate(ready, modeOf(ready, claimOf(ready, ADMIN_ID))).canApprove).toBe(true);

    const oneLeft = withDocument(ready, 'WORK_ELIGIBILITY', { state: 'IN_REVIEW' });
    const gate = decisionGate(oneLeft, 'claimed');
    expect(gate.canApprove).toBe(false);
    expect(gate.approveWhy).toBe('1 of 5 documents isn’t approved yet');
    expect(readiness(oneLeft).approved).toBe(4);

    expect(decisionGate({ ...ready, blockers: ['Rider is under 18'] }, 'claimed').canApprove).toBe(false);
  });

  it('turns Approve off for good under 18, but leaves Reject and Request changes open', () => {
    const young = applicationReady({ computed_age_years: 17 });
    const gate = decisionGate(young, 'claimed');
    expect(gate).toMatchObject({ canApprove: false, canDecide: true });
    expect(gate.approveWhy).toMatch(/under 18/);
  });

  it('turns every decision off without a live claim of your own', () => {
    const app = applicationInReview();
    for (const mode of ['inspect', 'other-reviewer', 'claim-ended', 'decided'] as const) {
      expect(decisionGate(app, mode)).toMatchObject({ canApprove: false, canDecide: false });
    }
  });
});
