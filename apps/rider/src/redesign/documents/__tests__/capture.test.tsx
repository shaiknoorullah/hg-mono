/**
 * WP8 R09 Document capture, light and dark: camera starting, live with the torch, review and the
 * typed expiry (invalid, too soon), the photo of you (front camera, no file, no expiry), camera
 * not allowed (with and without the file option), a chosen file (preview, over 15 MB,
 * unreadable), and the photo of you's stopped uploads (too small, interrupted).
 */
import './mocks';

import { Linking } from 'react-native';
import { act, screen, waitFor } from '@testing-library/react-native';

import * as capture from '../../../capture';
import { reportTransportFailure } from '../../data/connectivity';
import { SCHEMES } from '../../test/render';
import { apiError, bodies, camera, doc, docs, openDocuments, press, puts, start, stop, type } from './harness';

afterEach(() => {
  jest.restoreAllMocks();
  stop();
});

const PENDING = 'rider_onboarding_documents_pending';
const ATTACHED = { status: 201, body: { data: doc('PROFILE_PHOTO') } };

async function openCapture(scheme: 'light' | 'dark', docType: string, api: Record<string, unknown> = {}, put?: (number | 'offline')[]) {
  start({ scheme, put, api: { getRiderOnboardingStatus: PENDING, listRiderDocuments: docs(), attachRiderDocument: ATTACHED, ...(api as object) } });
  await openDocuments();
  await press(`doc-add-${docType}`);
}

function typeDate(d: Date): void {
  type('expiry-day', String(d.getDate()));
  type('expiry-month', String(d.getMonth() + 1));
  type('expiry-year', String(d.getFullYear()));
}

function pick(bytes: Uint8Array, contentType: string) {
  return jest.spyOn(capture, 'pickImage').mockResolvedValue({ ok: true, image: { bytes, contentType, sha256: () => '' } });
}

