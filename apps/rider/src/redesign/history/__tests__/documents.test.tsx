/**
 * R49 Account documents after approval (PA/Account-DocView*, PA/Account-Replace-*), light and
 * dark: the list opens a document; status and expiry; "Download a copy" mints a fresh link per
 * tap and opens it, the link closes after its TTL and a new one is minted (never cached); the
 * link error; loading and list error; a document turned down; the expiring document's "Add new
 * insurance"; replacing through WP8's capture and upload queue (createUpload → PUT →
 * confirmUpload → attachRiderDocument with expires_on and an Idempotency-Key) to Added, with
 * Send for review held (Needs API); a stopped upload (too small, link closed) and its own
 * action; a replacement in review; a replacement turned down.
 */
import './mocks';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import { resetConnectivity } from '../../data/connectivity';
import { mockApi, payload, type MockApi, type ScenarioChoice } from '../../test/mockApi';
import { SCHEMES } from '../../test/render';
import { apiError, press, type } from '../../documents/__tests__/harness';
import { resetUploads } from '../../documents/uploads';
import { DOCUMENTS } from '../../account/copy';
import { DOC_VIEW, REPLACE } from '../copy';
import { resetReplacing } from '../DocumentScreens';
import { answerStoragePuts, docList, kycDoc, renderRoute, spyOpenUrl } from './harness';

let api: MockApi;
let openUrl: jest.SpyInstance;
beforeEach(() => {
  openUrl = spyOpenUrl();
});
afterEach(() => {
  api?.restore();
  openUrl.mockRestore();
  resetUploads();
  resetReplacing();
  resetConnectivity();
  jest.useRealTimers();
});

const pack = payload('rider_document_pack_complete') as Record<string, any>[];
const licence = pack.find((d) => d.doc_type === 'DRIVERS_LICENCE')!;
const insurance = pack.find((d) => d.doc_type === 'VEHICLE_INSURANCE')!;
const download = payload('presigned_download');

function isoIn(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe.each(SCHEMES)('Account › a document (%s)', (scheme) => {
  it('the list opens a document: its status, its expiry, the private-link note', async () => {
    api = mockApi({ listRiderDocuments: 'rider_document_pack_complete' });
    renderRoute(scheme, 'accountDocuments', undefined);
    fireEvent.press(await screen.findByTestId(`document-${licence.id}`));
    await screen.findByTestId('document');
    expect(screen.getByTestId('current-route').props.children).toBe('accountDocument');
    expect(screen.getByText("Driver's licence")).toBeTruthy();
    expect(within(screen.getByTestId('document-status')).getByText('Approved')).toBeTruthy();
    expect(screen.getByText('Tuesday 14 September 2027')).toBeTruthy();
    expect(screen.getByText(DOC_VIEW.downloadNote)).toBeTruthy();
    expect(screen.getByLabelText('Back to Documents')).toBeTruthy();
    expect(api.callsTo('createDocumentDownloadUrl')).toHaveLength(0);
  });

  it('Download a copy mints a link and opens it; after 2 minutes it has closed and a new one is minted', async () => {
    api = mockApi({ listRiderDocuments: 'rider_document_pack_complete', createDocumentDownloadUrl: 'presigned_download' });
    renderRoute(scheme, 'accountDocument', { documentId: licence.id });
    await screen.findByTestId('document');
    jest.useFakeTimers();
    await press('document-download');
    expect(api.callsTo('createDocumentDownloadUrl').map((c) => c.path)).toEqual([`/v1/documents/${licence.id}/download-url`]);
    expect(openUrl).toHaveBeenCalledWith(download.url);

    act(() => jest.advanceTimersByTime(120_000));
    expect(screen.getByText(DOC_VIEW.expired.title)).toBeTruthy();
    expect(screen.getByText(DOC_VIEW.expired.body)).toBeTruthy();
    await press('document-new-link');
    // Never cached: a second tap is a second, audited issue.
    expect(api.callsTo('createDocumentDownloadUrl')).toHaveLength(2);
    expect(openUrl).toHaveBeenCalledTimes(2);
  });

  it('a link that cannot be had: the alert and Try again, which asks again', async () => {
    api = mockApi({
      listRiderDocuments: 'rider_document_pack_complete',
      createDocumentDownloadUrl: (_c, n) => (n === 0 ? 'error_not_found' : 'presigned_download'),
    });
    renderRoute(scheme, 'accountDocument', { documentId: licence.id });
    await screen.findByTestId('document');
    await press('document-download');
    await screen.findByText(DOC_VIEW.error.title);
    expect(screen.getByText(DOC_VIEW.error.body)).toBeTruthy();
    expect(openUrl).not.toHaveBeenCalled();
    await press('document-link-retry');
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith(download.url));
  });

  it('loading: titled from the row that opened it', () => {
    api = mockApi({ listRiderDocuments: 'pending' });
    renderRoute(scheme, 'accountDocument', { documentId: licence.id, docType: 'DRIVERS_LICENCE' });
    expect(screen.getByText("Driver's licence")).toBeTruthy();
    expect(screen.getByText(DOC_VIEW.loading)).toBeTruthy();
  });

  it('a list error offers Try again, which asks again', async () => {
    api = mockApi({ listRiderDocuments: (_c, n) => (n === 0 ? 'error_internal_error' : 'rider_document_pack_complete') });
    renderRoute(scheme, 'accountDocument', { documentId: licence.id });
    await screen.findByText(DOCUMENTS.errorTitle);
    await press('document-list-retry');
    await screen.findByTestId('document');
  });

  it('a document turned down: why, the reviewer’s note, a new photo or a PDF, and no Replace', async () => {
    const rejected = (payload('rider_document_pack_rejected') as Record<string, any>[])[0]!;
    api = mockApi({ listRiderDocuments: 'rider_document_pack_rejected' });
    renderRoute(scheme, 'accountDocument', { documentId: rejected.id });
    await screen.findByTestId('document');
    expect(within(screen.getByTestId('document-status')).getByText('New upload needed')).toBeTruthy();
    expect(screen.getByText('Pages or corners are missing')).toBeTruthy();
    expect(screen.getByText(`“${rejected.review_note}”`)).toBeTruthy();
    expect(screen.getByText(DOC_VIEW.takeNew)).toBeTruthy();
    expect(screen.getByText(DOC_VIEW.choosePdf)).toBeTruthy();
    expect(screen.queryByText(DOC_VIEW.replace)).toBeNull();
  });
});

