/**
 * WP5 proof of delivery and Delivered, against the contract's fixtures (and #290's), light and dark.
 *
 * Pins the WP5 DONE list: one proof path per `required_pod_method`; DELIVERED is never sent
 * before the proof's 200; proof never queues offline (TripNoConnection and a retry, the outbox
 * stays empty); 423 DELIVERY_CODE_LOCKED is the support handoff with no photo option; a retry is
 * the same request (same Idempotency-Key and body); the photo goes presign → PUT → confirm;
 * Delivered shows each ledger line as returned, or the estimate until there is one.
 */
import * as React from 'react';
import { Linking, Text } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import {
  ATTESTATION_ASSIGNMENT,
  CAMERA_DENIED,
  DELIVERY_CODE_INCORRECT,
  DELIVERY_CODE_LOCKED,
  ID,
  PHOTO_BYTES,
  POD_REQUIRED,
  PROOF_RECORDED,
  SHOT,
  cameraGives,
  entriesFor,
  goOffline,
  keys,
  renderDropoff,
  storage,
  transitions,
  type Answer,
} from './harness';
import { outbox } from '../../data/outbox';
import { resetHomeState, updateHomeState } from '../../home/dashboard';
import { useNav } from '../../nav/Navigator';
import { registerScreen } from '../../nav/registry';
import type { MockApi } from '../../test/mockApi';
import { payload } from '../../test/mockApi';
import { SCHEMES } from '../../test/render';
import { sha256HexBytes } from '../../../sha256';

const OTP = 'assignment_otp_pod_required';
const PHOTO = 'assignment_arrived_at_dropoff';
const disabled = (testID: string) => screen.getByTestId(testID).props.accessibilityState?.disabled;
const proofs = (api: MockApi) => api.callsTo('submitProofOfDelivery');
const proofKeys = (api: MockApi) => proofs(api).map((c) => c.headers['idempotency-key']);
const delivered = (api: MockApi) => transitions(api).filter((t) => t.to_state === 'DELIVERED');

/** Home after "Back to Home": a probe, so the test can see the flow closed. */
function HomeProbe() {
  const nav = useNav();
  return <Text testID="home-probe">{`${nav.current.name}:${nav.flow ? 'flow' : 'tabs'}`}</Text>;
}

afterEach(() => resetHomeState());

/** From the door to the proof screen: Hand it over, pick a way, next. */
async function toProof(way: string, next: RegExp) {
  fireEvent.press(await screen.findByText('Hand it over'));
  fireEvent.press(await screen.findByText(way));
  fireEvent.press(await screen.findByText(next));
}

async function typeCode(code: string) {
  await toProof('The customer', /^Next: enter/);
  fireEvent.changeText(await screen.findByTestId('proof-otp-code-field'), code);
}

