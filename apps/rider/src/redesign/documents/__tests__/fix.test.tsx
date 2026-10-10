/**
 * WP8 R12 Fix documents and its two edit steps, light and dark: one remedy per rejection code
 * (illegible, plate, name, date of birth, wrong document, forgery, other, expired), several at
 * once, the last attempt, ready and the resend (sending, error with the same key, offline,
 * cooldown, 422 NOTHING_TO_RESUBMIT), and the plate and details edits with their 409/422/5xx
 * and offline states.
 */
import './mocks';

import { Linking } from 'react-native';
import { screen, waitFor, within } from '@testing-library/react-native';

import { SCHEMES } from '../../test/render';
import { apiError, bodies, doc, docs, hoursAgo, keys, press, start, status, stop, type } from './harness';

afterEach(() => {
  jest.restoreAllMocks();
  stop();
});

const FIX_ME = { next_route: 'ONBOARDING_REJECTED', onboarding_state: 'DOCUMENTS_REJECTED', first_name: 'Yusef', last_name: 'Ahmed', timezone: 'America/Toronto' };

function rejected(over: Record<string, unknown> = {}) {
  return status('rider_onboarding_documents_rejected', { documents: [], ...over });
}

/** A scooter's set, approved except the ones given (state, code, note). */
function decided(changes: Record<string, Record<string, unknown>>) {
  return docs(
    ...['DRIVERS_LICENCE', 'VEHICLE_REGISTRATION', 'VEHICLE_INSURANCE', 'PROFILE_PHOTO'].map((t) =>
      doc(t, { state: 'APPROVED', reviewed_at: '2026-08-08T18:42:11.412Z', ...(changes[t] ?? {}) }),
    ),
  );
}

function turnedDown(code: string, note: string) {
  return { state: 'REJECTED', rejection_reason_code: code, review_note: note };
}

async function openFix(scheme: 'light' | 'dark', api: Record<string, unknown>) {
  const mock = start({ scheme, me: FIX_ME, api: { getRiderOnboardingStatus: rejected(), ...(api as object) } });
  await screen.findByTestId(/^fix(-ready|-load-error)?$/);
  return mock;
}

function card(type: string) {
  return within(screen.getByTestId(`fix-card-${type}`));
}

const READY_LIST = decided({ VEHICLE_REGISTRATION: { state: 'SUBMITTED', created_at: hoursAgo(1), reviewed_at: null } });

