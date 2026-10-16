import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { Route } from 'react-router-dom';

import { fixture, mockApi, renderRedesign, resetSession } from '../../testing';
import CertificateViewerRoute from '../viewer/CertificateViewerRoute';
import { applicationFor, envelope, minutesFromNow, pendingCertificate, type Certificate } from './support';

afterEach(() => {
  cleanup();
  resetSession();
  vi.unstubAllGlobals();
});

type Role = 'ADMIN' | 'SUPER_ADMIN' | 'SUPPORT_AGENT';

const LINK = 'https://files.halalgoes.test/certificates/karahi-house/hma-on-0417.png?X-Amz-Signature=secret-signature';

function renderViewer(cert: Certificate, opts: { role?: Role; overrides?: Parameters<typeof mockApi>[0] } = {}) {
  const api = mockApi({
    getHalalCertificate: { data: cert },
    getRestaurantApplication: { data: applicationFor(cert) },
    createDocumentDownloadUrl: { data: { url: LINK, expires_at: minutesFromNow(2) } },
    ...opts.overrides,
  });
  renderRedesign(<Route path="/certificates/:certificateId/viewer" element={<CertificateViewerRoute />} />, {
    route: `/certificates/${cert.id}/viewer`,
    principal: opts.role ?? 'ADMIN',
  });
  return api;
}

describe('Certificate viewer', () => {
  it('shows the scan from a private link and the transcription beside it, read-only', async () => {
    const cert = pendingCertificate();
    const api = renderViewer(cert);
    const img = await screen.findByRole('img', { name: 'Halal certificate scan' });
    expect(img.getAttribute('src')).toBe(LINK);
    expect(api.callsTo('createDocumentDownloadUrl')).toHaveLength(1);
    expect(screen.getByText(/Private link valid until .* viewing is audited/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Transcription' })).toBeTruthy();
    expect(screen.getByText(cert.certificate_number!)).toBeTruthy();
    // The link is used by the image and nowhere else: not in any text, label or address.
    expect(document.body.textContent).not.toContain('secret-signature');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('says the link expired and offers a new one, without losing the page', async () => {
    const api = renderViewer(pendingCertificate(), {
      overrides: { createDocumentDownloadUrl: { data: { url: LINK, expires_at: new Date(Date.now() - 1000).toISOString() } } },
    });
    expect(await screen.findByText('This link expired')).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Halal certificate scan' })).toBeNull();
    api.set({ createDocumentDownloadUrl: { data: { url: LINK, expires_at: minutesFromNow(2) } } });
    screen.getByRole('button', { name: 'Get a new link' }).click();
    await waitFor(() => expect(api.callsTo('createDocumentDownloadUrl')).toHaveLength(2));
  });

  it('offers a retry when the link could not be made', async () => {
    renderViewer(pendingCertificate(), {
      overrides: { createDocumentDownloadUrl: { status: 500, body: envelope('INTERNAL_ERROR', 'boom') } },
    });
    expect(await screen.findByText('The document didn’t load')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('with no document attached, asks for nothing from storage and says so', async () => {
    const api = renderViewer({ ...pendingCertificate(), document_id: null });
    expect(await screen.findByRole('heading', { name: 'No certificate document is attached' })).toBeTruthy();
    expect(api.callsTo('createDocumentDownloadUrl')).toHaveLength(0);
  });

  it('refuses a support agent before any link is made', async () => {
    const api = renderViewer({ ...pendingCertificate(), document_id: null }, { role: 'SUPPORT_AGENT' });
    expect(await screen.findByRole('heading', { name: 'Support agents can’t open documents' })).toBeTruthy();
    expect(api.callsTo('createDocumentDownloadUrl')).toHaveLength(0);
    expect(screen.queryByRole('heading', { name: 'Transcription' })).toBeNull();
  });

  it('says the certificate does not exist on a 404', async () => {
    renderViewer(pendingCertificate(), {
      overrides: { getHalalCertificate: { status: 404, body: fixture('error_not_found') } },
    });
    expect(await screen.findByRole('heading', { name: 'This certificate doesn’t exist' })).toBeTruthy();
  });

  it('offers a retry when the certificate itself did not load', async () => {
    renderViewer(pendingCertificate(), {
      overrides: { getHalalCertificate: { status: 500, body: envelope('INTERNAL_ERROR', 'boom') } },
    });
    expect(await screen.findByText('The certificate didn’t load')).toBeTruthy();
  });

  it('shows a field nobody transcribed as not transcribed, never as a value', async () => {
    renderViewer({ ...pendingCertificate(), certificate_number: null, certified_legal_name: null, issuing_body: null, scope: null });
    await screen.findByRole('heading', { name: 'Transcription' });
    expect(screen.getAllByText('Not transcribed yet').length).toBeGreaterThanOrEqual(4);
  });

  it('shows a calendar date on the day the certificate says, not the evening before', async () => {
    renderViewer({ ...pendingCertificate(), issued_on: '2026-01-15', expires_on: '2027-01-14' });
    expect(await screen.findByText('15 January 2026')).toBeTruthy();
    expect(screen.getByText('14 January 2027')).toBeTruthy();
  });
});