describe.each(SCHEMES)("proof: the customer's code (%s)", (scheme) => {
  it('entry: the ask, the field, Check the code turns on at 4 digits; Back to handover', async () => {
    renderDropoff(scheme, OTP);
    await toProof('The customer', /^Next: enter/);
    await screen.findByText('Ask the customer for their 4-digit code');
    expect(screen.getByText("It's on their order and tracking screens in the HalalGoes app. Type what they read out.")).toBeTruthy();
    expect(screen.getByText('Step 4 of 4 · Proof · HG-PIUP-9X')).toBeTruthy();
    expect(disabled('proof-otp-check')).toBe(true);
    expect(screen.getByText('Turns on when the code has 4 digits.')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('proof-otp-code-field'), '48a2');
    expect(screen.getByTestId('proof-otp-code-field').props.value).toBe('482');
    fireEvent.changeText(screen.getByTestId('proof-otp-code-field'), '4821');
    expect(disabled('proof-otp-check')).toBe(false);
    fireEvent.press(screen.getByLabelText('Back to handover'));
    expect(await screen.findByText('Who will you hand it to?')).toBeTruthy();
  });

  it('accepted: the proof is OtpProofInput, nothing is DELIVERED until "Mark as delivered", then Delivered', async () => {
    const { api } = renderDropoff(scheme, OTP, {
      submitProofOfDelivery: PROOF_RECORDED(OTP),
      createAssignmentTransition: 'assignment_delivered',
      listRiderEarningEntries: 'earning_entries_empty',
    });
    await typeCode('4821');
    fireEvent.press(screen.getByText('Check the code'));
    await screen.findByText('Code accepted');
    expect(screen.getByText('Code accepted. Hand the bag to Ayesha R. now.')).toBeTruthy();
    expect(proofs(api)[0]!.body).toEqual({ method: 'OTP', otp_code: '4821', handover_method: 'HANDED_TO_CUSTOMER' });
    expect(proofKeys(api)[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(delivered(api)).toHaveLength(0);
    fireEvent.press(screen.getByText('Mark as delivered'));
    await screen.findByText('Delivered to Ayesha R.');
    expect(delivered(api)).toHaveLength(1);
    expect(screen.getByText(/^Customer's code confirmed at \d{1,2}:\d{2} (am|pm)\.$/)).toBeTruthy();
  });

  it('checking: "Checking the code" while it sends, the field locked', async () => {
    renderDropoff(scheme, OTP, { submitProofOfDelivery: 'pending' });
    await typeCode('4821');
    fireEvent.press(screen.getByText('Check the code'));
    expect(await screen.findByText('Checking the code')).toBeTruthy();
    expect(screen.getByTestId('proof-otp-code-field').props.editable).toBe(false);
  });

  it('422 DELIVERY_CODE_INCORRECT: the code is kept, the line says the tries left', async () => {
    const { api } = renderDropoff(scheme, OTP, { submitProofOfDelivery: DELIVERY_CODE_INCORRECT });
    await typeCode('4821');
    fireEvent.press(screen.getByText('Check the code'));
    expect(await screen.findByText(/That isn't the customer's code\. Ask them to read it again from their order\. 2 tries left\.$/)).toBeTruthy();
    expect(screen.getByTestId('proof-otp-code-field').props.value).toBe('4821');
    expect(screen.queryByText(/photo/i)).toBeNull();
    expect(delivered(api)).toHaveLength(0);
  });

  it('423 DELIVERY_CODE_LOCKED: support takes over; no photo, no field, no DELIVERED', async () => {
    const { api, openURL } = renderDropoff(scheme, OTP, { submitProofOfDelivery: DELIVERY_CODE_LOCKED });
    await typeCode('4821');
    fireEvent.press(screen.getByText('Check the code'));
    await screen.findByText('The code is locked after 5 tries');
    expect(
      screen.getByText('HalalGoes support is taking over this delivery. Keep the bag with you and call HalalGoes support to finish it.'),
    ).toBeTruthy();
    expect(screen.queryByTestId('proof-otp-code-field')).toBeNull();
    expect(screen.queryByText(/photo/i)).toBeNull();
    expect(screen.getByText('1 800 555 0199 · Support Hours')).toBeTruthy();
    fireEvent.press(screen.getByText('Call HalalGoes support'));
    expect(openURL).toHaveBeenCalledWith('tel:+18005550199');
    expect(screen.getByText('Call Ayesha R.')).toBeTruthy();
    expect(delivered(api)).toHaveLength(0);
  });

  it('423 stays locked: leaving for "Something\'s wrong" and coming back never brings the field back', async () => {
    const { api } = renderDropoff(scheme, OTP, { submitProofOfDelivery: DELIVERY_CODE_LOCKED });
    await typeCode('4821');
    fireEvent.press(screen.getByText('Check the code'));
    await screen.findByText('The code is locked after 5 tries');
    fireEvent.press(screen.getByText("Something's wrong"));
    fireEvent.press(await screen.findByTestId('wp6-back'));
    expect(await screen.findByText('The code is locked after 5 tries')).toBeTruthy();
    expect(screen.queryByTestId('proof-otp-code-field')).toBeNull();
    expect(proofs(api)).toHaveLength(1);
  });

  it('5xx, then Try again: the same Idempotency-Key and body; a changed code is a new key', async () => {
    const { api } = renderDropoff(scheme, OTP, {
      submitProofOfDelivery: (_c, nth) => (nth < 2 ? 'error_internal_error' : PROOF_RECORDED(OTP)),
    });
    await typeCode('4821');
    fireEvent.press(screen.getByText('Check the code'));
    await screen.findByText("We couldn't check the code");
    fireEvent.press(screen.getByText('Try again'));
    await waitFor(() => expect(proofs(api)).toHaveLength(2));
    expect(proofKeys(api)[1]).toBe(proofKeys(api)[0]);
    expect(proofs(api)[1]!.body).toEqual(proofs(api)[0]!.body);
    fireEvent.changeText(await screen.findByTestId('proof-otp-code-field'), '4822');
    fireEvent.press(screen.getByText('Try again'));
    await screen.findByText('Code accepted');
    expect(proofKeys(api)[2]).not.toBe(proofKeys(api)[0]);
  });

  it('no connection: keep the bag and Try again, nothing saved for later', async () => {
    const { api } = renderDropoff(scheme, OTP, { submitProofOfDelivery: (_c, nth) => (nth === 0 ? 'offline' : PROOF_RECORDED(OTP)) });
    await typeCode('4821');
    goOffline(api);
    fireEvent.press(screen.getByText('Check the code'));
    await screen.findByText("Keep the bag until you're back online");
    expect(screen.getByText('No internet connection')).toBeTruthy();
    expect(outbox.snapshot()).toHaveLength(0);
    expect(screen.queryByText('Not sent yet')).toBeNull();
    fireEvent.press(screen.getByTestId('proof-offline-retry'));
    await screen.findByText('Code accepted');
    expect(proofKeys(api)[1]).toBe(proofKeys(api)[0]);
  });

  it("the customer can't find the code: where to look, call them, back to the code", async () => {
    const { openURL } = renderDropoff(scheme, OTP);
    await toProof('The customer', /^Next: enter/);
    fireEvent.press(await screen.findByText("The customer can't find the code"));
    expect(await screen.findByText("It's on their order and tracking screens in the HalalGoes app, under Delivery code.")).toBeTruthy();
    fireEvent.press(screen.getByText('Call Ayesha R.'));
    expect(openURL).toHaveBeenCalledWith('tel:+16475550233');
    fireEvent.press(screen.getByText('Back to the code'));
    await waitFor(() => expect(screen.queryByText("It's on their order and tracking screens in the HalalGoes app, under Delivery code.")).toBeNull());
  });
});

describe.each(SCHEMES)('proof: a photo (%s)', (scheme) => {
  const toCamera = () => toProof('Leave it at the door', /^Next: take the photo/);

  it('camera, review, then Mark as delivered: createUpload → PUT → confirmUpload → PhotoProofInput → DELIVERED', async () => {
    cameraGives(SHOT);
    const { api } = renderDropoff(scheme, PHOTO, {
      submitProofOfDelivery: PROOF_RECORDED(),
      createAssignmentTransition: 'assignment_delivered',
      listRiderEarningEntries: 'earning_entries_empty',
    });
    const { puts } = storage(api);
    await toCamera();
    await screen.findByText('Take a photo of the bag at the door');
    expect(screen.getByText("Show the bag and the door or unit number in one photo. Don't include people.")).toBeTruthy();
    expect(screen.getByText('Bag for')).toBeTruthy();
    fireEvent.press(screen.getByText('Take photo'));
    await screen.findByText('Check the photo');
    expect(screen.getByText(/^Your photo, \d{1,2}:\d{2} (am|pm)$/)).toBeTruthy();
    expect(api.callsTo('createUpload')).toHaveLength(0);
    fireEvent.press(screen.getByText('Mark as delivered'));
    await screen.findByText('Delivered to Ayesha R.');

    const [create] = api.callsTo('createUpload');
    expect(create!.body).toEqual({
      purpose: 'POD',
      content_type: 'image/jpeg',
      byte_size: PHOTO_BYTES.byteLength,
      sha256: sha256HexBytes(PHOTO_BYTES),
      order_id: payload(PHOTO).order_id,
    });
    expect(create!.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(puts).toEqual([{ url: payload('presigned_upload').url, headers: { 'content-type': 'image/jpeg' }, size: PHOTO_BYTES.byteLength }]);
    expect(api.callsTo('confirmUpload')[0]!.path).toContain(payload('presigned_upload').upload_id);
    expect(proofs(api)[0]!.body).toEqual({ method: 'PHOTO', photo_object_id: payload('stored_object_ready').id, handover_method: 'LEFT_AT_DOOR' });
    // DELIVERED only after the proof's 200.
    const order = api.calls.map((c) => c.operationId).filter((op) => op === 'submitProofOfDelivery' || op === 'createAssignmentTransition');
    expect(order).toEqual(['submitProofOfDelivery', 'createAssignmentTransition']);
    expect(screen.getByText(/^Photo proof recorded at \d{1,2}:\d{2} (am|pm)\.$/)).toBeTruthy();
  });

  it('uploading: "Uploading your photo", the primary busy', async () => {
    cameraGives(SHOT);
    renderDropoff(scheme, PHOTO, { createUpload: 'pending' });
    await toCamera();
    fireEvent.press(await screen.findByText('Take photo'));
    fireEvent.press(await screen.findByText('Mark as delivered'));
    expect(await screen.findByText('Uploading your photo')).toBeTruthy();
    expect(screen.getByText("Keep the app open. It's kept on your phone until it's sent.")).toBeTruthy();
    expect(screen.getByText('Uploading photo')).toBeTruthy();
  });

  it("upload failed: the photo is kept, Try uploading again starts the upload again; no proof before it's READY", async () => {
    cameraGives(SHOT);
    const { api } = renderDropoff(scheme, PHOTO, { submitProofOfDelivery: PROOF_RECORDED(), createAssignmentTransition: 'assignment_delivered' });
    const { puts } = storage(api, (nth) => (nth === 0 ? 'fail' : 'ok'));
    await toCamera();
    fireEvent.press(await screen.findByText('Take photo'));
    fireEvent.press(await screen.findByText('Mark as delivered'));
    await screen.findByText("Your photo didn't upload");
    expect(screen.getByText('Retake photo')).toBeTruthy();
    expect(proofs(api)).toHaveLength(0);
    fireEvent.press(screen.getByText('Try uploading again'));
    await screen.findByText('Delivered to Ayesha R.');
    expect(puts).toHaveLength(2);
    expect(proofs(api)).toHaveLength(1);
  });

  it('camera off for HalalGoes: Open Settings, no photo library', async () => {
    const camera = cameraGives(CAMERA_DENIED);
    const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    renderDropoff(scheme, PHOTO);
    await toCamera();
    fireEvent.press(await screen.findByText('Take photo'));
    await screen.findByText('Camera is off for HalalGoes');
    expect(screen.getByText('The proof photo needs the camera. Allow it in Settings, then come back here.')).toBeTruthy();
    expect(camera).toHaveBeenCalledWith({ cameraOnly: true });
    fireEvent.press(screen.getByText('Open Settings'));
    expect(settings).toHaveBeenCalled();
    settings.mockRestore();
  });

  it('422 POD_METHOD_MISMATCH: "This order needs a different proof", back to the handover', async () => {
    cameraGives(SHOT);
    const { api } = renderDropoff(scheme, PHOTO, { submitProofOfDelivery: 'error_pod_method_mismatch' });
    storage(api);
    await toCamera();
    fireEvent.press(await screen.findByText('Take photo'));
    fireEvent.press(await screen.findByText('Mark as delivered'));
    await screen.findByText('This order needs a different proof');
    expect(delivered(api)).toHaveLength(0);
    fireEvent.press(screen.getByText("Enter the customer's code"));
    expect(await screen.findByText('How will you hand it over?', { exact: true })).toBeTruthy();
  });

  it('no connection at the proof: keep the bag, retry the same proof; nothing queued, no DELIVERED', async () => {
    cameraGives(SHOT);
    const { api } = renderDropoff(scheme, PHOTO, {
      submitProofOfDelivery: (_c, nth) => (nth === 0 ? 'offline' : PROOF_RECORDED()),
      createAssignmentTransition: 'assignment_delivered',
    });
    storage(api);
    await toCamera();
    fireEvent.press(await screen.findByText('Take photo'));
    fireEvent.press(await screen.findByText('Mark as delivered'));
    await screen.findByText("Keep the bag until you're back online");
    expect(outbox.snapshot()).toHaveLength(0);
    expect(delivered(api)).toHaveLength(0);
    fireEvent.press(screen.getByTestId('proof-offline-retry'));
    await screen.findByText('Delivered to Ayesha R.');
    expect(proofKeys(api)[1]).toBe(proofKeys(api)[0]);
    // The photo was uploaded once.
    expect(api.callsTo('createUpload')).toHaveLength(1);
  });

  it('DELIVERED 5xx: "Stay nearby until this sends", Try again is the same request', async () => {
    cameraGives(SHOT);
    const { api } = renderDropoff(scheme, PHOTO, {
      submitProofOfDelivery: PROOF_RECORDED(),
      createAssignmentTransition: (_c, nth) => (nth === 0 ? 'error_internal_error' : 'assignment_delivered'),
    });
    storage(api);
    await toCamera();
    fireEvent.press(await screen.findByText('Take photo'));
    fireEvent.press(await screen.findByText('Mark as delivered'));
    await screen.findByText('Stay nearby until this sends');
    expect(screen.getByText("We couldn't mark it as delivered. Your proof is saved. Try again.")).toBeTruthy();
    expect(screen.getByText('Proof saved · delivery not sent yet')).toBeTruthy();
    fireEvent.press(screen.getByText('Try again'));
    await screen.findByText('Delivered to Ayesha R.');
    expect(keys(api)[1]).toBe(keys(api)[0]);
    expect(delivered(api)[1]).toEqual(delivered(api)[0]);
    expect(proofs(api)).toHaveLength(1);
  });

  it('DELIVERED 5xx, away and back: only "Mark as delivered" is left, the same DELIVERED request, no second proof', async () => {
    cameraGives(SHOT);
    // The server says `pod_recorded` from the proof's 200 on, to every read.
    let recorded = false;
    const { api } = renderDropoff(scheme, () => (recorded ? PROOF_RECORDED() : PHOTO), {
      submitProofOfDelivery: () => {
        recorded = true;
        return PROOF_RECORDED();
      },
      createAssignmentTransition: (_c, nth) => (nth === 0 ? 'error_internal_error' : 'assignment_delivered'),
      listRiderEarningEntries: 'earning_entries_empty',
    });
    storage(api);
    await toCamera();
    fireEvent.press(await screen.findByText('Take photo'));
    fireEvent.press(await screen.findByText('Mark as delivered'));
    await screen.findByText('Stay nearby until this sends');
    fireEvent.press(screen.getByText("Something's wrong"));
    fireEvent.press(await screen.findByTestId('wp6-back'));
    await screen.findByText('Proof saved · delivery not sent yet');
    expect(screen.queryByText('Take a photo of the bag at the door')).toBeNull();
    fireEvent.press(screen.getByText('Mark as delivered'));
    await screen.findByText('Delivered to Ayesha R.');
    expect(keys(api)[1]).toBe(keys(api)[0]);
    expect(proofs(api)).toHaveLength(1);
    expect(api.callsTo('createUpload')).toHaveLength(1);
  });

  it('DELIVERED 422 POD_REQUIRED: "We need a photo before this counts as delivered", take it again', async () => {
    cameraGives(SHOT, SHOT);
    const { api } = renderDropoff(scheme, PHOTO, { submitProofOfDelivery: PROOF_RECORDED(), createAssignmentTransition: POD_REQUIRED() });
    storage(api);
    await toCamera();
    fireEvent.press(await screen.findByText('Take photo'));
    fireEvent.press(await screen.findByText('Mark as delivered'));
    await screen.findByText('We need a photo before this counts as delivered');
    expect(screen.getByText("This order needs a photo at the door. Take it now, then you're done.")).toBeTruthy();
    fireEvent.press(screen.getByText('Take the photo'));
    expect(await screen.findByText('Take a photo of the bag at the door')).toBeTruthy();
    // A refused DELIVERED is final: the next one, after the new photo, is a new request.
    api.set('createAssignmentTransition', 'assignment_delivered');
    fireEvent.press(screen.getByText('Take photo'));
    fireEvent.press(await screen.findByText('Mark as delivered'));
    await screen.findByText('Delivered to Ayesha R.');
    expect(keys(api)[1]).not.toBe(keys(api)[0]);
  });
});

describe.each(SCHEMES)('proof: a photo and a statement (%s)', (scheme) => {
  it('never pre-ticked; turns on with a photo, 5+ characters and the box; sent straight away, no wait', async () => {
    cameraGives(SHOT);
    const { api } = renderDropoff(scheme, ATTESTATION_ASSIGNMENT, {
      submitProofOfDelivery: PROOF_RECORDED(),
      createAssignmentTransition: 'assignment_delivered',
    });
    storage(api);
    await toProof('To someone else at the address', /^Next: photo/);
    await screen.findByText('Photo and a short statement');
    expect(screen.getByText(/^What happened/)).toBeTruthy();
    const box = screen.getByText('I confirm I handed the order to someone at this address');
    expect(screen.getByTestId('proof-attest-box').props.accessibilityState?.checked).toBe(false);
    expect(disabled('proof-submit')).toBe(true);
    fireEvent.press(screen.getByText('Take photo'));
    await screen.findByText(/^Photo taken \d{1,2}:\d{2} (am|pm)$/);
    fireEvent.changeText(screen.getByTestId('proof-statement-field'), 'Left');
    fireEvent.press(box);
    expect(disabled('proof-submit')).toBe(true);
    fireEvent.changeText(screen.getByTestId('proof-statement-field'), 'Handed to her brother at the door.');
    expect(disabled('proof-submit')).toBe(false);
    expect(screen.queryByText('Wait at the door')).toBeNull();
    fireEvent.press(screen.getByText('Mark as delivered'));
    await screen.findByText('Delivered to Ayesha R.');
    expect(proofs(api)[0]!.body).toEqual({
      method: 'PHOTO_WITH_ATTESTATION',
      photo_object_id: payload('stored_object_ready').id,
      handover_method: 'HANDED_TO_OTHER_PERSON',
      attestation_reason: 'Handed to her brother at the door.',
    });
    expect(screen.getByText(/^Photo and your statement recorded at /)).toBeTruthy();
  });

  it("proof 5xx: \"We couldn't save your proof\", the statement kept, Try again is the same request", async () => {
    cameraGives(SHOT);
    const { api } = renderDropoff(scheme, ATTESTATION_ASSIGNMENT, {
      submitProofOfDelivery: (_c, nth) => (nth === 0 ? 'error_internal_error' : PROOF_RECORDED()),
      createAssignmentTransition: 'assignment_delivered',
    });
    storage(api);
    await toProof('To the customer', /^Next: photo/);
    fireEvent.press(await screen.findByText('Take photo'));
    fireEvent.changeText(await screen.findByTestId('proof-statement-field'), "Customer's code was locked; at the door.");
    fireEvent.press(screen.getByText('I confirm I handed the order to the customer at this address'));
    fireEvent.press(screen.getByText('Mark as delivered'));
    await screen.findByText("We couldn't save your proof");
    expect(screen.getByTestId('proof-statement-field').props.value).toBe("Customer's code was locked; at the door.");
    fireEvent.press(screen.getByText('Try again'));
    await screen.findByText('Delivered to Ayesha R.');
    expect(proofKeys(api)[1]).toBe(proofKeys(api)[0]);
  });

  it('camera off: the statement alone is not enough', async () => {
    cameraGives(CAMERA_DENIED);
    renderDropoff(scheme, ATTESTATION_ASSIGNMENT);
    await toProof('To the customer', /^Next: photo/);
    fireEvent.press(await screen.findByText('Take photo'));
    expect(await screen.findByText('The photo for your statement needs the camera. Allow it in Settings, then come back here.')).toBeTruthy();
  });
});

describe.each(SCHEMES)('Delivered and a proof left half-way (%s)', (scheme) => {
  async function deliverByCode(api: MockApi) {
    await typeCode('4821');
    fireEvent.press(screen.getByText('Check the code'));
    fireEvent.press(await screen.findByText('Mark as delivered'));
    await screen.findByText('Delivered to Ayesha R.');
    return api;
  }

  it('no ledger line yet: the estimate from the assignment, said to be one', async () => {
    const { api } = renderDropoff(scheme, OTP, {
      submitProofOfDelivery: PROOF_RECORDED(OTP),
      createAssignmentTransition: 'assignment_delivered',
      listRiderEarningEntries: 'earning_entries_empty',
    });
    await deliverByCode(api);
    expect(await screen.findByText('Estimated earnings for this delivery')).toBeTruthy();
    expect(screen.getByText(/11\.49/)).toBeTruthy();
    expect(screen.getByText("This is an estimate. The final amount appears in Earnings once it's finalised.")).toBeTruthy();
    expect(screen.getByText('Order HG-PIUP-9X')).toBeTruthy();
  });

  it("the ledger's lines for this delivery, each as returned and never summed", async () => {
    const { api } = renderDropoff(scheme, OTP, {
      submitProofOfDelivery: PROOF_RECORDED(OTP),
      createAssignmentTransition: 'assignment_delivered',
      listRiderEarningEntries: entriesFor(ID),
    });
    await deliverByCode(api);
    await screen.findByText('Delivery');
    expect(screen.getByText('Tip')).toBeTruthy();
    expect(screen.getByText(/4\.49/)).toBeTruthy();
    expect(screen.getByText(/7\.00/)).toBeTruthy();
    expect(screen.queryByText(/11\.49/)).toBeNull();
    expect(screen.queryByText('Bonus')).toBeNull();
  });

  it('Back to Home closes the trip, forgets its saved steps and re-reads the dashboard', async () => {
    registerScreen('home', { component: HomeProbe });
    const { api } = renderDropoff(scheme, OTP, {
      submitProofOfDelivery: PROOF_RECORDED(OTP),
      createAssignmentTransition: 'assignment_delivered',
      listRiderEarningEntries: 'earning_entries_empty',
    });
    await deliverByCode(api);
    const spy = jest.spyOn(outbox, 'clearAssignment');
    fireEvent.press(screen.getByText('Back to Home'));
    expect((await screen.findByTestId('home-probe')).props.children).toBe('home:tabs');
    expect(spy).toHaveBeenCalledWith(ID);
    spy.mockRestore();
  });

  it('asked to go offline after this delivery: "You\'re now offline" and Go online', async () => {
    const { api } = renderDropoff(scheme, OTP, {
      submitProofOfDelivery: PROOF_RECORDED(OTP),
      createAssignmentTransition: 'assignment_delivered',
      listRiderEarningEntries: 'earning_entries_empty',
      setRiderAvailability: 'rider_availability_online_idle',
    });
    await deliverByCode(api);
    const offline = { ...payload('rider_dashboard_active'), mode: 'OFFLINE', active_assignment: null };
    act(() =>
      updateHomeState({
        query: { status: 'success', data: offline, error: null, refreshing: false, updatedAt: Date.now(), refetch: async () => {} },
      }),
    );
    expect(await screen.findByText("You're now offline")).toBeTruthy();
    expect(screen.getByText("You asked to go offline after this delivery. You won't get offers.")).toBeTruthy();
    fireEvent.press(screen.getByText('Go online'));
    await waitFor(() => expect(api.callsTo('setRiderAvailability')).toHaveLength(1));
  });

  it('restored with the proof recorded and DELIVERED not sent: Mark as delivered is all that is left', async () => {
    const recorded: Answer = PROOF_RECORDED();
    const { api } = renderDropoff(scheme, recorded, { createAssignmentTransition: 'assignment_delivered', listRiderEarningEntries: 'earning_entries_empty' });
    await screen.findByText('Proof saved · delivery not sent yet');
    expect(proofs(api)).toHaveLength(0);
    fireEvent.press(screen.getByText('Mark as delivered'));
    await screen.findByText('Delivered to Ayesha R.');
    expect(delivered(api)).toHaveLength(1);
  });
});