describe.each(SCHEMES)('fix documents (%s)', (scheme) => {
  it('one turned down (ILLEGIBLE): Why, the note, everything else approved, Take a new photo', async () => {
    await openFix(scheme, { listRiderDocuments: decided({ VEHICLE_REGISTRATION: turnedDown('ILLEGIBLE', 'The photo is blurred and the expiry date cannot be read. Retake it flat, in good light.') }) });
    expect(screen.getByText('Fix 1 document')).toBeTruthy();
    expect(screen.getByText('Fix your documents')).toBeTruthy();
    expect(screen.getByText('70% done')).toBeTruthy();
    expect(screen.getByText('Everything else is approved')).toBeTruthy();
    expect(screen.getByText('Only this document is checked again.')).toBeTruthy();
    expect(card('VEHICLE_REGISTRATION').getByText('New upload needed')).toBeTruthy();
    expect(card('VEHICLE_REGISTRATION').getByText("We couldn't read it")).toBeTruthy();
    expect(card('VEHICLE_REGISTRATION').getByText('“The photo is blurred and the expiry date cannot be read. Retake it flat, in good light.”')).toBeTruthy();
    expect(screen.queryByText('Send for review again')).toBeNull();
    await press('fix-primary');
    expect(await screen.findByText('Fit the whole registration inside the frame')).toBeTruthy();
  });

  it('a turned-down document outside the vehicle\'s set (a government ID for a scooter) still gets its card', async () => {
    const list = decided({});
    (list.body as { data: unknown[] }).data.push(doc('GOVERNMENT_ID', turnedDown('ILLEGIBLE', 'The photo is blurred and the expiry date cannot be read. Retake it flat, in good light.')));
    await openFix(scheme, { listRiderDocuments: list });
    expect(screen.getByText('Fix 1 document')).toBeTruthy();
    expect(card('GOVERNMENT_ID').getByText("We couldn't read it")).toBeTruthy();
    await press('fix-primary');
    expect(await screen.findByText('Fit the whole ID inside the frame')).toBeTruthy();
  });

  it('the fixture\'s rejection (INCOMPLETE_PAGES) from the status when the list has none', async () => {
    await openFix(scheme, { getRiderOnboardingStatus: 'rider_onboarding_documents_rejected', listRiderDocuments: docs() });
    expect(card('DRIVERS_LICENCE').getByText('Pages or corners are missing')).toBeTruthy();
  });

  it('PLATE_MISMATCH: Check your plate, the plate entered, two steps; edit plate saves the whole vehicle, then the camera', async () => {
    await openFix(scheme, {
      listRiderDocuments: decided({ VEHICLE_REGISTRATION: turnedDown('PLATE_MISMATCH', 'The plate on the registration is CJRA 240, not CJRA 204.') }),
      submitRiderVehicle: 'rider_vehicle_scooter',
    });
    expect(card('VEHICLE_REGISTRATION').getByText('Check your plate')).toBeTruthy();
    expect(card('VEHICLE_REGISTRATION').getByText("The plate doesn't match your vehicle")).toBeTruthy();
    expect(card('VEHICLE_REGISTRATION').getByText('CJRA 204')).toBeTruthy();
    expect(card('VEHICLE_REGISTRATION').getByText('Two steps, in this order')).toBeTruthy();
    expect(card('VEHICLE_REGISTRATION').getByText('1. Fix the plate you entered.')).toBeTruthy();
    expect(card('VEHICLE_REGISTRATION').getByText('2. Take a new photo of your registration.')).toBeTruthy();
    await press('fix-primary');
    expect(await screen.findByText('About your scooter')).toBeTruthy();
    expect(screen.getByText('Next, take a new photo of your registration. We can only check it again with a new photo.')).toBeTruthy();
    type('fix-plate-input', 'CJRA 240');
    await press('fix-save');
    expect(await screen.findByText('Fit the whole registration inside the frame')).toBeTruthy();
    expect(bodies('submitRiderVehicle')).toEqual([{ vehicle_type: 'SCOOTER', licence_plate: 'CJRA 240', make: 'Honda', model: 'PCX', year: 2021, colour: 'Black' }]);
  });

  it('edit plate: empty, 409 PLATE_IN_USE (It\'s my vehicle: call support), 5xx and offline keep the answer', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const api = await openFix(scheme, {
      listRiderDocuments: decided({ VEHICLE_REGISTRATION: turnedDown('PLATE_MISMATCH', 'The plate on the registration is CJRA 240, not CJRA 204.') }),
      submitRiderVehicle: (_c: unknown, nth: number) =>
        nth === 0 ? apiError(409, 'PLATE_IN_USE', 'Plate in use.') : nth === 1 ? apiError(500, 'INTERNAL_ERROR', 'Boom.') : 'offline',
    });
    await press('fix-primary');
    await screen.findByText('About your scooter');
    type('fix-plate-input', '');
    await press('fix-save');
    expect(screen.getByText('Enter the plate on your scooter, 2 to 8 letters and numbers.', { exact: false })).toBeTruthy();
    expect(api.callsTo('submitRiderVehicle')).toHaveLength(0);
    type('fix-plate-input', 'CJRA 240');
    await press('fix-save');
    expect(await screen.findByText("This plate is on another rider's account. Check it matches your registration.", { exact: false })).toBeTruthy();
    await press('its-mine');
    expect(open).toHaveBeenCalledWith('tel:+18005550199');
    await press('fix-save');
    expect(await screen.findByText("We couldn't save your plate")).toBeTruthy();
    expect(screen.getByText('Something went wrong on our side. Your answer is still here.')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
    await press('fix-save');
    expect(await screen.findByText("Your plate isn't saved yet. It's kept on this phone. Try again once you are back online.")).toBeTruthy();
    expect(screen.getByTestId('fix-plate-input-field').props.value).toBe('CJRA 240');
  });

  it('NAME_MISMATCH: Check your details, the name entered; edit details resends without email, then the camera', async () => {
    await openFix(scheme, {
      listRiderDocuments: decided({ DRIVERS_LICENCE: turnedDown('NAME_MISMATCH', 'The licence says Yusuf Ahmed. Your details say Yusef Ahmed.') }),
      submitRiderProfile: 'rider_profile',
    });
    expect(card('DRIVERS_LICENCE').getByText('Check your details')).toBeTruthy();
    expect(card('DRIVERS_LICENCE').getByText("The name doesn't match your details")).toBeTruthy();
    expect(card('DRIVERS_LICENCE').getByText('Yusef Ahmed')).toBeTruthy();
    expect(card('DRIVERS_LICENCE').getByText('1. Fix your name in your details.')).toBeTruthy();
    expect(screen.getByText('Fix your details, then take a new photo')).toBeTruthy();
    await press('fix-primary');
    expect(await screen.findByText('Enter your date of birth as it is on your licence')).toBeTruthy();
    expect(screen.getByText('“The licence says Yusuf Ahmed. Your details say Yusef Ahmed.”')).toBeTruthy();
    type('fix-first', 'Yusuf');
    type('fix-dob-day', '14');
    type('fix-dob-month', '5');
    type('fix-dob-year', '1995');
    await press('fix-save');
    expect(await screen.findByText('Fit the whole licence inside the frame')).toBeTruthy();
    expect(bodies('submitRiderProfile')).toEqual([{ first_name: 'Yusuf', last_name: 'Ahmed', date_of_birth: '1995-05-14', timezone: 'America/Toronto' }]);
  });

  it('edit details: 422 UNDERAGE, 409 EMAIL_IN_USE (Call support, Try again), 5xx, offline', async () => {
    await openFix(scheme, {
      listRiderDocuments: decided({ DRIVERS_LICENCE: turnedDown('DOB_MISMATCH', 'The licence shows 14 May 1995.') }),
      submitRiderProfile: (_c: unknown, nth: number) =>
        nth === 0
          ? apiError(422, 'UNDERAGE', 'Under age.', { min_age: 18 })
          : nth === 1
            ? apiError(409, 'EMAIL_IN_USE', 'Email in use.')
            : nth === 2
              ? apiError(500, 'INTERNAL_ERROR', 'Boom.')
              : 'offline',
    });
    expect(card('DRIVERS_LICENCE').getByText("The date of birth doesn't match your details")).toBeTruthy();
    expect(card('DRIVERS_LICENCE').getByText('1. Fix your date of birth in your details.')).toBeTruthy();
    await press('fix-primary');
    await screen.findByText('Enter your date of birth as it is on your licence');
    type('fix-dob-day', '14');
    type('fix-dob-month', '5');
    type('fix-dob-year', '2012');
    await press('fix-save');
    expect(await screen.findByText('Check your date of birth. You must be 18 or older to ride with HalalGoes. If this date is right, call support.')).toBeTruthy();
    await press('fix-save');
    expect(await screen.findByText("The email on your application is now on another account. Call support and we'll sort out your email. Your other answers are still here.")).toBeTruthy();
    expect(screen.getByTestId('call-support')).toBeTruthy();
    await press('fix-save');
    expect(await screen.findByText('Something went wrong on our side. Your answers are still here.')).toBeTruthy();
    await press('fix-save');
    expect(await screen.findByText("Your details aren't saved yet. They're kept on this phone. Try again once you are back online.")).toBeTruthy();
  });

  it('WRONG_DOCUMENT_TYPE: Take a photo of the right document, or Choose a PDF instead', async () => {
    await openFix(scheme, { listRiderDocuments: decided({ VEHICLE_INSURANCE: turnedDown('WRONG_DOCUMENT_TYPE', 'This is the vehicle registration, not the insurance.') }) });
    expect(card('VEHICLE_INSURANCE').getByText("It's a different document")).toBeTruthy();
    expect(screen.getByText('Take a photo of the right document')).toBeTruthy();
    expect(screen.getByText('Choose a PDF instead')).toBeTruthy();
  });

  it('SUSPECTED_FORGERY: Call support, the hours, no retake', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await openFix(scheme, { listRiderDocuments: decided({ DRIVERS_LICENCE: turnedDown('SUSPECTED_FORGERY', 'We need to talk to you about this document before it can be checked again.') }) });
    expect(card('DRIVERS_LICENCE').getAllByText('Call support').length).toBeGreaterThan(0);
    expect(card('DRIVERS_LICENCE').getByText("We couldn't confirm it is genuine")).toBeTruthy();
    expect(screen.getByText('You can’t replace this document in the app. Our support team will go through it with you.')).toBeTruthy();
    expect(screen.queryByText(/Take a new photo/)).toBeNull();
    await press('fix-primary');
    expect(open).toHaveBeenCalledWith('tel:+18005550199');
  });

  it('OTHER: no Why line, the note is the reason', async () => {
    await openFix(scheme, { listRiderDocuments: decided({ PROFILE_PHOTO: turnedDown('OTHER', 'Your face is partly covered by a mask.') }) });
    expect(card('PROFILE_PHOTO').queryByText('Why')).toBeNull();
    expect(card('PROFILE_PHOTO').getByText('“Your face is partly covered by a mask.”')).toBeTruthy();
    expect(screen.getByText('Take a new photo')).toBeTruthy();
  });

  it('two to fix: each card has its own button, the footer is the first', async () => {
    await openFix(scheme, {
      listRiderDocuments: decided({
        VEHICLE_REGISTRATION: turnedDown('ILLEGIBLE', 'The expiry date cannot be read.'),
        VEHICLE_INSURANCE: { state: 'EXPIRED', valid_until: '2026-08-01' },
      }),
    });
    expect(screen.getByText('Fix 2 documents')).toBeTruthy();
    expect(card('VEHICLE_INSURANCE').getByText('It has expired')).toBeTruthy();
    expect(card('VEHICLE_INSURANCE').getByText('Take a new photo of vehicle insurance')).toBeTruthy();
    expect(screen.getAllByText('Take a new photo of vehicle registration')).toHaveLength(2);
    expect(screen.queryByText('Everything else is approved')).toBeNull();
  });

  it('last attempt (attempt_number 3): "This is your last chance to resend"', async () => {
    await openFix(scheme, {
      getRiderOnboardingStatus: rejected({ attempt_number: 3 }),
      listRiderDocuments: decided({ DRIVERS_LICENCE: turnedDown('ILLEGIBLE', 'Blurred.') }),
    });
    expect(screen.getByText('This is your last chance to resend')).toBeTruthy();
    expect(screen.getByText('If a document is turned down again, your application closes and only support can reopen it. Check each photo carefully.')).toBeTruthy();
  });

  it('ready: the new photo Added, the rest Approved; Send for review again resends, then Review', async () => {
    await openFix(scheme, {
      getRiderOnboardingStatus: (_c: unknown, nth: number) => (nth < 2 ? rejected() : status('rider_onboarding_documents_review', { submitted_at: hoursAgo(0) })),
      listRiderDocuments: READY_LIST,
      submitRiderDocuments: 'rider_onboarding_documents_review',
    });
    expect(screen.getByTestId('fix-ready')).toBeTruthy();
    expect(screen.getByText('New photo · expires 14 September 2027')).toBeTruthy();
    expect(screen.getByText('Added')).toBeTruthy();
    expect(screen.getAllByText('Approved')).toHaveLength(3);
    expect(screen.getByText('Only the new registration will be checked.')).toBeTruthy();
    await press('fix-send');
    expect(await screen.findByText("We're checking your documents")).toBeTruthy();
    expect(keys('submitRiderDocuments')[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('resending: "Sending your new registration for review."', async () => {
    await openFix(scheme, { listRiderDocuments: READY_LIST, submitRiderDocuments: 'pending' });
    await press('fix-send');
    expect(screen.getByText('Sending your new registration for review.')).toBeTruthy();
    expect(screen.getByLabelText('Sending your document')).toBeTruthy();
  });

  it('send error: "We couldn\'t send your document", Try again keeps the key; offline says nothing was sent', async () => {
    await openFix(scheme, {
      listRiderDocuments: READY_LIST,
      submitRiderDocuments: (_c: unknown, nth: number) => (nth === 0 ? apiError(500, 'INTERNAL_ERROR', 'Boom.') : 'offline'),
    });
    await press('fix-send');
    expect(await screen.findByText("We couldn't send your document")).toBeTruthy();
    expect(screen.getByText('Nothing was lost. Try again.')).toBeTruthy();
    await press('fix-send');
    expect(await screen.findByText('Nothing was sent. Connect to mobile data or Wi-Fi, then try again.')).toBeTruthy();
    expect(screen.getByText('Your new registration is added and waiting to be sent.')).toBeTruthy();
    const [a, b] = keys('submitRiderDocuments');
    expect(b).toBe(a);
  });

  it('429: "You can send this in 24 minutes"', async () => {
    await openFix(scheme, { listRiderDocuments: READY_LIST, submitRiderDocuments: apiError(429, 'RATE_LIMITED', 'Slow down.', { retry_after_seconds: 1440 }) });
    await press('fix-send');
    expect(await screen.findByText('You can send this in 24 minutes')).toBeTruthy();
    expect(screen.getByText('We limit how often documents are sent, so each one gets a full check.')).toBeTruthy();
    expect(screen.getByTestId('fix-send').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('422 NOTHING_TO_RESUBMIT: "Add a new photo of your registration", Take a new photo', async () => {
    await openFix(scheme, { listRiderDocuments: READY_LIST, submitRiderDocuments: apiError(422, 'NOTHING_TO_RESUBMIT', 'Nothing changed.') });
    await press('fix-send');
    expect(await screen.findByText('Add a new photo of your registration')).toBeTruthy();
    expect(screen.getByText('Your plate is saved, but we can only check your registration again with a new photo of it.')).toBeTruthy();
  });

  it('load error: "We couldn\'t load your documents", Try again', async () => {
    await openFix(scheme, {
      getRiderOnboardingStatus: (_c: unknown, nth: number) => (nth === 1 ? apiError(500, 'INTERNAL_ERROR', 'Boom.') : rejected()),
      listRiderDocuments: decided({ DRIVERS_LICENCE: turnedDown('ILLEGIBLE', 'Blurred.') }),
    });
    expect(screen.getByText("We couldn't load your documents")).toBeTruthy();
    await press('retry');
    expect(await screen.findByText('Fix 1 document')).toBeTruthy();
  });

  it('the whole fix: retake, the upload lands, the card becomes Added and Send appears', async () => {
    await openFix(scheme, {
      listRiderDocuments: () => (bodies('attachRiderDocument').length === 0 ? decided({ VEHICLE_REGISTRATION: turnedDown('ILLEGIBLE', 'Blurred.') }) : READY_LIST),
      attachRiderDocument: { status: 201, body: { data: doc('VEHICLE_REGISTRATION') } },
    });
    await press('fix-primary');
    await press('capture-take');
    const d = new Date(Date.now() + 400 * 86_400_000);
    type('expiry-day', String(d.getDate()));
    type('expiry-month', String(d.getMonth() + 1));
    type('expiry-year', String(d.getFullYear()));
    await press('capture-use');
    await waitFor(() => expect(screen.getByTestId('fix-ready')).toBeTruthy());
    expect(screen.getByText('Send for review again')).toBeTruthy();
  });
});
