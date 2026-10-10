/**
 * WP7 R06 Your details (step 1), light and dark: loading, the time zone preset from the phone,
 * the required-fields summary, saving, under age (and the locked second answer), email in use,
 * a server error with Try again, offline, and the exact `RiderProfileInput` sent.
 */
import './mocks';

import { AppState } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { getToken } from '../../../token';
import { reportTransportFailure } from '../../data/connectivity';
import { SCHEMES } from '../../test/render';
import { OFFLINE_PROBE_MS, recordUnderage, resetApplicationState, underageState } from '../data';
import { apiError, bodies, openDetails, press, route, start, stop, type } from './harness';

afterEach(stop);

/** A rider with no name on file yet, at step 1. */
const NEW_RIDER = { first_name: null, last_name: null };
const PROFILE = { getRiderOnboardingStatus: 'rider_onboarding_phone_verified' };
const UNDERAGE = apiError(422, 'UNDERAGE', 'Rider must be at least 18 years old.', { min_age: 18 });

function fill({ dob = ['14', '05', '1996'], email = '' }: { dob?: string[]; email?: string } = {}): void {
  type('details-first', 'Yusuf');
  type('details-last', 'Ahmed');
  type('dob-day', dob[0]!);
  type('dob-month', dob[1]!);
  type('dob-year', dob[2]!);
  if (email) type('details-email', email);
}

