import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route } from 'react-router-dom';

import { fixture, mockApi, renderRedesign, resetSession } from '../../testing';
import CertificateConsoleRoute from '../console/CertificateConsoleRoute';
import {
  ALL_SEVEN_PASS,
  applicationFor,
  certificateFixture,
  envelope,
  minutesFromNow,
  pendingCertificate,
  recorded,
  type Application,
  type Certificate,
} from './support';

afterEach(() => {
  cleanup();
  resetSession();
  vi.unstubAllGlobals();
});

type Role = 'ADMIN' | 'SUPER_ADMIN' | 'SUPPORT_AGENT';

function renderConsole(cert: Certificate, opts: { role?: Role; app?: Application | null; overrides?: Parameters<typeof mockApi>[0] } = {}) {
  const app = opts.app === undefined ? applicationFor(cert) : opts.app;
  const api = mockApi({
    getHalalCertificate: { data: cert },
    getRestaurantApplication: app ? { data: app } : { status: 500, body: fixture('error_internal_error') },
    listHalalIssuingBodies: 'halal_issuing_bodies_every_status',
    ...opts.overrides,
  });
  renderRedesign(<Route path="/certificates/:certificateId" element={<CertificateConsoleRoute />} />, {
    route: `/certificates/${cert.id}`,
    principal: opts.role ?? 'ADMIN',
  });
  return api;
}

const checkRow = (code: string) => document.querySelector<HTMLElement>(`[data-check="${code}"]`)!;
const radiosIn = (code: string) => within(checkRow(code)).queryAllByRole('radio').map((r) => (r as HTMLInputElement).value);

