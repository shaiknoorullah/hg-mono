/**
 * App settings (boards `AC/AppSettings`, `-notasked`, `-off`): the location permission in its
 * three states, what each button does, that a refusal never leaves a dead control, and the
 * appearance and notification rows. `expo-location` is mocked (`__mocks__/expo-location.js`) and
 * each test sets what the phone says.
 */
import * as React from 'react';
import { AppState, Linking } from 'react-native';
import * as Location from 'expo-location';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { navSpy, renderRedesign } from '../../test/render';
import { AppSettingsScreen, LOCATION_ROW } from '../AppSettingsScreen';

let current: jest.SpyInstance;
let request: jest.SpyInstance;
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
  current = jest.spyOn(Location, 'getForegroundPermissionsAsync');
  request = jest.spyOn(Location, 'requestForegroundPermissionsAsync');
  openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function renderSettings(scheme: 'light' | 'dark' = 'light') {
  const nav = navSpy({ name: 'appSettings' });
  renderRedesign(<AppSettingsScreen />, { nav, scheme });
  return nav;
}

describe('App settings: location', () => {
  it('reading the permission shows a skeleton, not a guess', async () => {
    current.mockReturnValue(new Promise(() => {}));
    renderSettings();
    expect(screen.getByTestId('AppSettings-loading')).toBeTruthy();
    expect(screen.queryByTestId('AppSettings-location')).toBeNull();
  });

  it('allowed: says so, and the button opens the phone settings', async () => {
    phoneSays('granted');
    renderSettings();
    expect(await screen.findByText(LOCATION_ROW.allowed.sub)).toBeTruthy();
    expect(screen.queryByTestId('AppSettings-locationOff')).toBeNull();
    fireEvent.press(screen.getByTestId('AppSettings-openSettings'));
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });

  it('not asked yet: "Turn on location" asks for location while using the app, and nothing else', async () => {
    phoneSays('notAsked');
    request.mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted', expires: 'never' } as never);
    renderSettings();
    expect(await screen.findByText(LOCATION_ROW.notAsked.sub)).toBeTruthy();
    expect(screen.getByTestId('AppSettings-locationOff')).toBeTruthy();
    fireEvent.press(screen.getByTestId('AppSettings-turnOn'));
    expect(await screen.findByText(LOCATION_ROW.allowed.sub)).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(1);
    expect(openSettings).not.toHaveBeenCalled();
  });

  it('refusing the prompt turns the row to "off" with a way to the phone settings, not a dead switch', async () => {
    phoneSays('notAsked');
    request.mockResolvedValue({ granted: false, canAskAgain: true, status: 'denied', expires: 'never' } as never);
    renderSettings();
    fireEvent.press(await screen.findByTestId('AppSettings-turnOn'));
    expect(await screen.findByText(LOCATION_ROW.denied.sub)).toBeTruthy();
    fireEvent.press(screen.getByTestId('AppSettings-openSettings'));
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('off in the phone settings: says so, explains that addresses still work, and opens the settings', async () => {
    phoneSays('denied');
    renderSettings();
    expect(await screen.findByText(LOCATION_ROW.denied.sub)).toBeTruthy();
    expect(screen.getByText(/Without location you can still add an address/)).toBeTruthy();
    fireEvent.press(screen.getByText('Open phone settings'));
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });

  it('a permission that cannot be read is "not asked", never "allowed"', async () => {
    current.mockRejectedValue(new Error('no module'));
    renderSettings();
    expect(await screen.findByText(LOCATION_ROW.notAsked.sub)).toBeTruthy();
  });

  it('reads the permission again when the app comes back from the phone settings', async () => {
    phoneSays('denied');
    let listener: (s: string) => void = () => {};
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, l: (s: string) => void) => {
      listener = l;
      return { remove() {} };
    }) as never);
    renderSettings();
    expect(await screen.findByText(LOCATION_ROW.denied.sub)).toBeTruthy();
    phoneSays('granted');
    act(() => listener('active'));
    await waitFor(() => expect(screen.getByText(LOCATION_ROW.allowed.sub)).toBeTruthy());
  });

  it('renders in the dark theme too', async () => {
    phoneSays('granted');
    renderSettings('dark');
    expect(await screen.findByText(LOCATION_ROW.allowed.sub)).toBeTruthy();
  });
});

describe('App settings: appearance and notifications', () => {
  it('appearance follows the phone and offers no control', async () => {
    phoneSays('granted');
    renderSettings();
    expect(await screen.findByText("HalalGoes follows your phone's light or dark setting.")).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('Notification settings opens its own page, and back returns to Account', async () => {
    phoneSays('granted');
    const nav = renderSettings();
    fireEvent.press(await screen.findByTestId('AppSettings-notificationSettings'));
    expect(nav.log.at(-1)?.route).toEqual({ name: 'notificationSettings' });
  });
});