describe.each(SCHEMES)('your details (%s)', (scheme) => {
  it('loading: "Loading your details" under the step AppBar', async () => {
    start({ scheme, me: NEW_RIDER, api: { getRiderOnboardingStatus: (_c, nth) => (nth === 0 ? 'rider_onboarding_phone_verified' : 'pending') } });
    await screen.findByText('Start with your details');
    await press('application-next');
    expect(await screen.findByText('Loading your details')).toBeTruthy();
  });

  it('default: typed date of birth, time zone preset from the phone, helper says 18', async () => {
    start({ scheme, me: NEW_RIDER, api: PROFILE });
    await openDetails();
    expect(screen.getByText('Step 1 of 5: your details')).toBeTruthy();
    expect(screen.getByText('Use your name exactly as it appears on your ID.')).toBeTruthy();
    expect(screen.getByText('You must be 18 or older to ride.')).toBeTruthy();
    expect(screen.getByText('Eastern time (Toronto)')).toBeTruthy(); // preset from America/Toronto
    expect(screen.getByText('Used for your earnings days. Set from your phone. Change it if you ride in another zone.')).toBeTruthy();
    expect(screen.getByText('For receipts and account notices.')).toBeTruthy();
  });

  it('required: one summary lists the missing fields; nothing is sent', async () => {
    const api = start({ scheme, me: NEW_RIDER, api: PROFILE });
    await openDetails();
    await press('details-continue');
    expect(screen.getByText('3 things need fixing')).toBeTruthy();
    expect(screen.getByTestId('summary-first')).toBeTruthy();
    expect(screen.getByTestId('summary-last')).toBeTruthy();
    expect(screen.getByTestId('summary-dob')).toBeTruthy();
    expect(screen.getByText('Enter your first name, as it is on your ID.', { exact: false })).toBeTruthy();
    expect(screen.getByText('Enter your last name, as it is on your ID.', { exact: false })).toBeTruthy();
    expect(screen.getByText('Enter your date of birth: day, month and year.')).toBeTruthy();
    expect(api.callsTo('submitRiderProfile')).toHaveLength(0);
  });

  it('time zone not set (phone outside Eastern/Central): Continue asks for it; choosing one clears it', async () => {
    const api = start({ scheme, me: NEW_RIDER, api: PROFILE, phoneZone: 'America/Vancouver' });
    await openDetails();
    fill();
    await press('details-continue');
    expect(screen.getByText('1 thing needs fixing')).toBeTruthy();
    expect(screen.getByText('Choose the time zone you ride in. It sets the days your earnings are grouped by.', { exact: false })).toBeTruthy();
    expect(api.callsTo('submitRiderProfile')).toHaveLength(0);
    // Nothing came from the phone, so the helper does not say it did.
    expect(screen.queryByText(/Set from your phone/)).toBeNull();
    await press('details-timezone-trigger');
    await press('details-timezone-option-America/Winnipeg');
    expect(screen.queryByText('Choose the time zone you ride in. It sets the days your earnings are grouped by.', { exact: false })).toBeNull();
    expect(screen.getByText('Used for your earnings days.')).toBeTruthy();
  });

  it('a double tap on Continue sends one save', async () => {
    const api = start({ scheme, me: NEW_RIDER, api: { ...PROFILE, submitRiderProfile: 'pending' } });
    await openDetails();
    fill();
    await act(async () => {
      fireEvent.press(screen.getByTestId('details-continue'));
      fireEvent.press(screen.getByTestId('details-continue'));
    });
    expect(api.callsTo('submitRiderProfile')).toHaveLength(1);
  });

  it('saves the exact RiderProfileInput (email left out when blank), then step 2', async () => {
    const api = start({ scheme, me: NEW_RIDER, api: PROFILE });
    await openDetails();
    fill({ dob: ['4', '5', '1996'] });
    await press('details-continue');
    expect(await screen.findByText(/How will you deliver\?/)).toBeTruthy();
    expect(bodies('submitRiderProfile')).toEqual([
      { first_name: 'Yusuf', last_name: 'Ahmed', date_of_birth: '1996-05-04', timezone: 'America/Toronto' },
    ]);
    expect(api.callsTo('getRiderMe').length).toBeGreaterThanOrEqual(2); // the session re-read after saving
    expect(screen.getByLabelText('Back to your details')).toBeTruthy();
  });

  it('saving: Continue keeps its label, busy, fields read-only', async () => {
    start({ scheme, me: NEW_RIDER, api: { ...PROFILE, submitRiderProfile: 'pending' } });
    await openDetails();
    fill({ email: 'yusuf@example.ca' });
    await press('details-continue');
    expect(screen.getByTestId('details-continue').props.accessibilityState).toMatchObject({ busy: true });
    expect(screen.getByText('Continue')).toBeTruthy();
    expect(screen.getByTestId('details-first-field').props.editable).toBe(false);
    expect(bodies('submitRiderProfile')[0]).toMatchObject({ email: 'yusuf@example.ca' });
  });

  it('under age: the date error says 18; a second under-age answer locks the form with Call support and Sign out', async () => {
    const api = start({ scheme, me: NEW_RIDER, api: { ...PROFILE, submitRiderProfile: UNDERAGE } });
    await openDetails();
    fill({ dob: ['02', '03', '2009'] });
    await press('details-continue');
    expect(await screen.findByText('Check your date of birth. You must be 18 or older to ride with HalalGoes.')).toBeTruthy();

    await press('details-continue');
    expect(await screen.findByText('You can apply once you turn 18')).toBeTruthy();
    expect(screen.getByText("We can't accept riders under 18, so these details are locked. If your date of birth is wrong, call support and we'll correct it.")).toBeTruthy();
    expect(screen.queryByTestId('details-continue')).toBeNull();
    expect(screen.getByTestId('dob-year-field').props.editable).toBe(false);
    expect(screen.getByText('Call support')).toBeTruthy();
    expect(api.callsTo('submitRiderProfile')).toHaveLength(2);

    await press('sign-out');
    expect(getToken()).toBeNull();
    expect(route()).toBe('signIn {}');
  });

  it('409 EMAIL_IN_USE: the email field says so', async () => {
    start({
      scheme,
      me: NEW_RIDER,
      api: { ...PROFILE, submitRiderProfile: apiError(409, 'EMAIL_IN_USE', 'Email is already in use.') },
    });
    await openDetails();
    fill({ email: 'yusuf@example.ca' });
    await press('details-continue');
    expect(await screen.findByText('This email is already on another account. Use a different one, or leave it blank.', { exact: false })).toBeTruthy();
  });

  it('422 VALIDATION_FAILED on timezone maps to the time zone field', async () => {
    start({
      scheme,
      me: NEW_RIDER,
      api: { ...PROFILE, submitRiderProfile: apiError(422, 'VALIDATION_FAILED', 'One or more fields failed validation.', [{ field: 'timezone', code: 'invalid', message: 'x' }]) },
    });
    await openDetails();
    fill();
    await press('details-continue');
    expect(await screen.findByText('Choose the time zone you ride in. It sets the days your earnings are grouped by.', { exact: false })).toBeTruthy();
  });

  it('5xx: "We couldn\'t save your details", Try again resends the same answers', async () => {
    start({ scheme, me: NEW_RIDER, api: { ...PROFILE, submitRiderProfile: (_c, nth) => (nth === 0 ? 'error_internal_error' : 'rider_profile') } });
    await openDetails();
    fill();
    await press('details-continue');
    expect(await screen.findByText("We couldn't save your details")).toBeTruthy();
    expect(screen.getByText('Something went wrong on our side. Your answers are still here.')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
    await press('details-continue');
    await screen.findByText(/How will you deliver\?/);
    const sent = bodies('submitRiderProfile');
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
  });

  it('offline: answers stay, Continue is off and nothing is sent', async () => {
    const api = start({ scheme, me: NEW_RIDER, api: PROFILE });
    await openDetails();
    act(() => reportTransportFailure());
    expect(await screen.findByText('Your answers are kept on this phone. Continue works again once you are back online.')).toBeTruthy();
    fill();
    await press('details-continue');
    expect(screen.getByTestId('details-continue').props.accessibilityState).toMatchObject({ disabled: true });
    expect(api.callsTo('submitRiderProfile')).toHaveLength(0);
  });

  it('offline: the status is re-read until the API answers, then Continue works again', async () => {
    const api = start({ scheme, me: NEW_RIDER, api: PROFILE });
    await openDetails();
    fill();
    const before = api.callsTo('getRiderOnboardingStatus').length;
    // The react-native jest preset stubs AppState.currentState; polling runs only in the foreground.
    const stub = Object.getOwnPropertyDescriptor(AppState, 'currentState');
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true, writable: true });
    jest.useFakeTimers();
    try {
      act(() => reportTransportFailure());
      expect(screen.getByTestId('details-continue').props.accessibilityState).toMatchObject({ disabled: true });
      await act(async () => {
        jest.advanceTimersByTime(OFFLINE_PROBE_MS);
      });
      expect(api.callsTo('getRiderOnboardingStatus').length).toBe(before + 1);
      expect(screen.queryByText('You are offline')).toBeNull();
      expect(screen.getByTestId('details-continue').props.accessibilityState).not.toMatchObject({ disabled: true });
    } finally {
      jest.useRealTimers();
      if (stub) Object.defineProperty(AppState, 'currentState', stub);
    }
    await press('details-continue');
    expect(await screen.findByText(/How will you deliver\?/)).toBeTruthy();
    expect(bodies('submitRiderProfile')).toHaveLength(1);
  });

  it('a save that loses the connection shows offline and keeps the answers', async () => {
    start({ scheme, me: NEW_RIDER, api: { ...PROFILE, submitRiderProfile: 'offline' } });
    await openDetails();
    fill();
    await press('details-continue');
    expect(await screen.findByText('You are offline')).toBeTruthy();
    expect(screen.getByTestId('details-first-field').props.value).toBe('Yusuf');
  });

  it('Back returns to the application', async () => {
    start({ scheme, me: NEW_RIDER, api: PROFILE });
    await openDetails();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Back to your application'));
    });
    await waitFor(() => expect(screen.getByText('Apply to ride')).toBeTruthy());
  });
});

describe('under-age count', () => {
  afterEach(resetApplicationState);

  it('belongs to the account that got the answers, not to the next rider on the phone', () => {
    recordUnderage('rider-a', 18);
    expect(recordUnderage('rider-a', 18)).toBe(2);
    expect(underageState('rider-a').count).toBe(2);
    expect(underageState('rider-b')).toEqual({ count: 0, minAge: 18 });
    expect(recordUnderage('rider-b', 18)).toBe(1);
  });
});