describe.each(SCHEMES)('capture (%s)', (scheme) => {
  it('starting: "Starting the camera", Take photo off, Choose a PDF instead', async () => {
    start({ scheme, api: { getRiderOnboardingStatus: PENDING, listRiderDocuments: docs() } });
    camera.permission = null; // start() grants it; the hook has not answered yet
    await openDocuments();
    await press('doc-add-DRIVERS_LICENCE');
    expect(screen.getByText('Starting the camera')).toBeTruthy();
    expect(screen.getByText('Lay it flat. Turn off the torch if you see glare.')).toBeTruthy();
    expect(screen.getByTestId('capture-take').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByText('Choose a PDF instead')).toBeTruthy();
  });

  it('camera: the licence frame, the torch Switch turns the torch on, Choose a file', async () => {
    await openCapture(scheme, 'DRIVERS_LICENCE');
    expect(await screen.findByText('Fit the whole licence inside the frame')).toBeTruthy();
    expect(screen.getByText("Driver's licence")).toBeTruthy();
    expect(screen.getByTestId('camera-back')).toBeTruthy();
    expect(screen.getByText('Choose a file (PDF or photo)')).toBeTruthy();
    await press('capture-torch');
    expect(screen.getByTestId('camera-back-torch')).toBeTruthy();
  });

  it('review: an expiry that is not a real date is refused; too soon makes Back to documents the primary', async () => {
    await openCapture(scheme, 'DRIVERS_LICENCE');
    await press('capture-take');
    expect(await screen.findByText('Use this photo')).toBeTruthy();
    expect(screen.getByText('Expiry date on the licence')).toBeTruthy();
    expect(screen.getByText('As printed on the licence. Must be at least 30 days from today.')).toBeTruthy();
    type('expiry-day', '31');
    type('expiry-month', '2');
    type('expiry-year', '2030');
    await press('capture-use');
    expect(screen.getByText('Enter the expiry date: day, month and year.')).toBeTruthy();
    typeDate(new Date(Date.now() + 10 * 86_400_000));
    await press('capture-use');
    expect(screen.getByText(/^This licence expires on \w+day \d+ \w+ \d{4}, less than 30 days away\. Add it once you have the renewed licence; your other documents are saved\.$/)).toBeTruthy();
    expect(screen.getByText('If you entered the wrong date')).toBeTruthy();
    expect(screen.getByTestId('capture-back')).toBeTruthy();
    await press('capture-change-date');
    expect(screen.getByText('Use this photo')).toBeTruthy();
    expect(bodies('createUpload')).toHaveLength(0); // nothing sent for a refused date
    await press('capture-retake');
    expect(screen.getByText('Fit the whole licence inside the frame')).toBeTruthy();
  });

  it('a camera that fails to take the photo says so and stays', async () => {
    await openCapture(scheme, 'DRIVERS_LICENCE');
    camera.fail = true;
    await press('capture-take');
    expect(await screen.findByText("The photo didn't take. Try again.")).toBeTruthy();
  });

  it('photo of you: front camera, no torch, no file, no expiry; Use this photo attaches without a date', async () => {
    await openCapture(scheme, 'PROFILE_PHOTO');
    expect(await screen.findByText('Fit your face inside the oval')).toBeTruthy();
    expect(screen.getByText('Face the camera in good light. Take off sunglasses. Head coverings worn every day are fine.')).toBeTruthy();
    expect(screen.getByTestId('camera-front')).toBeTruthy();
    expect(screen.queryByTestId('capture-torch')).toBeNull();
    expect(screen.queryByText('Choose a file (PDF or photo)')).toBeNull();
    await press('capture-take');
    expect(await screen.findByText('Is your whole face clear and well lit? This photo has no expiry date.')).toBeTruthy();
    expect(screen.queryByText(/Expiry date/)).toBeNull();
    await press('capture-use');
    await waitFor(() => expect(bodies('attachRiderDocument')).toEqual([{ doc_type: 'PROFILE_PHOTO', stored_object_id: 'e5055f4b-3859-4fbf-a4bd-427822520eb5' }]));
  });

  it('camera not allowed: Open settings, or choose a file instead', async () => {
    const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    start({ scheme, api: { getRiderOnboardingStatus: PENDING, listRiderDocuments: docs() } });
    camera.permission = { granted: false, canAskAgain: true, status: 'undetermined' };
    await openDocuments();
    await press('doc-add-VEHICLE_INSURANCE');
    expect(await screen.findByText('Allow the camera to add documents')).toBeTruthy();
    expect(screen.getByText('HalalGoes uses the camera only when you take a document photo. Turn it on in your phone settings, or choose a PDF instead.')).toBeTruthy();
    await press('capture-open-settings');
    expect(settings).toHaveBeenCalled();
    pick(new Uint8Array(1_468_006), 'image/jpeg');
    await press('capture-choose-file');
    expect(await screen.findByText('We send the whole file. Check it shows the front of your insurance and the expiry date.')).toBeTruthy();
    expect(screen.getByText('· 1.4 MB')).toBeTruthy();
  });

  it('photo of you, camera not allowed: no file option, Back to documents', async () => {
    start({ scheme, api: { getRiderOnboardingStatus: PENDING, listRiderDocuments: docs() } });
    camera.permission = { granted: false, canAskAgain: false, status: 'denied' };
    await openDocuments();
    await press('doc-add-PROFILE_PHOTO');
    expect(await screen.findByText('Allow the camera to take your photo')).toBeTruthy();
    expect(screen.queryByText('Choose a PDF instead')).toBeNull();
    await press('capture-back');
    expect(await screen.findByTestId('documents')).toBeTruthy();
  });

  it('a chosen file: preview and date, Use this file uploads it with its own type', async () => {
    await openCapture(scheme, 'VEHICLE_REGISTRATION');
    pick(new Uint8Array([37, 80, 68, 70]), 'application/pdf');
    await press('capture-choose-file');
    expect(await screen.findByText('Use this file')).toBeTruthy();
    expect(screen.getByText('Must be at least 30 days from today.')).toBeTruthy();
    typeDate(new Date(Date.now() + 400 * 86_400_000));
    await press('capture-use-file');
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(bodies('createUpload')[0]).toMatchObject({ content_type: 'application/pdf', byte_size: 4 });
  });

  it('a file over 15 MB is refused before anything is sent', async () => {
    await openCapture(scheme, 'VEHICLE_REGISTRATION');
    pick(new Uint8Array(16 * 1_048_576), 'application/pdf');
    await press('capture-choose-file');
    expect(await screen.findByText('This file is over 15 MB')).toBeTruthy();
    expect(screen.getByText('Choose a smaller file, or take a photo instead.')).toBeTruthy();
    expect(screen.getByText('Take a photo instead')).toBeTruthy();
    expect(bodies('createUpload')).toHaveLength(0);
  });

  it("a file that is not a photo or a PDF: \"We can't open this file\"", async () => {
    await openCapture(scheme, 'VEHICLE_REGISTRATION');
    pick(new Uint8Array([1, 2]), 'text/plain');
    await press('capture-choose-file');
    expect(await screen.findByText("We can't open this file")).toBeTruthy();
    expect(screen.getByText('Choose a PDF or a photo.')).toBeTruthy();
    await press('capture-take-instead');
    expect(screen.getByText('Fit the whole registration inside the frame')).toBeTruthy();
  });

  it('photo of you too small: the row says Retake, which opens "This photo is too small to check"', async () => {
    await openCapture(scheme, 'PROFILE_PHOTO', { confirmUpload: apiError(422, 'IMAGE_TOO_SMALL', 'Too small.') });
    await press('capture-take');
    await press('capture-use');
    await waitFor(() => expect(screen.getByText('Too small to read. Retake it closer.')).toBeTruthy());
    await press('doc-fix-PROFILE_PHOTO');
    expect(await screen.findByText('This photo is too small to check')).toBeTruthy();
    expect(screen.getByText('Hold the phone closer so your face fills the oval, then take it again.')).toBeTruthy();
    await press('capture-retake');
    expect(screen.getByText('Fit your face inside the oval')).toBeTruthy();
  });

  it('photo of you interrupted: "Your photo didn\'t finish sending", Try again resends without a retake', async () => {
    await openCapture(scheme, 'PROFILE_PHOTO', {}, ['offline', 200]);
    await press('capture-take');
    await press('capture-use');
    await waitFor(() => expect(screen.getByText('Paused')).toBeTruthy());
    await press('doc-fix-PROFILE_PHOTO');
    act(() => reportTransportFailure());
    expect(await screen.findByText("Your photo didn't finish sending")).toBeTruthy();
    expect(screen.getByText('Uploads carry on when you are back online.')).toBeTruthy();
    const shots = camera.shots;
    await press('capture-try-again');
    await waitFor(() => expect(bodies('attachRiderDocument')).toHaveLength(1));
    expect(camera.shots).toBe(shots);
  });
});
