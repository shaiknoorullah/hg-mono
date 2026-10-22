/**
 * "Use my current location" on the address form (boards `AC/AddressForm`, `-locdenied`,
 * `-geocoding`, `-geodown`): the phone's permission, where the phone is, the address lookup, and
 * every way that can stop. `expo-location` is mocked (`__mocks__/expo-location.js`); each test says
 * what the phone answers.
 */
import * as React from 'react';
import { Linking } from 'react-native';
import * as Location from 'expo-location';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { Schema } from '@hg/api-client';

import { setToken } from '../../../../api/token';
import { resetPublicConfigCache } from '../../../api/config';
import { resetAuthForTests } from '../../../api/auth';
import { markOffline, resetConnectivity } from '../../../lib/connectivity';
import { setNowOverride } from '../../../lib/now';
import { resetSessionForTests } from '../../../session/session';
import { mockApi, payloadOf, type MockAnswer, type MockApi } from '../../../test/mockApi';
import { navSpy, renderRedesign } from '../../../test/render';
import { clearAddressNotice } from '../addressNotice';
import { AddressFormScreen } from '../AddressFormScreen';
import { currentPosition, POSITION_TIMEOUT_MS } from '../../locationPermission';

type Address = Schema['Address'];
const ADDRESSES = payloadOf<Address[]>('addresses_list');

let mock: MockApi;
let current: jest.SpyInstance;
let request: jest.SpyInstance;
let position: jest.SpyInstance;
let openSettings: jest.SpyInstance;

function phoneSays(state: 'granted' | 'notAsked' | 'denied') {
  current.mockResolvedValue({
    granted: state === 'granted',
    canAskAgain: state !== 'denied',
    status: state === 'granted' ? 'granted' : state === 'denied' ? 'denied' : 'undetermined',
    expires: 'never',
  } as never);
}

beforeEach(() => {
  resetConnectivity();
  resetPublicConfigCache();
  resetAuthForTests();
  resetSessionForTests();
  clearAddressNotice();
  setNowOverride({ at: Date.parse('2026-10-09T22:42:00Z') });
  act(() => setToken('access', 'hgrt_x'));
  current = jest.spyOn(Location, 'getForegroundPermissionsAsync');
  request = jest.spyOn(Location, 'requestForegroundPermissionsAsync');
  position = jest.spyOn(Location, 'getCurrentPositionAsync').mockResolvedValue({
    coords: { latitude: 43.7, longitude: -79.4, accuracy: 5 },
    timestamp: 0,
  } as never);
  openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  // The react-native preset's Linking.openSettings is already a jest.fn, so spyOn returns it as it
  // is and restoreAllMocks does not clear its calls: without this, one test's call counts in the next.
  openSettings.mockClear();
  phoneSays('granted');
});

afterEach(() => {
  mock?.restore();
  jest.restoreAllMocks();
  setNowOverride(null);
  act(() => setToken(null));
});

function renderForm(answers: Record<string, MockAnswer> = {}) {
  mock = mockApi({
    listAddresses: 'addresses_list',
    getPublicConfig: 'public_config',
    suggestAddresses: 'address_suggestions_populated',
    getPlaceAddress: 'place_address_full',
    reverseGeocode: 'reverse_geocode_address',
    createAddress: { status: 200, body: { data: ADDRESSES[0]! } },
    ...answers,
  });
  renderRedesign(<AddressFormScreen addressId={null} />, { nav: navSpy({ name: 'addressForm', addressId: null }) });
}

const valueOf = (id: string) => screen.getByTestId(`AddressForm-${id}-field`).props.value as string;

async function pressUseLocation() {
  const button = await screen.findByTestId('PinStep-useLocation');
  await waitFor(() => expect(button).not.toBeDisabled());
  fireEvent.press(button);
}

describe('Use my current location', () => {
  it('reads where the phone is, looks the address up, and fills the form with the pin where the phone is', async () => {
    renderForm();
    await pressUseLocation();
    await waitFor(() => expect(valueOf('line1')).not.toBe(''));
    const reverse = new URL(mock.callsTo('reverseGeocode')[0]!.url);
    expect(Number(reverse.searchParams.get('latitude'))).toBeCloseTo(43.7, 5);
    expect(Number(reverse.searchParams.get('longitude'))).toBeCloseTo(-79.4, 5);
    expect(screen.getByText('Check the pin')).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
  });

  it('not asked yet: asks for location while using the app, then carries on', async () => {
    phoneSays('notAsked');
    request.mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted', expires: 'never' } as never);
    renderForm();
    await pressUseLocation();
    await waitFor(() => expect(valueOf('line1')).not.toBe(''));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('refused at the prompt: shows the location-off note and never reads a position', async () => {
    phoneSays('notAsked');
    request.mockResolvedValue({ granted: false, canAskAgain: true, status: 'denied', expires: 'never' } as never);
    renderForm();
    await pressUseLocation();
    expect(await screen.findByText('Location is off for HalalGoes')).toBeTruthy();
    expect(position).not.toHaveBeenCalled();
    expect(mock.callsTo('reverseGeocode')).toHaveLength(0);
  });

  it('off in the phone settings: a note with a way to the settings, the button disabled, addresses still work', async () => {
    phoneSays('denied');
    renderForm();
    expect(await screen.findByText('Location is off for HalalGoes')).toBeTruthy();
    expect(screen.getByText(/You can still add this address/)).toBeTruthy();
    expect(screen.getByTestId('PinStep-useLocation')).toBeDisabled();
    fireEvent.press(screen.getByText('Open phone settings'));
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('AddressSearch-input-field')).toBeTruthy();
  });

  it('a position that cannot be read says so and leaves the form as it was', async () => {
    position.mockRejectedValue(new Error('location services are off'));
    renderForm();
    await pressUseLocation();
    expect(await screen.findByText("We couldn't find where you are")).toBeTruthy();
    expect(mock.callsTo('reverseGeocode')).toHaveLength(0);
    expect(valueOf('line1')).toBe('');
  });

  it('no address at that spot (404): keeps the pin and says to type the address', async () => {
    renderForm({ reverseGeocode: 'error_geocode_no_match' });
    await pressUseLocation();
    expect(await screen.findByText("We couldn't find an address near the pin")).toBeTruthy();
    expect(valueOf('line1')).toBe('');
  });

  it('the geocoder is down (503): says lookup is not working and leaves the fields to type', async () => {
    renderForm({ reverseGeocode: 'error_geocoder_unavailable' });
    await pressUseLocation();
    expect(await screen.findByText("Address lookup isn't working right now")).toBeTruthy();
    expect(valueOf('line1')).toBe('');
  });

  it('offline: the button is disabled and nothing is asked of the phone', async () => {
    renderForm();
    await screen.findByTestId('PinStep-useLocation');
    act(() => markOffline());
    expect(screen.getByTestId('PinStep-useLocation')).toBeDisabled();
    expect(position).not.toHaveBeenCalled();
  });
});

describe('currentPosition', () => {
  it('gives up when the phone does not answer in time', async () => {
    jest.useFakeTimers();
    try {
      position.mockReturnValue(new Promise(() => {}));
      const outcome = expect(currentPosition()).rejects.toThrow('position timed out');
      jest.advanceTimersByTime(POSITION_TIMEOUT_MS + 1);
      await outcome;
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns only the coordinates', async () => {
    await expect(currentPosition()).resolves.toEqual({ latitude: 43.7, longitude: -79.4 });
  });
});