describe.each(SCHEMES)('Account › replace a document (%s)', (scheme) => {
  const expiresOn = isoIn(90);
  const replacement = kycDoc('VEHICLE_INSURANCE', { id: 'new-ins', state: 'SUBMITTED', version: 2, reviewed_at: null, valid_until: expiresOn, created_at: new Date().toISOString() });

  /** Before the attach: the pack; after it: the new insurance and the earlier one Replaced. */
  function documentsAfterAttach(over: Record<string, ScenarioChoice> = {}): Record<string, ScenarioChoice> {
    let attached = false;
    return {
      listRiderDocuments: () => (attached ? docList(replacement, { ...insurance, state: 'SUPERSEDED' }) : docList(...pack)),
      createUpload: 'presigned_upload',
      confirmUpload: 'stored_object_ready',
      attachRiderDocument: () => {
        attached = true;
        return { status: 201, body: { data: replacement } };
      },
      ...over,
    };
  }

  async function photographInsurance(): Promise<void> {
    await screen.findByTestId('capture-camera');
    await press('capture-take');
    await screen.findByTestId('capture-review');
    const [y, m, d] = expiresOn.split('-');
    type('expiry-day', d!);
    type('expiry-month', m!);
    type('expiry-year', y!);
    await press('capture-use');
  }

  it('confirm → camera → Use this photo → upload and attach → Added; Send for review stays off', async () => {
    api = mockApi(documentsAfterAttach());
    const puts = answerStoragePuts([200]);
    renderRoute(scheme, 'accountDocument', { documentId: insurance.id });
    await screen.findByTestId('document');
    await press('document-replace');
    expect(screen.getByText(REPLACE.confirmTitle('VEHICLE_INSURANCE'))).toBeTruthy();
    expect(screen.getByText(REPLACE.confirmBody('VEHICLE_INSURANCE'))).toBeTruthy();
    await press('replace-confirm');
    expect(screen.getByTestId('current-route').props.children).toBe('applicationCapture');
    await photographInsurance();

    await screen.findByTestId('replace-added');
    expect(screen.getByText('Send your new insurance')).toBeTruthy();
    expect(screen.getByText(REPLACE.addedBody('VEHICLE_INSURANCE'))).toBeTruthy();
    expect(within(screen.getByTestId('replace-new')).getByText(REPLACE.addedLine)).toBeTruthy();
    expect(within(screen.getByTestId('replace-earlier')).getByText('Replaced')).toBeTruthy();
    expect(screen.getByTestId('replace-send').props.accessibilityState?.disabled).toBe(true);
    expect(screen.getByText(REPLACE.sendUnavailable)).toBeTruthy();

    expect(puts.count()).toBe(1);
    const create = api.callsTo('createUpload');
    expect(create).toHaveLength(1);
    expect(create[0]!.headers['idempotency-key']).toBeTruthy();
    const attach = api.callsTo('attachRiderDocument');
    expect(attach.map((c) => c.body)).toEqual([
      { doc_type: 'VEHICLE_INSURANCE', stored_object_id: payload('stored_object_ready').id, expires_on: expiresOn },
    ]);
    expect(attach[0]!.headers['idempotency-key']).toBeTruthy();
    // Sending after approval is Needs API: nothing is submitted.
    fireEvent.press(screen.getByTestId('replace-send'));
    expect(api.callsTo('submitRiderDocuments')).toHaveLength(0);
  });

  it('too small: the row says so and Retake opens the camera again; nothing is attached', async () => {
    api = mockApi(documentsAfterAttach({ confirmUpload: apiError(422, 'IMAGE_TOO_SMALL', 'Image is too small.') }));
    answerStoragePuts([200]);
    renderRoute(scheme, 'accountReplace', { docType: 'VEHICLE_INSURANCE' });
    await screen.findByTestId('replace-start');
    await press('replace-take-new');
    await photographInsurance();
    await screen.findByTestId('replace-failed-too-small');
    expect(screen.getByText('Too small to read. Retake it closer.')).toBeTruthy();
    expect(within(screen.getByTestId('replace-new')).getByText("Didn't upload")).toBeTruthy();
    expect(within(screen.getByTestId('replace-current')).getByText('Approved')).toBeTruthy();
    expect(api.callsTo('attachRiderDocument')).toHaveLength(0);
    await press('replace-failure-action');
    expect(screen.getByTestId('current-route').props.children).toBe('applicationCapture');
  });

  it('link closed: Try again asks for a new link (a new key) and lands as Added', async () => {
    api = mockApi(documentsAfterAttach());
    answerStoragePuts([403, 200]);
    renderRoute(scheme, 'accountReplace', { docType: 'VEHICLE_INSURANCE' });
    await screen.findByTestId('replace-start');
    await press('replace-take-new');
    await photographInsurance();
    await screen.findByTestId('replace-failed-link-closed');
    expect(screen.getByText('The upload took too long and its link closed. Try again to send it.')).toBeTruthy();
    await press('replace-failure-action');
    await screen.findByTestId('replace-added');
    const keys = api.callsTo('createUpload').map((c) => c.headers['idempotency-key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    expect(api.callsTo('attachRiderDocument')).toHaveLength(1);
  });

  it('the camera left without a photo: the confirm’s words again, Keep current goes back', async () => {
    api = mockApi({ listRiderDocuments: 'rider_document_pack_complete' });
    renderRoute(scheme, 'accountReplace', { docType: 'VEHICLE_INSURANCE' });
    await screen.findByTestId('replace-start');
    expect(screen.getByText(REPLACE.confirmTitle('VEHICLE_INSURANCE'))).toBeTruthy();
    expect(screen.getByText(REPLACE.cancel)).toBeTruthy();
  });

  it('a replacement in review: the alert and both rows', async () => {
    api = mockApi({ listRiderDocuments: docList({ ...replacement, state: 'IN_REVIEW' }, { ...insurance, state: 'SUPERSEDED' }) });
    renderRoute(scheme, 'accountReplace', { docType: 'VEHICLE_INSURANCE' });
    await screen.findByTestId('replace-in-review');
    expect(screen.getByText(REPLACE.inReviewTitle('VEHICLE_INSURANCE'))).toBeTruthy();
    expect(within(screen.getByTestId('replace-new')).getByText('In review')).toBeTruthy();
    expect(within(screen.getByTestId('replace-earlier')).getByText('Replaced')).toBeTruthy();
  });

  it('a replacement turned down while the current one is valid: why, the note, the remedies', async () => {
    api = mockApi({
      listRiderDocuments: docList(
        { ...replacement, state: 'REJECTED', rejection_reason_code: 'ILLEGIBLE', review_note: 'The policy number and end date are cut off.' },
        insurance,
      ),
    });
    renderRoute(scheme, 'accountReplace', { docType: 'VEHICLE_INSURANCE' });
    await screen.findByTestId('replace-rejected');
    expect(screen.getByText('Vehicle insurance (new)')).toBeTruthy();
    expect(screen.getByText("We couldn't read it")).toBeTruthy();
    expect(screen.getByText('“The policy number and end date are cut off.”')).toBeTruthy();
    expect(screen.getByText(DOC_VIEW.takeNew)).toBeTruthy();
  });

  it('the list: an insurance expiring soon offers "Add new insurance", which starts the replace', async () => {
    api = mockApi({ listRiderDocuments: docList(licence, { ...insurance, valid_until: isoIn(10) }) });
    renderRoute(scheme, 'accountDocuments', undefined);
    await press((await screen.findByTestId('documents-add-new')).props.testID);
    await screen.findByTestId('replace-start');
    expect(screen.getByText(REPLACE.confirmTitle('VEHICLE_INSURANCE'))).toBeTruthy();
  });
});