describe('Console: the transcription comes first', () => {
  it('refuses a save with every field empty: counts and lists them, marks each, focuses the first, sends nothing', async () => {
    const cert = certificateFixture('halal_certificate_pending_untranscribed');
    const api = renderConsole(cert);
    const save = await screen.findByRole('button', { name: 'Save transcription' });
    fireEvent.click(save);
    const summary = await screen.findByText('The transcription wasn’t saved: 7 fields are empty');
    // A status, not an alert: it must not take focus from the field.
    expect(summary.closest('[role="status"]')).toBeTruthy();
    expect(summary.closest('[role="alert"]')).toBeNull();
    expect(screen.getByText('Enter the certificate number as printed.')).toBeTruthy();
    expect(screen.getByText('Choose the issuing body.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText(/^Certificate number/));
    expect(api.callsTo('transcribeHalalCertificate')).toHaveLength(0);
  });

  it('keeps the checks read-only and Reject unavailable until the transcription is saved', async () => {
    renderConsole(certificateFixture('halal_certificate_pending_untranscribed'));
    expect(await screen.findByText('Step 2 opens after step 1')).toBeTruthy();
    expect(within(screen.getByTestId('ChecksPane')).queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByRole('button', { name: /^Reject…, unavailable: record the check that fails first/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Approve…, unavailable: save the transcription first/ })).toBeTruthy();
  });

  it('with no document there is nothing to transcribe and the only action is to ask for a new certificate', async () => {
    renderConsole({ ...certificateFixture('halal_certificate_pending_untranscribed'), document_id: null });
    expect(await screen.findByText('Nothing to transcribe')).toBeTruthy();
    expect(screen.getByText('Nothing to check against')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Reject…/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Approve…/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ask for a new certificate…' })).toBeTruthy();
  });
});

describe('Console: the seven checks', () => {
  it('leaves every check "Not recorded" with nothing selected, whatever the system suggests', async () => {
    renderConsole(pendingCertificate());
    await screen.findByText('Step 2: The seven checks');
    for (const code of ['H1', 'H2', 'H3', 'H4', 'H6']) {
      expect(within(checkRow(code)).queryAllByRole('radio', { checked: true })).toHaveLength(0);
      expect(checkRow(code).getAttribute('data-state')).toBe('not-recorded');
    }
    // The server computes these two and nobody can change them.
    for (const code of ['H5', 'H7']) {
      expect(within(checkRow(code)).queryAllByRole('radio')).toHaveLength(0);
      expect(checkRow(code).textContent).toContain('Computed by the server · locked');
    }
    expect(checkRow('H6').textContent).toContain('Suggested: Pass. The saved scope is Whole establishment.');
  });

  it('offers only Fail and Not assessed for an issuer that isn’t Accepted, and for a scope that doesn’t cover the kitchen', async () => {
    const suspended = certificateFixture('halal_certificate_pending_issuer_suspended');
    renderConsole(suspended);
    await screen.findByText('Step 2: The seven checks');
    expect(radiosIn('H2')).toEqual(['FAIL', 'NOT_ASSESSED']);
    expect(checkRow('H2').textContent).toContain('is suspended in the registry. Only an Accepted body passes this check.');
    cleanup();

    renderConsole(certificateFixture('halal_certificate_pending_scope_supplier_chain'));
    await screen.findByText('Step 2: The seven checks');
    expect(radiosIn('H6')).toEqual(['FAIL', 'NOT_ASSESSED']);
    expect(checkRow('H6').textContent).toContain('Scope is Supplier chain only: only Whole establishment or Kitchen only passes.');
  });

  it('computed Fail on Dates valid: locked, Approve off by name, and Reject opens with its own reason', async () => {
    const cert = certificateFixture('halal_certificate_pending_h5_computed_fail');
    renderConsole(cert);
    await screen.findByText('H5 Dates valid, computed: Fail');
    expect(checkRow('H5').textContent).toContain('Computed Fail · locked for everyone');
    expect(screen.getByRole('button', { name: /^Approve…, unavailable: H5 Dates valid is computed as Fail/ })).toBeTruthy();
    fireEvent.click(within(screen.getByTestId('DecisionBar')).getByRole('button', { name: 'Reject…' }));
    const panel = await screen.findByRole('region', { name: 'Reject this certificate?' });
    expect((within(panel).getByLabelText(/^Reason/) as HTMLSelectElement).value).toBe('EXPIRED_OR_EXPIRING');
    expect(within(panel).getByText(/H5 Dates valid, computed: Fail/)).toBeTruthy();
  });

  it('a duplicate certificate number is a computed Fail that preselects its own reason', async () => {
    renderConsole(certificateFixture('halal_certificate_pending_h7_duplicate'));
    await screen.findByText(/H7 Unique, not reused, computed: Fail/);
    fireEvent.click(within(screen.getByTestId('DecisionBar')).getByRole('button', { name: 'Reject…' }));
    const panel = await screen.findByRole('region', { name: 'Reject this certificate?' });
    expect((within(panel).getByLabelText(/^Reason/) as HTMLSelectElement).value).toBe('DUPLICATE_CERTIFICATE');
  });
});

describe('Console: recording a check', () => {
  it('needs a written note of at least 20 characters to go against the suggestion', async () => {
    const cert = recorded(pendingCertificate(), {});
    // H4 is suggested Fail by the server.
    cert.checks = cert.checks.map((c) => (c.check_key === 'H4_ADDRESS_MATCH' ? { ...c, computed_result: 'FAIL' as const } : c));
    const api = renderConsole(cert);
    await screen.findByText('Step 2: The seven checks');
    fireEvent.click(within(within(checkRow('H4')).getByRole('radiogroup')).getByRole('radio', { name: 'Pass' }));
    const note = await within(checkRow('H4')).findByLabelText(/Note for Address match/);
    const record = within(checkRow('H4')).getByRole('button', { name: /^Record Address match, unavailable: the note needs at least 20 characters/ });
    expect(record.getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(note, { target: { value: 'Same building.' } });
    expect(within(checkRow('H4')).getByRole('button', { name: /unavailable: the note needs at least 20 characters/ })).toBeTruthy();
    expect(api.callsTo('recordHalalChecks')).toHaveLength(0);
  });

  it('records one check with its note and updates the roll-up from the server’s answer', async () => {
    const cert = pendingCertificate();
    const after = recorded(cert, { H1_LEGIBLE_COMPLETE: 'PASS' });
    const api = renderConsole(cert, { overrides: { recordHalalChecks: { data: after } } });
    await screen.findByText('Step 2: The seven checks');
    expect(screen.getByTestId('ChecksRollup').textContent).toBe('2 of 7 recorded · 2 pass · 0 fail');
    fireEvent.click(within(within(checkRow('H1')).getByRole('radiogroup')).getByRole('radio', { name: 'Pass' }));
    fireEvent.click(within(checkRow('H1')).getByRole('button', { name: 'Record Legible and complete' }));
    await waitFor(() => expect(api.callsTo('recordHalalChecks')).toHaveLength(1));
    expect(api.callsTo('recordHalalChecks')[0]?.body).toEqual({ checks: [{ check_key: 'H1_LEGIBLE_COMPLETE', result: 'PASS' }] });
    await waitFor(() => expect(screen.getByTestId('ChecksRollup').textContent).toBe('3 of 7 recorded · 3 pass · 0 fail'));
  });

  it('says the page was out of date when the server refuses to override a computed check', async () => {
    const api = renderConsole(pendingCertificate(), {
      overrides: { recordHalalChecks: { status: 409, body: envelope('CHECK_NOT_OVERRIDABLE', 'computed', { check_key: 'H5_DATES_VALID', computed: 'FAIL' }) } },
    });
    await screen.findByText('Step 2: The seven checks');
    fireEvent.click(within(within(checkRow('H1')).getByRole('radiogroup')).getByRole('radio', { name: 'Pass' }));
    fireEvent.click(within(checkRow('H1')).getByRole('button', { name: 'Record Legible and complete' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('This page was out of date');
    expect(alert.textContent).toContain('H5 Dates valid is computed by the server as Fail and can’t be changed.');
    fireEvent.click(within(alert).getByRole('button', { name: 'Reload the checks' }));
    await waitFor(() => expect(api.callsTo('getHalalCertificate').length).toBeGreaterThan(1));
  });
});

describe('Console: approving', () => {
  const allPass = () => recorded(pendingCertificate(), ALL_SEVEN_PASS);

  it('is off with the reason in its name while any check is open', async () => {
    renderConsole(recorded(pendingCertificate(), { H1_LEGIBLE_COMPLETE: 'PASS', H2_ISSUER_ACCEPTED: 'PASS', H3_NAME_MATCH: 'PASS' }));
    const approve = await screen.findByRole('button', { name: /^Approve…, unavailable: 2 checks still needed/ });
    expect(approve.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(/Still open:/).textContent).toContain('H4 Address match');
  });

  it('opens a panel when all seven pass, and sends nothing until the panel’s own button', async () => {
    const cert = allPass();
    const api = renderConsole(cert, { overrides: { decideHalalCertificate: { data: { ...cert, status: 'APPROVED' } } } });
    expect(await screen.findByText('All seven checks pass. You can approve the certificate.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve…' }));
    const panel = await screen.findByRole('region', { name: 'Approve this halal certificate?' });
    expect(api.callsTo('decideHalalCertificate')).toHaveLength(0);
    expect(panel.textContent).toContain('HalalGoes records that it verified the certificate. It does not certify the food.');
    fireEvent.click(within(panel).getByRole('button', { name: 'Approve certificate' }));
    await waitFor(() => expect(api.callsTo('decideHalalCertificate')).toHaveLength(1));
    expect(api.callsTo('decideHalalCertificate')[0]?.body).toEqual({ decision: 'APPROVE' });
  });

  it('turns Approve off once the claim has ended, even with all seven passing', async () => {
    const cert = allPass();
    renderConsole(cert, { app: applicationFor(cert, { review_lock_expires_at: minutesFromNow(-3) }) });
    const approve = await screen.findByRole('button', { name: /^Approve…, unavailable: your claim ended at/ });
    expect(approve.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('button', { name: /^Save transcription, unavailable: your claim ended at/ })).toBeTruthy();
  });

  it('names the checks when the server says the checklist is incomplete or a computed check failed', async () => {
    const cert = allPass();
    renderConsole(cert, {
      overrides: { decideHalalCertificate: { status: 422, body: envelope('CHECKLIST_INCOMPLETE', 'incomplete', { check_keys: ['H4_ADDRESS_MATCH', 'H6_SCOPE_SUFFICIENT'] }) } },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Approve…' }));
    fireEvent.click(within(await screen.findByRole('region', { name: 'Approve this halal certificate?' })).getByRole('button', { name: 'Approve certificate' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Not approved: 2 checks aren’t Pass');
    cleanup();

    renderConsole(cert, {
      overrides: { decideHalalCertificate: { status: 422, body: fixture('error_check_failed') } },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Approve…' }));
    fireEvent.click(within(await screen.findByRole('region', { name: 'Approve this halal certificate?' })).getByRole('button', { name: 'Approve certificate' }));
    expect((await screen.findByRole('alert')).textContent).toContain('failed when the server checked again');
  });
});

describe('Console: revoking', () => {
  const approved = () => certificateFixture('halal_certificate_valid');

  it('stays off until a reason is chosen and the box is ticked, names only what is missing, and is not the danger style', async () => {
    renderConsole(approved(), { role: 'SUPER_ADMIN' });
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke certificate…' }));
    const panel = await screen.findByRole('region', { name: /^Revoke the .* certificate\?/ });
    const revoke = within(panel).getByRole('button', { name: 'Revoke certificate, unavailable: choose a reason and tick the box' });
    expect(revoke.getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(within(panel).getByLabelText(/^Reason/), { target: { value: 'SUSPECTED_FORGERY' } });
    expect(within(panel).getByRole('button', { name: 'Revoke certificate, unavailable: tick the box' })).toBeTruthy();
    expect(revoke.className).not.toMatch(/danger/);
    expect(within(panel).getAllByRole('button').map((b) => b.textContent)).toEqual(expect.arrayContaining(['Keep it approved']));
  });

  it('shows "Only super admins can revoke" when the server refuses an admin', async () => {
    const api = renderConsole(approved(), { role: 'ADMIN', overrides: { decideHalalCertificate: { status: 403, body: fixture('error_forbidden') } } });
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke certificate…' }));
    const panel = await screen.findByRole('region', { name: /^Revoke the .* certificate\?/ });
    fireEvent.change(within(panel).getByLabelText(/^Reason/), { target: { value: 'OTHER' } });
    fireEvent.change(within(panel).getByLabelText(/Message to the restaurant/), { target: { value: 'The issuer withdrew this certificate.' } });
    fireEvent.click(within(panel).getByRole('checkbox'));
    fireEvent.click(within(panel).getByRole('button', { name: 'Revoke certificate' }));
    expect((await screen.findByText('Only super admins can revoke a certificate')).closest('[role="alert"]')).toBeTruthy();
    expect(api.callsTo('decideHalalCertificate')[0]?.body).toMatchObject({ decision: 'REVOKE', reason_code: 'OTHER' });
  });
});

describe('Console: roles and read-only views', () => {
  it('shows a support agent the summary only: status, expiry, issuer, no scan, no checks, no number', async () => {
    const cert = certificateFixture('halal_certificate_support_projection');
    renderConsole(cert, { role: 'SUPPORT_AGENT', app: applicationFor(cert) });
    const summary = await screen.findByTestId('SupportSummary');
    expect(summary.textContent).toContain('Certificate status');
    expect(summary.textContent).toContain('Support agents see this summary only.');
    expect(screen.queryByTestId('ChecksPane')).toBeNull();
    expect(screen.queryByRole('button', { name: /Approve|Reject|Save transcription/ })).toBeNull();
  });

  it('is read-only for someone who is only inspecting an unclaimed application', async () => {
    const cert = pendingCertificate();
    renderConsole(cert, { app: applicationFor(cert, { assigned_admin_id: null, review_lock_expires_at: null }) });
    expect(await screen.findByText('Not claimed · You are inspecting')).toBeTruthy();
    expect(within(screen.getByTestId('ChecksPane')).queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryByLabelText(/^Certificate number/)).toBeNull();
    expect(screen.getByRole('button', { name: /^Approve…, unavailable: nobody has claimed this application/ })).toBeTruthy();
  });
});

describe('Console: halal statuses and the badge', () => {
  const statuses = [
    ['halal_certificate_status_pending', 'Pending review'],
    ['halal_certificate_status_approved', 'Approved'],
    ['halal_certificate_status_rejected', 'Rejected'],
    ['halal_certificate_status_expired', 'Expired'],
    ['halal_certificate_status_revoked', 'Revoked'],
    ['halal_certificate_status_superseded', 'Superseded'],
  ] as const;

  it.each(statuses)('draws %s as "%s" and never in red', async (scenario, label) => {
    renderConsole(certificateFixture(scenario));
    const badge = await screen.findByTestId('CertificateStatusBadge');
    expect(badge.textContent).toContain(label);
    // Not red: no danger colour role anywhere on the status label.
    expect(badge.className).not.toMatch(/danger|(^|[\s-])red([\s-]|$)/);
    if (scenario === 'halal_certificate_status_expired') expect(badge.getAttribute('data-tone')).toBe('slate');
  });

  it('draws the restaurant’s badge only from profile.halal: absent means no badge at all', async () => {
    const cert = pendingCertificate();
    const app = applicationFor(cert);
    const { halal: _halal, ...profile } = app.profile;
    renderConsole(cert, { app: { ...app, profile } });
    await screen.findByText('Restaurant now:');
    expect(document.querySelector('[data-halal-render]')).toBeNull();
    cleanup();

    renderConsole(cert, { app: { ...app, profile: { ...app.profile, halal: { display_state: 'EXPIRING_SOON', expires_on: '2026-11-19' } } } });
    await screen.findByText('Restaurant now:');
    expect(document.querySelector('[data-halal-render]')?.getAttribute('data-halal-render')).toBe('expiring');
  });
});
