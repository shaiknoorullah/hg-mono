/**
 * Sending another document from settings (settings boards `Doc-*`, `Renew-Cancel`, `Renew-TooEarly`,
 * issue #883): the sheet reuses the upload road onboarding walks, a cancel asks first, and a renewal
 * the server turns away as too early is explained with the file and details kept.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { consoleRoutes, errorBody, fixture, installFakeApi, type Handler } from '../test/fakeApi';
import { renderRedesign } from '../test/render';
import { setPutObjectForTests } from '../onboarding/upload';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setPutObjectForTests(undefined);
});

const presigned = fixture('presigned_upload');
const road = (extra: Record<string, Handler> = {}) =>
  consoleRoutes({
    'GET /v1/restaurant/documents': 'restaurant_document_pack_complete',
    'GET /v1/restaurant/hours': 'restaurant_hours_standard',
    'POST /v1/uploads': { status: 201, body: presigned },
    [`POST /v1/uploads/${presigned.upload_id}/confirm`]: { body: fixture('stored_object_ready') },
    'POST /v1/restaurant/documents': { status: 201, body: fixture('document_submitted') },
    'POST /v1/restaurant/documents/submit': { body: fixture('restaurant_onboarding_documents_review') },
    ...extra,
  });

function choose(name = 'food-safety-2027.pdf') {
  const file = new File([new Uint8Array(16)], name, { type: 'application/pdf' });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(16) });
  fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
}

describe('upload another document', () => {
  it('offers the upload on the documents that can take one, never on the halal certificate or one in review', async () => {
    const docs = fixture('restaurant_document_pack_complete');
    docs.find((d: { doc_type: string }) => d.doc_type === 'OWNER_ID').state = 'IN_REVIEW';
    installFakeApi(road({ 'GET /v1/restaurant/documents': { body: docs } }));
    await renderRedesign('/settings/documents');
    expect(await screen.findByRole('button', { name: 'Upload new version: food safety certificate' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload new version: business licence' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Upload new version: halal certificate/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Upload new version: owner ID/ })).toBeNull();
  });

  it('sends the food safety certificate through the onboarding road, then closes the sheet and says so', async () => {
    setPutObjectForTests(async () => 'ok');
    const api = installFakeApi(road());
    await renderRedesign('/settings/documents');
    fireEvent.click(await screen.findByRole('button', { name: 'Upload new version: food safety certificate' }));
    const sheet = await screen.findByTestId('doc-shell');
    expect(within(sheet).getByRole('heading', { name: 'Upload food safety certificate' })).toBeTruthy();
    choose();
    fireEvent.change(await screen.findByLabelText('Valid until'), { target: { value: '2099-03-14' } });
    fireEvent.click(screen.getByRole('button', { name: /Save document/ }));
    await waitFor(() => expect(api.callsTo('POST /v1/restaurant/documents/submit')).toHaveLength(1));
    const attach = await api.callsTo('POST /v1/restaurant/documents')[0]!.json();
    expect(attach).toMatchObject({ doc_type: 'FOOD_SAFETY', valid_until: '2099-03-14', stored_object_id: fixture('stored_object_ready').id });
    await waitFor(() => expect(screen.queryByTestId('doc-shell')).toBeNull());
    expect(await screen.findByText('Food safety certificate sent for review')).toBeTruthy();
  });

  it('asks before it cancels an upload in flight, and keeps uploading when told to', async () => {
    setPutObjectForTests(() => new Promise(() => undefined));
    installFakeApi(road());
    await renderRedesign('/settings/documents');
    fireEvent.click(await screen.findByRole('button', { name: 'Upload new version: business licence' }));
    await screen.findByTestId('doc-shell');
    choose('business-licence.pdf');
    fireEvent.click(await screen.findByRole('button', { name: /^Cancel upload of/ }));
    const ask = await screen.findByTestId('renew-cancel-confirm');
    expect(within(ask).getByText('Cancel this upload?')).toBeTruthy();
    expect(screen.getByTestId('upload-progress')).toBeTruthy();
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep uploading' }));
    expect(screen.queryByTestId('renew-cancel-confirm')).toBeNull();
    expect(screen.getByTestId('upload-progress')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Cancel upload of/ }));
    fireEvent.click(within(await screen.findByTestId('renew-cancel-confirm')).getByRole('button', { name: 'Cancel upload' }));
    await waitFor(() => expect(screen.queryByTestId('upload-progress')).toBeNull());
  });

  it('says a renewal is too early when the server turns it away, with the date, and keeps the details', async () => {
    setPutObjectForTests(async () => 'ok');
    const profile = fixture('restaurant_profile_halal_certified');
    profile.halal.expires_on = '2099-11-12';
    const api = installFakeApi(road({ 'GET /v1/restaurant/profile': { body: profile }, 'POST /v1/restaurant/documents': { status: 409, body: errorBody('STEP_NOT_AVAILABLE') } }));
    await renderRedesign('/settings/halal?panel=renew');
    await screen.findByTestId('renew-panel');
    choose('halal-certificate-2099.pdf');
    fireEvent.change(await screen.findByLabelText('Issuing body'), { target: { value: 'HMA Canada' } });
    fireEvent.change(screen.getByLabelText('Valid until'), { target: { value: '2100-11-12' } });
    fireEvent.click(screen.getByRole('button', { name: /Save document/ }));
    const note = await screen.findByTestId('renew-too-early');
    expect(note.textContent).toContain('HalalGoes can’t take a renewal yet');
    expect(note.textContent).toContain('You can upload it from 13 September 2099, 60 days before your current certificate expires on 12 November 2099.');
    expect(screen.queryByTestId('renew-refused')).toBeNull();
    expect((screen.getByLabelText('Valid until') as HTMLInputElement).value).toBe('2100-11-12');
    expect(api.callsTo('POST /v1/restaurant/documents/submit')).toHaveLength(0);
  });
});
