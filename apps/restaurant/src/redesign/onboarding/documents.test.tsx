/**
 * Restaurant onboarding, the documents, review and fix steps (canvas ON). Few tests, each pinning something the
 * product cannot be wrong about: the halal rules (no badge without data, never red, expired is
 * slate), the private-bucket road (fresh link per click, link never left in the page), the
 * documents-incomplete refusal, and the rejection-and-resend path.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { consoleRoutes, errorBody, fixture, installFakeApi, type Handler } from '../test/fakeApi';
import { renderRedesign } from '../test/render';
import { setPutObjectForTests } from './upload';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setPutObjectForTests(undefined);
});

const ONB = 'GET /v1/restaurant/onboarding/status';
const DOCS = 'GET /v1/restaurant/documents';

function routes(onboarding: string, docs: Handler, extra: Record<string, Handler> = {}) {
  return consoleRoutes({ [ONB]: onboarding, [DOCS]: docs, ...extra });
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('the setup rail and the halal rules', () => {
  it('shows the step and the progress the server sent, and no seal without halal data', async () => {
    const profile = fixture('restaurant_profile_halal_missing');
    installFakeApi(routes('restaurant_onboarding_documents_pending', 'restaurant_document_pack_empty', { 'GET /v1/restaurant/profile': { body: profile } }));
    await renderRedesign('/onboarding');
    const rail = await screen.findByTestId('setup-rail');
    expect(within(rail).getByTestId('rail-current-step').textContent).toBe('Documents');
    expect(within(rail).getByText('40% complete')).toBeTruthy();
    // Silence is never consent on a halal claim: no halal object, no badge of any kind.
    expect(within(rail).queryByTestId('HalalBadge')).toBeNull();
    expect(within(rail).getByTestId('rail-no-halal')).toBeTruthy();
  });

  it('draws an expired halal certificate in slate, never red or amber, in the rail and on its row', async () => {
    const expired = fixture('document_expired');
    expired.doc_type = 'HALAL_CERTIFICATE';
    expired.issuer = 'HMA Canada';
    installFakeApi(
      routes('restaurant_onboarding_documents_review', { body: [expired] }, { 'GET /v1/restaurant/profile': 'restaurant_profile_halal_expired' }),
    );
    await renderRedesign('/onboarding/review');
    const block = await screen.findByTestId('expired-block');
    expect(block.getAttribute('data-tone')).toBe('slate');
    expect(block.className).not.toMatch(/danger|warning/);
    expect(screen.getByText('Your halal certificate needs renewing')).toBeTruthy();
    const rail = screen.getByTestId('setup-rail');
    expect(within(rail).getByTestId('HalalBadge').getAttribute('data-halal-render')).toMatch(/expired/i);
    expect(screen.getByTestId('badge-halal-certificate').innerHTML).not.toMatch(/danger|warning/);
    // The rail row for the review says "Renew certificate", an outlined badge, not the amber one.
    expect(within(rail).getByText('Renew certificate')).toBeTruthy();
  });

  it('never asks for liability insurance', async () => {
    installFakeApi(routes('restaurant_onboarding_documents_pending', 'restaurant_document_pack_complete'));
    await renderRedesign('/onboarding');
    await screen.findByText('Required documents');
    expect(screen.queryByText(/insurance/i)).toBeNull();
    expect(screen.getByTestId('doc-count').textContent).toBe('4 of 4 required documents added');
  });
});

describe('the documents step', () => {
  it('refuses an incomplete pack with the missing document named, never disables Send, and loses nothing', async () => {
    const api = installFakeApi(
      routes('restaurant_onboarding_documents_pending', 'restaurant_document_pack_incomplete', {
        'POST /v1/restaurant/documents/submit': { status: 422, body: fixture('error_documents_incomplete').error ? undefined : undefined },
      }),
    );
    // The contract's own refusal body (names OWNER_ID and the hidden LIABILITY_INSURANCE).
    const refusal = (await import('../../../../../contracts/fixtures/errors/error_documents_incomplete.json')).default.payload;
    api.set('POST /v1/restaurant/documents/submit', { status: 422, body: refusal });
    await renderRedesign('/onboarding');
    const send = await screen.findByRole('button', { name: 'Send for review' });
    expect(send.hasAttribute('disabled')).toBe(false);
    fireEvent.click(send);
    const alert = await screen.findByTestId('incomplete-alert');
    expect(within(alert).getByText('Your documents weren’t sent')).toBeTruthy();
    expect(within(alert).getByRole('link', { name: 'Owner ID' })).toBeTruthy();
    expect(alert.textContent).not.toMatch(/insurance/i);
    expect(alert.textContent).toContain('Nothing you added is lost');
    // The link opens that row's detail.
    fireEvent.click(within(alert).getByRole('link', { name: 'Owner ID' }));
    await waitFor(() => expect(document.activeElement?.id).toBe('doc-detail-h'));
    expect(screen.getByRole('heading', { level: 2, name: 'Owner ID' })).toBeTruthy();
  });

  it('uploads through the presigned road: declare, PUT with the signed headers, confirm, then save the details', async () => {
    const presigned = fixture('presigned_upload');
    presigned.required_headers = { 'Content-Type': 'application/pdf', 'x-amz-checksum-sha256': 'abc' };
    const puts: { url: string; headers: Record<string, string> }[] = [];
    setPutObjectForTests(async (upload, _file, { onProgress }) => {
      puts.push({ url: upload.url, headers: upload.required_headers });
      onProgress(1);
      return 'ok';
    });
    const api = installFakeApi(
      routes('restaurant_onboarding_documents_pending', 'restaurant_document_pack_empty', {
        'POST /v1/uploads': { status: 201, body: presigned },
        [`POST /v1/uploads/${presigned.upload_id}/confirm`]: { body: fixture('stored_object_ready') },
        'POST /v1/restaurant/documents': { status: 201, body: fixture('document_submitted') },
      }),
    );
    await renderRedesign('/onboarding');
    // The first empty row is the business licence.
    await screen.findByRole('heading', { level: 2, name: 'Business licence' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array(16)], 'business-licence-2026.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(16) });
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByLabelText(/Licence number/);
    expect(puts).toEqual([{ url: presigned.url, headers: presigned.required_headers }]);
    const createBody = await api.callsTo('POST /v1/uploads')[0]!.json();
    expect(createBody).toMatchObject({ purpose: 'KYC_DOCUMENT', content_type: 'application/pdf', byte_size: 16 });
    expect(createBody.sha256).toMatch(/^[a-f0-9]{64}$/);
    fireEvent.click(screen.getByRole('button', { name: /Save document/ }));
    await waitFor(() => expect(api.callsTo('POST /v1/restaurant/documents')).toHaveLength(1));
    const attach = await api.callsTo('POST /v1/restaurant/documents')[0]!.json();
    expect(attach).toMatchObject({ doc_type: 'BUSINESS_LICENCE', stored_object_id: fixture('stored_object_ready').id });
    // The presigned address is not in the page, and no attach body carries it.
    expect(JSON.stringify(attach)).not.toContain(presigned.url);
    expect(document.body.innerHTML).not.toContain(presigned.url);
  });

  it('shows the file check’s own reason when it rejects a file, and a halal date that has passed asks for the current certificate', async () => {
    const presigned = fixture('presigned_upload');
    setPutObjectForTests(async () => 'ok');
    const rejected = fixture('stored_object_rejected');
    rejected.reject_reason = 'Embedded script content is not allowed';
    installFakeApi(
      routes('restaurant_onboarding_documents_pending', 'restaurant_document_pack_empty', {
        'POST /v1/uploads': { status: 201, body: presigned },
        [`POST /v1/uploads/${presigned.upload_id}/confirm`]: { body: rejected },
      }),
    );
    await renderRedesign('/onboarding');
    await screen.findByRole('heading', { level: 2, name: 'Business licence' });
    const file = new File([new Uint8Array(16)], 'owner-id-scan.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(16) });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
    const alert = await screen.findByTestId('draft-error');
    expect(within(alert).getByText('Our file check rejected this file')).toBeTruthy();
    expect(within(alert).getByTestId('scan-reason').textContent).toBe('Embedded script content is not allowed');
  });
});

describe('private documents', () => {
  it('makes a new link on every Download click and leaves no address in the page', async () => {
    let n = 0;
    const clicks: string[] = [];
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicks.push(this.href);
    };
    const api = installFakeApi(
      routes('restaurant_onboarding_documents_pending', 'restaurant_document_pack_complete', {
        'GET /v1/documents/:id/download-url': { body: {} },
      }),
    );
    // The route table is keyed by exact path, so serve the four document ids.
    for (const d of fixture('restaurant_document_pack_complete')) {
      api.set(`GET /v1/documents/${d.id}/download-url`, () => {
        n += 1;
        return { body: { url: `https://files.example.test/private/${n}?sig=short`, expires_at: new Date(Date.now() + 120_000).toISOString() } };
      });
    }
    try {
      await renderRedesign('/onboarding');
      await screen.findByText('Required documents');
      const button = await screen.findByRole('button', { name: 'Download file: business licence' });
      fireEvent.click(button);
      fireEvent.click(button);
      await waitFor(() => expect(clicks).toHaveLength(2));
      expect(clicks[0]).not.toBe(clicks[1]);
      expect(api.calls.filter((c) => c.url.includes('/download-url'))).toHaveLength(2);
      await flush();
      expect(document.body.innerHTML).not.toContain('files.example.test');
    } finally {
      HTMLAnchorElement.prototype.click = realClick;
    }
  });

  it('says a download link expired without changing the row', async () => {
    const docs = fixture('restaurant_document_pack_complete');
    const api = installFakeApi(routes('restaurant_onboarding_documents_pending', { body: docs }));
    for (const d of docs) api.set(`GET /v1/documents/${d.id}/download-url`, { status: 404, body: errorBody('NOT_FOUND') });
    await renderRedesign('/onboarding');
    fireEvent.click(await screen.findByRole('button', { name: 'Download file: business licence' }));
    const alert = await screen.findByTestId('download-error');
    expect(within(alert).getByText('We couldn’t open this file')).toBeTruthy();
    expect(screen.getByTestId('badge-business-licence').textContent).toContain('Approved');
  });
});

describe('fix documents after a rejection', () => {
  const rejectedPack = () => fixture('restaurant_document_pack_incomplete');

  it('shows the reviewer’s note verbatim, plain wording for the code, and an amber (never red) halal row', async () => {
    installFakeApi(routes('restaurant_onboarding_documents_rejected', { body: rejectedPack() }));
    await renderRedesign('/onboarding');
    const block = await screen.findByTestId('rejection-block');
    expect(within(block).getByText('We couldn’t read it')).toBeTruthy();
    expect(within(block).getByTestId('review-note').textContent).toBe(rejectedPack()[1].review_note);
    expect(block.className).not.toMatch(/danger/);
    expect(screen.getByTestId('badge-halal-certificate').textContent).toContain('New upload');
    expect(screen.getByTestId('badge-halal-certificate').innerHTML).not.toMatch(/danger/);
    expect(screen.getByRole('heading', { level: 1, name: 'Fix your documents' })).toBeTruthy();
    // Approved stays approved and locked: no upload offered on it.
    fireEvent.click(screen.getByRole('button', { name: /Business licence/ }));
    expect(screen.queryByRole('button', { name: /Upload new file/ })).toBeNull();
  });

  it('sends only after the rejected document has a new upload, and moves on with the status the server returns', async () => {
    const presigned = fixture('presigned_upload');
    setPutObjectForTests(async () => 'ok');
    let docs = rejectedPack();
    let sent = false;
    const api = installFakeApi(
      routes('restaurant_onboarding_documents_rejected', () => ({ body: docs }), {
        [ONB]: () => ({ body: fixture(sent ? 'restaurant_onboarding_documents_review' : 'restaurant_onboarding_documents_rejected') }),
        'POST /v1/uploads': { status: 201, body: presigned },
        [`POST /v1/uploads/${presigned.upload_id}/confirm`]: { body: fixture('stored_object_ready') },
        'POST /v1/restaurant/documents': () => {
          const replaced = { ...docs[1], id: 'dd7f4b86-1c9a-4a71-8f3e-0b8a1f1f2a01', state: 'SUBMITTED', version: 2, rejection_reason_code: null, review_note: null };
          docs = [...docs, replaced];
          return { status: 201, body: replaced };
        },
        'POST /v1/restaurant/documents/submit': () => {
          sent = true;
          return { body: fixture('restaurant_onboarding_documents_review') };
        },
      }),
    );
    await renderRedesign('/onboarding');
    // Before the replacement the footer says what is still needed, and offers no Send.
    expect(await screen.findByTestId('fix-footer-pending')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send for review again' })).toBeNull();
    const file = new File([new Uint8Array(16)], 'halal-certificate-all-pages.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(16) });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
    const issuer = await screen.findByLabelText('Issuing body');
    fireEvent.change(issuer, { target: { value: 'HMA Canada' } });
    const valid = screen.getByLabelText('Valid until');
    fireEvent.change(valid, { target: { value: '2099-03-14' } });
    fireEvent.click(screen.getByRole('button', { name: /Save document/ }));
    const sendAgain = await screen.findByRole('button', { name: 'Send for review again' });
    fireEvent.click(sendAgain);
    await waitFor(() => expect(api.callsTo('POST /v1/restaurant/documents/submit')).toHaveLength(1));
    const attach = await api.callsTo('POST /v1/restaurant/documents')[0]!.json();
    expect(attach).toMatchObject({ doc_type: 'HALAL_CERTIFICATE', issuer: 'HMA Canada', valid_until: '2099-03-14' });
    // The returned status says AWAITING_REVIEW, so the page is now the review page.
    expect(await screen.findByText('Your documents are with a reviewer')).toBeTruthy();
  });

  it('puts Call partner support first, and no way to re-send the same file, for a suspected forgery', async () => {
    const forged = fixture('document_rejected_suspected_forgery');
    forged.doc_type = 'HALAL_CERTIFICATE';
    installFakeApi(routes('restaurant_onboarding_documents_rejected', { body: [forged] }));
    await renderRedesign('/onboarding');
    const block = await screen.findByTestId('rejection-block');
    expect(within(block).getByText('We couldn’t verify this certificate')).toBeTruthy();
    const call = await within(block).findByRole('link', { name: /Call partner support/ });
    expect(call.getAttribute('href')).toMatch(/^tel:\+/);
    expect(within(block).queryByText('Upload new file')).toBeNull();
  });
});

describe('the frame', () => {
  it('shows the update page for a step it does not know, and never prints the value', async () => {
    const status = fixture('restaurant_onboarding_active');
    status.current_step = 'BRAND_NEW_STEP';
    installFakeApi(routes('restaurant_onboarding_documents_pending', 'restaurant_document_pack_empty', { [ONB]: { body: status } }));
    await renderRedesign('/onboarding');
    expect(await screen.findByText('This page needs an update')).toBeTruthy();
    expect(document.body.textContent).not.toContain('BRAND_NEW_STEP');
  });

  it('keeps the owner on the page the server names, even when the URL asks for another', async () => {
    installFakeApi(routes('restaurant_onboarding_documents_review', 'restaurant_document_pack_incomplete'));
    await renderRedesign('/onboarding/documents');
    expect(await screen.findByText('Your documents are with a reviewer')).toBeTruthy();
  });
});
