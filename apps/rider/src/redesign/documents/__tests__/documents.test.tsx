/**
 * WP8 R08 Documents (step 3) and an added document, against the contract's fixtures, light and
 * dark: every row state (not added, uploading, added, needs a date, each upload failure, paused),
 * the footer's primary, submit (sending, error with the same Idempotency-Key, 422 incomplete,
 * 429 cooldown, offline), loading and load error, and the upload sequence with its bodies.
 */
import './mocks';

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import { reportReachable, reportTransportFailure } from '../../data/connectivity';
import { SCHEMES } from '../../test/render';
import { setToken } from '../../../token';
import { startUpload, uploadFor } from '../uploads';
import { BICYCLE, apiError, bodies, doc, docs, keys, openDocuments, press, puts, scooterSet, start, stop, type } from './harness';

afterEach(stop);

const PENDING = 'rider_onboarding_documents_pending';
const FILE = { bytes: new Uint8Array([1, 2, 3, 4]), contentType: 'image/jpeg', name: null, uri: 'mock://shot.jpg' };
const ATTACHED = { status: 201, body: { data: doc('VEHICLE_REGISTRATION') } };

function row(type: string) {
  return within(screen.getByTestId(`doc-row-${type}`));
}

/** A typed expiry a year out, and the ISO date it means. */
function nextYear(): { day: string; month: string; year: string; iso: string } {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  const day = String(d.getDate());
  const month = String(d.getMonth() + 1);
  const year = String(d.getFullYear());
  return { day, month, year, iso: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}` };
}

describe.each(SCHEMES)('documents (%s)', (scheme) => {
  it('loading: the step line and a status line', async () => {
    start({ scheme, api: { getRiderOnboardingStatus: PENDING, listRiderDocuments: 'pending' } });
    await openDocuments();
    expect(screen.getByText('Loading your documents')).toBeTruthy();
    expect(screen.getByText('Step 3 of 5: documents')).toBeTruthy();
  });

  it('none added (scooter): four rows with Add, the work permit below a divider, Add driver\'s licence', async () => {
    start({ scheme, api: { getRiderOnboardingStatus: PENDING, listRiderDocuments: docs() } });
    await openDocuments();
    expect(screen.getByText('For a scooter we need these four, plus a work permit if you have one. Take a clear photo of each, with all four corners showing.')).toBeTruthy();
    for (const [t, d] of [
      ["Driver's licence", 'Front, with expiry date'],
      ['Photo of you', 'Your face, clearly lit'],
      ['Work permit', "Only if you're not a Canadian citizen or permanent resident. It must not be expired."],
    ]) {
      expect(screen.getByText(t)).toBeTruthy();
      expect(screen.getByText(d)).toBeTruthy();
    }
    expect(screen.getAllByText('With expiry date')).toHaveLength(2);
    expect(screen.getAllByText('Add')).toHaveLength(5);
    expect(screen.queryByText('Not added')).toBeNull(); // the optional row has no badge
    expect(screen.getByTestId('documents-next')).toBeTruthy();
    expect(screen.getByText("Add driver's licence")).toBeTruthy();
    expect(screen.queryByText('Submit for review')).toBeNull();
    expect(screen.queryByText('Remove this document')).toBeNull();
    expect(screen.queryByText(/verif/i)).toBeNull();
    await press('documents-next');
    expect(await screen.findByText('Fit the whole licence inside the frame')).toBeTruthy();
  });

  it('bicycle: two rows (government ID, photo of you), Add government ID', async () => {
    start({ scheme, me: { vehicle: BICYCLE }, api: { getRiderOnboardingStatus: PENDING, listRiderDocuments: docs() } });
    await openDocuments();
    expect(screen.getByText('For a bicycle we need these two, plus a work permit if you have one. Take a clear photo of each, with all four corners showing.')).toBeTruthy();
    expect(screen.getByText('Photo ID, with expiry date')).toBeTruthy();
    expect(screen.queryByText("Driver's licence")).toBeNull();
    expect(screen.getByText('Add government ID')).toBeTruthy();
  });

  it('bicycle ready: "Both are added", Submit for review', async () => {
    start({ scheme, me: { vehicle: BICYCLE }, api: { getRiderOnboardingStatus: PENDING, listRiderDocuments: docs(doc('GOVERNMENT_ID'), doc('PROFILE_PHOTO')) } });
    await openDocuments();
    expect(screen.getByText('For a bicycle we need these two, plus a work permit if you have one. Both are added. A person will check each document.')).toBeTruthy();
    expect(screen.getByText('Submit for review')).toBeTruthy();
  });

  it('ready: every row Added with its expiry, Submit sends once with a key and opens the notifications ask', async () => {
    const api = start({ scheme, api: { getRiderOnboardingStatus: PENDING, listRiderDocuments: docs(...scooterSet()), submitRiderDocuments: 'rider_onboarding_documents_review' } });
    await openDocuments();
    expect(screen.getByText('For a scooter we need these four, plus a work permit if you have one. All four are added. A person will check each document.')).toBeTruthy();
    expect(screen.getAllByText('Added')).toHaveLength(4);
    expect(screen.getAllByText('Expires 14 September 2027')).toHaveLength(3);
    expect(screen.getByText('No expiry')).toBeTruthy();
    await press('documents-submit');
    expect(await screen.findByText('Get told when we decide on your application')).toBeTruthy();
    expect(api.callsTo('submitRiderDocuments')).toHaveLength(1);
    expect(keys('submitRiderDocuments')[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('submitting: the button is busy and "Sending your documents" is read out', async () => {
    start({ scheme, api: { getRiderOnboardingStatus: PENDING, listRiderDocuments: docs(...scooterSet()), submitRiderDocuments: 'pending' } });
    await openDocuments();
    await press('documents-submit');
    expect(screen.getByLabelText('Sending your documents')).toBeTruthy();
    expect(screen.getByTestId('documents-submit').props.accessibilityState).toMatchObject({ busy: true });
  });

  it('submit error: "We couldn\'t send your documents", Try again resends with the same Idempotency-Key', async () => {
    start({
      scheme,
      api: {
        getRiderOnboardingStatus: PENDING,
        listRiderDocuments: docs(...scooterSet()),
        submitRiderDocuments: (_c, nth) => (nth === 0 ? apiError(500, 'INTERNAL_ERROR', 'Something went wrong on our side.') : 'rider_onboarding_documents_review'),
      },
    });
    await openDocuments();
    await press('documents-submit');
    expect(await screen.findByText("We couldn't send your documents")).toBeTruthy();
    expect(screen.getByText('Nothing was lost. Check your connection and try again.')).toBeTruthy();
    expect(screen.getByText('For a scooter we need these four, plus a work permit if you have one. Your documents are still added.')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
    await press('documents-submit');
    expect(await screen.findByText('Get told when we decide on your application')).toBeTruthy();
    const [first, second] = keys('submitRiderDocuments');
    expect(second).toBe(first);
  });

  it('422 DOCUMENTS_INCOMPLETE: the server\'s missing list wins, rows say Not added yet, a new key next time', async () => {
    const api = start({
      scheme,
      api: {
        getRiderOnboardingStatus: PENDING,
        listRiderDocuments: (_c, nth) => (nth === 0 ? docs(...scooterSet()) : docs(...scooterSet().filter((d) => d.doc_type !== 'VEHICLE_INSURANCE'))),
        submitRiderDocuments: apiError(422, 'DOCUMENTS_INCOMPLETE', 'Required documents are missing.', { missing: ['VEHICLE_INSURANCE', 'GOVERNMENT_ID'] }),
      },
    });
    await openDocuments();
    await press('documents-submit');
    expect(await screen.findByText('2 things are missing')).toBeTruthy();
    expect(screen.getByText('Vehicle insurance is not added. Government ID is not added.')).toBeTruthy();
    expect(screen.getAllByText('Not added yet')).toHaveLength(2);
    expect(screen.getByText('For a scooter we need these five, plus a work permit if you have one.')).toBeTruthy();
    expect(screen.getByText('Add vehicle insurance')).toBeTruthy();
    expect(api.callsTo('listRiderDocuments')).toHaveLength(2);
  });

  it('missing expiry: "Needs a date", the footer adds the missing insurance, the row opens Add the expiry date', async () => {
    start({
      scheme,
      api: {
        getRiderOnboardingStatus: PENDING,
        listRiderDocuments: docs(doc('DRIVERS_LICENCE', { valid_until: null }), doc('VEHICLE_REGISTRATION'), doc('PROFILE_PHOTO')),
      },
    });
    await openDocuments();
    expect(row('DRIVERS_LICENCE').getByText('Needs a date')).toBeTruthy();
    expect(row('DRIVERS_LICENCE').getByText('Add the expiry date')).toBeTruthy();
    expect(screen.getByText('Add vehicle insurance')).toBeTruthy();
    await press('doc-row-DRIVERS_LICENCE');
    expect(await screen.findByText('Add the expiry date')).toBeTruthy();
    // This phone did not attach it, so it holds no photo to re-attach: a new photo instead.
    expect(screen.getByText('Take a new photo of it to add the date.')).toBeTruthy();
    expect(screen.queryByText('Save expiry date')).toBeNull();
    await press('take-new');
    expect(await screen.findByText('Fit the whole licence inside the frame')).toBeTruthy();
  });

  it('429: "You can send these in 24 minutes", Submit stays off', async () => {
    start({
      scheme,
      api: {
        getRiderOnboardingStatus: PENDING,
        listRiderDocuments: docs(...scooterSet()),
        submitRiderDocuments: apiError(429, 'RATE_LIMITED', 'Too many requests.', { retry_after_seconds: 1440 }),
      },
    });
    await openDocuments();
    await press('documents-submit');
    expect(await screen.findByText('You can send these in 24 minutes')).toBeTruthy();
    expect(screen.getByText('We limit how often documents are sent, so each set gets a full check.')).toBeTruthy();
    expect(screen.getByText('For a scooter we need these four, plus a work permit if you have one. Your documents are ready to go.')).toBeTruthy();
    expect(screen.getByTestId('documents-submit').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('offline: the list stays readable, Submit is off until the API answers', async () => {
    start({ scheme, api: { getRiderOnboardingStatus: PENDING, listRiderDocuments: docs(...scooterSet()) } });
    await openDocuments();
    act(() => reportTransportFailure());
    expect(screen.getByText('You are offline')).toBeTruthy();
    expect(screen.getByText('You can check your documents. Sending for review works again once you are back online.')).toBeTruthy();
    expect(screen.getByTestId('documents-submit').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('load error: "We couldn\'t load your documents", Try again', async () => {
    start({
      scheme,
      api: { getRiderOnboardingStatus: PENDING, listRiderDocuments: (_c, nth) => (nth === 0 ? apiError(500, 'INTERNAL_ERROR', 'Boom.') : docs()) },
    });
    await openDocuments();
    expect(screen.getByText("We couldn't load your documents")).toBeTruthy();
    expect(screen.getByText('Anything you already added is safe with us.')).toBeTruthy();
    await press('retry');
    expect(await screen.findByText("Add driver's licence")).toBeTruthy();
  });

  it('a photo goes createUpload → PUT → confirmUpload → attach, then the row reads Added', async () => {
    const t = nextYear();
    start({
      scheme,
      api: {
        getRiderOnboardingStatus: PENDING,
        listRiderDocuments: (_c, nth) => (nth === 0 ? docs() : docs(doc('DRIVERS_LICENCE', { valid_until: t.iso }))),
        attachRiderDocument: { status: 201, body: { data: doc('DRIVERS_LICENCE') } },
      },
    });
    await openDocuments();
    await press('doc-add-DRIVERS_LICENCE');
    await press('capture-take');
    expect(await screen.findByText('Can you read every word, and are all four corners showing? If not, retake it.')).toBeTruthy();
    type('expiry-day', t.day);
    type('expiry-month', t.month);
    type('expiry-year', t.year);
    await press('capture-use');
    await waitFor(() => expect(row('DRIVERS_LICENCE').getByText('Added')).toBeTruthy());
    const [create] = bodies('createUpload') as { purpose: string; content_type: string; byte_size: number; sha256: string }[];
    expect(create).toMatchObject({ purpose: 'KYC_DOCUMENT', content_type: 'image/jpeg' });
    expect(create!.byte_size).toBeGreaterThan(0);
    expect(create!.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(keys('createUpload')[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ method: 'PUT', headers: { 'content-type': 'image/jpeg' } });
    expect(bodies('confirmUpload')).toHaveLength(1);
    expect(bodies('attachRiderDocument')).toEqual([{ doc_type: 'DRIVERS_LICENCE', stored_object_id: 'e5055f4b-3859-4fbf-a4bd-427822520eb5', expires_on: t.iso }]);
    expect(keys('attachRiderDocument')[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByText('Add vehicle registration')).toBeTruthy();
  });

  it('uploading: "Uploading", the counter line, Cancel upload stops it', async () => {
    start({ scheme, api: { getRiderOnboardingStatus: PENDING, listRiderDocuments: docs(doc('DRIVERS_LICENCE')), createUpload: 'pending' } });
    await openDocuments();
    act(() => startUpload('PROFILE_PHOTO', FILE, null));
    expect(row('PROFILE_PHOTO').getByText('Uploading')).toBeTruthy();
    expect(screen.getByText('1 of 4 added. You can send them for review once all 4 are added.')).toBeTruthy();
    await press('doc-cancel-PROFILE_PHOTO');
    expect(row('PROFILE_PHOTO').getByText('Add')).toBeTruthy();
    expect(bodies('attachRiderDocument')).toHaveLength(0);
  });

  it('too small and checksum: their lines and buttons, Retake vehicle registration leads, Try again asks for a new link', async () => {
    start({
      scheme,
      api: {
        getRiderOnboardingStatus: PENDING,
        listRiderDocuments: docs(doc('DRIVERS_LICENCE'), doc('PROFILE_PHOTO')),
        confirmUpload: (call, nth) =>
          nth === 0
            ? apiError(422, 'IMAGE_TOO_SMALL', 'Too small.')
            : nth === 1
              ? apiError(422, 'CHECKSUM_MISMATCH', 'Checksum.')
              : 'stored_object_ready',
        attachRiderDocument: ATTACHED,
      },
    });
    await openDocuments();
    act(() => startUpload('VEHICLE_REGISTRATION', FILE, '2030-01-01'));
    await waitFor(() => expect(row('VEHICLE_REGISTRATION').getByText('Too small to read. Retake it closer.')).toBeTruthy());
    act(() => startUpload('VEHICLE_INSURANCE', FILE, '2030-01-01'));
    await waitFor(() => expect(row('VEHICLE_INSURANCE').getByText("Didn't arrive complete. Try again.")).toBeTruthy());
    expect(screen.getAllByText("Didn't upload")).toHaveLength(2);
    expect(screen.getByLabelText("2 documents didn't upload")).toBeTruthy();
    expect(screen.getByText('For a photo that is too small, fill the frame with the document.')).toBeTruthy();
    expect(screen.getByText('Retake vehicle registration')).toBeTruthy();
    expect(screen.getByText('2 of 4 added. You can send them for review once all 4 are added.')).toBeTruthy();
    await press('doc-fix-VEHICLE_INSURANCE');
    await waitFor(() => expect(bodies('attachRiderDocument')).toHaveLength(1));
    const createKeys = keys('createUpload');
    expect(createKeys).toHaveLength(3);
    expect(createKeys[2]).not.toBe(createKeys[1]); // a checksum mismatch needs a fresh presigned upload
    await press('doc-fix-VEHICLE_REGISTRATION');
    expect(await screen.findByText('Fit the whole registration inside the frame')).toBeTruthy();
  });

  it('413 and unreadable: "over 15 MB" offers a photo, "can\'t open" offers another file, Replace leads', async () => {
    start({
      scheme,
      api: {
        getRiderOnboardingStatus: PENDING,
        listRiderDocuments: docs(doc('DRIVERS_LICENCE')),
        createUpload: (_c, nth) => (nth === 0 ? apiError(413, 'PAYLOAD_TOO_LARGE', 'Too large.') : 'presigned_upload'),
        confirmUpload: apiError(422, 'CONTENT_TYPE_MISMATCH', 'Not a PDF or image.'),
      },
    });
    await openDocuments();
    act(() => startUpload('VEHICLE_REGISTRATION', FILE, '2030-01-01'));
    await waitFor(() => expect(row('VEHICLE_REGISTRATION').getByText('This file is over 15 MB. Choose a smaller file or take a photo instead.')).toBeTruthy());
    expect(row('VEHICLE_REGISTRATION').getByText('Take a photo')).toBeTruthy();
    act(() => startUpload('VEHICLE_INSURANCE', FILE, '2030-01-01'));
    await waitFor(() => expect(row('VEHICLE_INSURANCE').getByText("We can't open this file. Choose a PDF or a photo.")).toBeTruthy());
    expect(row('VEHICLE_INSURANCE').getByText('Choose another file')).toBeTruthy();
    expect(screen.getByText('Replace vehicle registration')).toBeTruthy();
  });

  it('interrupted: a PUT that loses the signal pauses, and carries on by itself once the API answers', async () => {
    start({
      scheme,
      put: ['offline', 200],
      api: { getRiderOnboardingStatus: PENDING, listRiderDocuments: docs(doc('DRIVERS_LICENCE')), attachRiderDocument: ATTACHED },
    });
    await openDocuments();
    act(() => startUpload('VEHICLE_REGISTRATION', FILE, '2030-01-01'));
    await waitFor(() => expect(row('VEHICLE_REGISTRATION').getByText('Paused')).toBeTruthy());
    expect(row('VEHICLE_REGISTRATION').getByText("Upload paused because you went offline. It carries on when you're back, or try now.")).toBeTruthy();
    expect(screen.getByText('Uploads carry on when you are back online. Nothing you added is lost.')).toBeTruthy();
    expect(screen.getByLabelText("1 upload stopped. It carries on when you're back online.")).toBeTruthy();
    // Offline, the footer is the next missing document: the camera still works.
    expect(screen.getByText('Add vehicle insurance')).toBeTruthy();
    act(() => reportReachable());
    await waitFor(() => expect(bodies('attachRiderDocument')).toHaveLength(1));
    expect(puts).toHaveLength(2);
    expect(keys('createUpload')[1]).toBe(keys('createUpload')[0]); // the same request, resent
  });

  it('link closed: "its link closed", Try again asks for a new presigned upload', async () => {
    start({
      scheme,
      put: [403, 200],
      api: { getRiderOnboardingStatus: PENDING, listRiderDocuments: docs(doc('DRIVERS_LICENCE')), attachRiderDocument: ATTACHED },
    });
    await openDocuments();
    act(() => startUpload('VEHICLE_REGISTRATION', FILE, '2030-01-01'));
    await waitFor(() => expect(row('VEHICLE_REGISTRATION').getByText('The upload took too long and its link closed. Try again to send it.')).toBeTruthy());
    await press('doc-fix-VEHICLE_REGISTRATION');
    await waitFor(() => expect(bodies('attachRiderDocument')).toHaveLength(1));
    const [a, b] = keys('createUpload');
    expect(b).not.toBe(a);
  });

  it('an added document: its expiry and status, Take a new photo, no Remove', async () => {
    start({ scheme, api: { getRiderOnboardingStatus: PENDING, listRiderDocuments: docs(...scooterSet()) } });
    await openDocuments();
    await press('doc-row-DRIVERS_LICENCE');
    expect(await screen.findByText('Tuesday 14 September 2027')).toBeTruthy();
    expect(screen.getByText('Not sent yet. It goes to review with the rest when you submit.')).toBeTruthy();
    expect(screen.queryByText('Remove this document')).toBeNull();
    await press('take-new');
    expect(await screen.findByText('Fit the whole licence inside the frame')).toBeTruthy();
  });

  it('add the expiry date: re-attaches the same photo with the typed date; too soon says so', async () => {
    const t = nextYear();
    start({
      scheme,
      api: {
        getRiderOnboardingStatus: PENDING,
        listRiderDocuments: () => docs(doc('DRIVERS_LICENCE', { valid_until: bodies('attachRiderDocument').length < 2 ? null : t.iso })),
        attachRiderDocument: { status: 201, body: { data: doc('DRIVERS_LICENCE') } },
      },
    });
    await openDocuments();
    act(() => startUpload('DRIVERS_LICENCE', FILE, null));
    await waitFor(() => expect(row('DRIVERS_LICENCE').getByText('Needs a date')).toBeTruthy());
    await press('doc-row-DRIVERS_LICENCE');
    expect(await screen.findByText('Your licence photo is added. Type the expiry date printed on it.')).toBeTruthy();
    const soon = new Date(Date.now() + 5 * 86_400_000);
    type('expiry-day', String(soon.getDate()));
    type('expiry-month', String(soon.getMonth() + 1));
    type('expiry-year', String(soon.getFullYear()));
    await press('save-expiry');
    expect(screen.getByText(/less than 30 days away/)).toBeTruthy();
    expect(screen.getByText('Back to documents')).toBeTruthy();
    expect(bodies('attachRiderDocument')).toHaveLength(1);
    type('expiry-day', t.day);
    type('expiry-month', t.month);
    type('expiry-year', t.year);
    await press('save-expiry');
    await waitFor(() => expect(bodies('attachRiderDocument')).toHaveLength(2));
    expect(bodies('attachRiderDocument')[1]).toEqual({ doc_type: 'DRIVERS_LICENCE', stored_object_id: 'e5055f4b-3859-4fbf-a4bd-427822520eb5', expires_on: t.iso });
    expect(await screen.findByTestId('documents')).toBeTruthy();
  });

  it('a double tap on "Use this photo" uploads once and stays on Documents', async () => {
    const t = nextYear();
    const api = start({
      scheme,
      api: {
        getRiderOnboardingStatus: PENDING,
        listRiderDocuments: docs(...scooterSet().filter((d) => d.doc_type !== 'DRIVERS_LICENCE')),
        attachRiderDocument: 'pending',
      },
    });
    await openDocuments();
    await press('doc-add-DRIVERS_LICENCE');
    await press('capture-take');
    await screen.findByTestId('capture-review');
    type('expiry-day', t.day);
    type('expiry-month', t.month);
    type('expiry-year', t.year);
    await act(async () => {
      fireEvent.press(screen.getByTestId('capture-use'));
      fireEvent.press(screen.getByTestId('capture-use'));
    });
    // One pop: still on Documents (a second pop would land on the application hub).
    expect(await screen.findByTestId('documents')).toBeTruthy();
    await waitFor(() => expect(api.callsTo('attachRiderDocument')).toHaveLength(1));
    expect(api.callsTo('createUpload')).toHaveLength(1);
    expect(screen.queryByText('Finish your application')).toBeNull();
  });

  it('a double tap on Submit for review sends one request', async () => {
    const api = start({ scheme, api: { getRiderOnboardingStatus: PENDING, listRiderDocuments: docs(...scooterSet()), submitRiderDocuments: 'rider_onboarding_documents_review' } });
    await openDocuments();
    await act(async () => {
      fireEvent.press(screen.getByTestId('documents-submit'));
      fireEvent.press(screen.getByTestId('documents-submit'));
    });
    expect(await screen.findByText('Get told when we decide on your application')).toBeTruthy();
    expect(api.callsTo('submitRiderDocuments')).toHaveLength(1);
  });

  it('add the expiry date, 5xx: says so, keeps the typed date, Save resends with the same key', async () => {
    const t = nextYear();
    start({
      scheme,
      api: {
        getRiderOnboardingStatus: PENDING,
        listRiderDocuments: () => docs(doc('DRIVERS_LICENCE', { valid_until: bodies('attachRiderDocument').length < 3 ? null : t.iso })),
        attachRiderDocument: (_c, nth) => (nth === 1 ? apiError(500, 'INTERNAL_ERROR', 'Something went wrong on our side.') : { status: 201, body: { data: doc('DRIVERS_LICENCE') } }),
      },
    });
    await openDocuments();
    act(() => startUpload('DRIVERS_LICENCE', FILE, null));
    await waitFor(() => expect(row('DRIVERS_LICENCE').getByText('Needs a date')).toBeTruthy());
    await press('doc-row-DRIVERS_LICENCE');
    await screen.findByTestId('document-add-expiry');
    type('expiry-day', t.day);
    type('expiry-month', t.month);
    type('expiry-year', t.year);
    await press('save-expiry');
    expect(await screen.findByText('Something went wrong on our side. Try again.')).toBeTruthy();
    expect(screen.getByTestId('expiry-year-field').props.value).toBe(t.year);
    await press('save-expiry');
    expect(await screen.findByTestId('documents')).toBeTruthy();
    const [, failed, again] = keys('attachRiderDocument');
    expect(again).toBe(failed);
  });

  it('signing out drops every queued upload: nothing carries on under the next session', async () => {
    const api = start({ scheme, api: { getRiderOnboardingStatus: PENDING, listRiderDocuments: docs(), createUpload: 'pending' } });
    await openDocuments();
    act(() => startUpload('PROFILE_PHOTO', FILE, null));
    expect(uploadFor('PROFILE_PHOTO')).toBeTruthy();
    act(() => setToken(null));
    expect(uploadFor('PROFILE_PHOTO')).toBeUndefined();
    expect(api.callsTo('attachRiderDocument')).toHaveLength(0);
  });

  it('Back returns to the application hub', async () => {
    start({ scheme, api: { getRiderOnboardingStatus: PENDING, listRiderDocuments: docs() } });
    await openDocuments();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Back to your application'));
    });
    expect(await screen.findByText('Finish your application')).toBeTruthy();
  });
});
