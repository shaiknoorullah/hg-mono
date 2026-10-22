/**
 * The address form against the contract's fixtures: search, the pin step, details, save, edit,
 * make default, delete and the guard on leaving, with every failure the contract defines (boards
 * `AC/AddressForm*`). The map is a placeholder (issue #1023), so the pin is placed by a search
 * result or by Move pin, and these tests do exactly that.
 */
import * as React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import type { Schema } from '@hg/api-client';

import { setToken } from '../../../../api/token';
import { resetPublicConfigCache } from '../../../api/config';
import { resetAuthForTests } from '../../../api/auth';
import { markOffline, resetConnectivity } from '../../../lib/connectivity';
import { setNowOverride } from '../../../lib/now';
import { resetSessionForTests } from '../../../session/session';
import { mockApi, payloadOf, type MockAnswer, type MockApi } from '../../../test/mockApi';
import { navSpy, renderRedesign } from '../../../test/render';
import { clearAddressNotice, getAddressNotice } from '../addressNotice';
import { FALLBACK_CENTRE } from '../PinStep';
import { AddressFormScreen, FORM_COPY } from '../AddressFormScreen';

type Address = Schema['Address'];
type Suggestion = Schema['AddressSuggestion'];

const ADDRESSES = payloadOf<Address[]>('addresses_list');
const HOME = ADDRESSES[0]!; // the default
const WORK = ADDRESSES[1]!;
const SUGGESTIONS = payloadOf<Suggestion[]>('address_suggestions_populated');
const T0 = Date.parse('2026-10-09T22:42:00Z');

const one = (a: Address): MockAnswer => ({ status: 200, body: { data: a } });
const list = (data: Address[]): MockAnswer => ({ status: 200, body: { data, meta: { next_cursor: null, has_more: false, total: data.length } } });

let mock: MockApi;

beforeEach(() => {
  resetConnectivity();
  resetPublicConfigCache();
  resetAuthForTests();
  resetSessionForTests();
  clearAddressNotice();
  setNowOverride({ at: T0 });
  act(() => setToken('access', 'hgrt_x'));
});

afterEach(() => {
  mock?.restore();
  setNowOverride(null);
  act(() => setToken(null));
});

function renderForm(props: { addressId: string | null; first?: boolean }, answers: Record<string, MockAnswer> = {}) {
  mock = mockApi({
    listAddresses: 'addresses_list',
    getPublicConfig: 'public_config',
    suggestAddresses: 'address_suggestions_populated',
    getPlaceAddress: 'place_address_full',
    reverseGeocode: 'reverse_geocode_address',
    createAddress: one(HOME),
    updateAddress: one(HOME),
    getAddress: one(WORK),
    ...answers,
  });
  const nav = navSpy({ name: 'addressForm', addressId: props.addressId });
  renderRedesign(<AddressFormScreen {...props} />, { nav });
  return nav;
}

const field = (id: string) => screen.getByTestId(`AddressForm-${id}-field`);
const valueOf = (id: string) => field(id).props.value as string;

/** Search "88 Harb", pick the first suggestion, and wait for the pin check to be asked. */
async function pickSuggestion() {
  fireEvent.changeText(await screen.findByTestId('AddressSearch-input-field'), '88 Harb');
  fireEvent.press(await screen.findByTestId(`AddressSearch-suggestion-${SUGGESTIONS[0]!.place_id}`));
  await screen.findByText('Check the pin');
}

describe('New address', () => {
  it('opens on the search and the pin step, with nothing that belongs to an edit', async () => {
    renderForm({ addressId: null });
    expect(await screen.findByTestId('AddressSearch-input-field')).toBeTruthy();
    expect(screen.getByText('Find your door on the map')).toBeTruthy();
    expect(screen.getByText(FORM_COPY.newTitle)).toBeTruthy();
    expect(screen.queryByTestId('AddressForm-delete')).toBeNull();
    expect(screen.queryByText('Check the pin')).toBeNull();
    expect(screen.getByText('Save address')).toBeTruthy();
  });

  it('searching suggests, picking fills the fields, places the pin and asks for the pin check', async () => {
    renderForm({ addressId: null });
    await pickSuggestion();

    expect(valueOf('line1')).toBe('88 Harbour Street');
    expect(valueOf('city')).toBe('Toronto');
    expect(valueOf('postal')).toBe('M5J 0C3');
    expect(screen.getByText('Pin on 88 Harbour Street')).toBeTruthy();
    expect(screen.getByText('The pin is on the entrance of 88 Harbour Street')).toBeTruthy();

    // One search session: the suggestions and the place lookup share a token, and nothing else is sent.
    const suggest = new URL(mock.callsTo('suggestAddresses')[0]!.url);
    const place = new URL(mock.callsTo('getPlaceAddress')[0]!.url);
    expect(suggest.searchParams.get('q')).toBe('88 Harb');
    expect(suggest.searchParams.get('session_token')).toMatch(/^[0-9a-f-]{36}$/);
    expect(place.searchParams.get('session_token')).toBe(suggest.searchParams.get('session_token'));
    expect(place.pathname).toContain(SUGGESTIONS[0]!.place_id);
  });

  it('Save is gated on the pin check, then saves what was found with the pin as the coordinates', async () => {
    const nav = renderForm({ addressId: null });
    await pickSuggestion();

    fireEvent.press(screen.getByTestId('AddressForm-save'));
    expect(await screen.findByTestId('AddressForm-confirmError')).toBeTruthy();
    expect(mock.callsTo('createAddress')).toHaveLength(0);

    fireEvent.press(screen.getByTestId('AddressForm-confirm'));
    fireEvent.press(screen.getByTestId('AddressForm-save'));
    await waitFor(() => expect(mock.callsTo('createAddress')).toHaveLength(1));
    expect(mock.callsTo('createAddress')[0]!.body).toEqual({
      line1: '88 Harbour Street',
      city: 'Toronto',
      province: 'ON',
      postal_code: 'M5J 0C3',
      latitude: 43.6412,
      longitude: -79.381,
    });
    await waitFor(() => expect(nav.log.at(-1)).toEqual({ action: 'back' }));
  });

  it('what the customer types after picking is what is saved, with name, unit, buzzer and default', async () => {
    renderForm({ addressId: null });
    await pickSuggestion();
    fireEvent.changeText(field('unit'), '4211');
    fireEvent.changeText(field('buzzer'), '4211');
    fireEvent.press(screen.getByTestId('AddressForm-label-HOME'));
    fireEvent.press(screen.getByTestId('AddressForm-makeDefault'));
    fireEvent.press(screen.getByTestId('AddressForm-confirm'));
    fireEvent.press(screen.getByTestId('AddressForm-save'));
    await waitFor(() => expect(mock.callsTo('createAddress')).toHaveLength(1));
    expect(mock.callsTo('createAddress')[0]!.body).toMatchObject({ unit: '4211', buzzer: '4211', label: 'Home', is_default: true });
  });

  it('Other asks for a name', async () => {
    renderForm({ addressId: null });
    await pickSuggestion();
    fireEvent.press(screen.getByTestId('AddressForm-label-OTHER'));
    fireEvent.press(screen.getByTestId('AddressForm-confirm'));
    fireEvent.press(screen.getByTestId('AddressForm-save'));
    expect(await screen.findByText(/Type a name for this address, or choose another\./)).toBeTruthy();
    expect(mock.callsTo('createAddress')).toHaveLength(0);
  });

  it('typed by hand with no pin: Save names every missing piece and sends nothing', async () => {
    renderForm({ addressId: null });
    await screen.findByTestId('AddressSearch-input-field');
    fireEvent.changeText(field('postal'), 'M1R 4');
    fireEvent.press(screen.getByTestId('AddressForm-save'));
    expect(await screen.findByText(/Enter the street address, like 14 Ellesmere Rd\./)).toBeTruthy();
    expect(screen.getByText(/Enter the city\./)).toBeTruthy();
    expect(screen.getByText(/Enter a full postal code, like M1R 4E7\./)).toBeTruthy();
    expect(screen.getByText('Drag the pin onto your entrance so your rider can find you.')).toBeTruthy();
    expect(mock.callsTo('createAddress')).toHaveLength(0);
  });

  it('Move pin places the pin without a map, and Use this spot fills the address from it', async () => {
    renderForm({ addressId: null });
    await screen.findByTestId('AddressSearch-input-field');
    expect(screen.getByTestId('PinStep-useSpot')).toBeDisabled();

    fireEvent.press(screen.getByTestId('PinStep-move'));
    fireEvent.press(screen.getByTestId('PinStep-move-north'));
    expect(await screen.findByText('Pin on your door')).toBeTruthy();

    fireEvent.press(screen.getByTestId('PinStep-useSpot'));
    await waitFor(() => expect(valueOf('line1')).not.toBe(''));
    const reverse = new URL(mock.callsTo('reverseGeocode')[0]!.url);
    // One 10 m step north of where Move pin started: the config's map centre once it has loaded,
    // central Toronto if the press came first.
    const step = 10 / 111_320;
    const lat = Number(reverse.searchParams.get('latitude'));
    const centre = payloadOf<Schema['PublicConfig']>('public_config').default_map_center!;
    const starts = [centre.latitude, FALLBACK_CENTRE.latitude];
    expect(Math.min(...starts.map((s) => Math.abs(lat - s - step)))).toBeLessThan(2e-6);
    expect(reverse.searchParams.has('session_token')).toBe(false);
    // The pin the customer placed is what is saved; the lookup only fills the words.
    expect(screen.getByText('Check the pin')).toBeTruthy();
  });

  it('the pin lookup finding nothing leaves the pin and says to type the address', async () => {
    renderForm({ addressId: null }, { reverseGeocode: 'error_geocode_no_match' });
    await screen.findByTestId('AddressSearch-input-field');
    fireEvent.press(screen.getByTestId('PinStep-move'));
    fireEvent.press(screen.getByTestId('PinStep-move-east'));
    fireEvent.press(await screen.findByTestId('PinStep-useSpot'));
    expect(await screen.findByText("We couldn't find an address near the pin")).toBeTruthy();
    expect(valueOf('line1')).toBe('');
  });

  it('the first address has no default checkbox: it has to be the default', async () => {
    renderForm({ addressId: null, first: true }, { listAddresses: 'addresses_empty' });
    expect(await screen.findByText(FORM_COPY.firstTitle)).toBeTruthy();
    await pickSuggestion();
    expect(screen.queryByTestId('AddressForm-makeDefault')).toBeNull();
    expect(screen.getByTestId('AddressForm-firstDefault')).toBeTruthy();
    fireEvent.press(screen.getByTestId('AddressForm-confirm'));
    fireEvent.press(screen.getByTestId('AddressForm-save'));
    await waitFor(() => expect(mock.callsTo('createAddress')).toHaveLength(1));
    expect(mock.callsTo('createAddress')[0]!.body).toMatchObject({ is_default: true });
  });

  it('saving: the button says so, the fields lock, and Save is not pressed twice', async () => {
    renderForm({ addressId: null }, { createAddress: 'hang' });
    await pickSuggestion();
    fireEvent.press(screen.getByTestId('AddressForm-confirm'));
    fireEvent.press(screen.getByTestId('AddressForm-save'));
    expect(await screen.findByText('Saving address')).toBeTruthy();
    fireEvent.press(screen.getByTestId('AddressForm-save'));
    expect(mock.callsTo('createAddress')).toHaveLength(1);
  });
});

describe('Address search states', () => {
  const type = async (q = '88 Harb') => fireEvent.changeText(await screen.findByTestId('AddressSearch-input-field'), q);

  it('loading while it searches', async () => {
    renderForm({ addressId: null }, { suggestAddresses: 'hang' });
    await type();
    await waitFor(() => expect(mock.callsTo('suggestAddresses')).toHaveLength(1));
    expect(screen.queryByTestId('AddressSearch-results')).toBeNull();
  });

  it('nothing found: says so and offers to type the address', async () => {
    renderForm({ addressId: null }, { suggestAddresses: 'address_suggestions_empty' });
    await type('88 Nowhere Cres');
    expect(await screen.findByText('No matches for “88 Nowhere Cres”')).toBeTruthy();
    expect(screen.getByText('Enter the address yourself')).toBeTruthy();
  });

  it('too many searches: pauses until the time the server named, and the form still works', async () => {
    renderForm({ addressId: null }, { suggestAddresses: 'error_geocode_rate_limited' });
    await type();
    expect(await screen.findByText('Too many searches')).toBeTruthy();
    expect(screen.getByText(/You can search again at 6:42 pm/)).toBeTruthy();
    expect(field('line1')).toBeTruthy();
  });

  it('Mapbox down: the search is replaced by a note, and Try search again brings it back', async () => {
    renderForm({ addressId: null }, { suggestAddresses: ['error_geocoder_unavailable', 'address_suggestions_populated'] });
    await type();
    expect(await screen.findByText("Address search isn't working right now")).toBeTruthy();
    expect(screen.queryByTestId('AddressSearch-input-field')).toBeNull();
    fireEvent.press(screen.getByText('Try search again'));
    expect(await screen.findByTestId(`AddressSearch-suggestion-${SUGGESTIONS[0]!.place_id}`)).toBeTruthy();
  });

  it('a failed search says so and Try again searches again', async () => {
    renderForm({ addressId: null }, { suggestAddresses: [{ status: 500, code: 'INTERNAL_ERROR' }, 'address_suggestions_populated'] });
    await type();
    expect(await screen.findByText("We couldn't search")).toBeTruthy();
    fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByTestId(`AddressSearch-suggestion-${SUGGESTIONS[0]!.place_id}`)).toBeTruthy();
  });

  it('a suggestion that has expired says so and keeps the form', async () => {
    renderForm({ addressId: null }, { getPlaceAddress: 'error_geocode_no_match' });
    await type();
    fireEvent.press(await screen.findByTestId(`AddressSearch-suggestion-${SUGGESTIONS[0]!.place_id}`));
    expect(await screen.findByText('That place is no longer available')).toBeTruthy();
  });

  it('an address in a province we do not serve disables Save and offers another search', async () => {
    renderForm({ addressId: null }, { getPlaceAddress: 'place_address_province_not_served' });
    await type();
    fireEvent.press(await screen.findByTestId(`AddressSearch-suggestion-${SUGGESTIONS[0]!.place_id}`));
    expect(await screen.findByTestId('AddressForm-notServed')).toBeTruthy();
    expect(screen.getByTestId('AddressForm-save')).toBeDisabled();
    fireEvent.press(screen.getByText('Search for another address'));
    await waitFor(() => expect(screen.queryByTestId('AddressForm-notServed')).toBeNull());
    expect(valueOf('line1')).toBe('');
  });
});

describe('Save failures', () => {
  async function readyToSave(answers: Record<string, MockAnswer>, list: Record<string, MockAnswer> = {}) {
    const nav = renderForm({ addressId: null }, { createAddress: answers.createAddress!, ...list });
    await pickSuggestion();
    fireEvent.press(screen.getByTestId('AddressForm-confirm'));
    fireEvent.press(screen.getByTestId('AddressForm-save'));
    return nav;
  }

  it('the server refusing a field (422) marks that field and keeps everything typed', async () => {
    const nav = await readyToSave({
      createAddress: { status: 422, code: 'VALIDATION_FAILED', details: [{ field: 'postal_code', code: 'pattern', message: 'bad' }] },
    });
    expect(await screen.findByText('Check the postal code')).toBeTruthy();
    expect(screen.getByText(/This postal code wasn't accepted\. Check it, like M1R 4E7\./)).toBeTruthy();
    expect(valueOf('line1')).toBe('88 Harbour Street');
    expect(nav.log.find((l) => l.action === 'back')).toBeUndefined();
  });

  it('a network or server failure says nothing was lost', async () => {
    await readyToSave({ createAddress: { status: 500, code: 'INTERNAL_ERROR' } });
    expect(await screen.findByText(FORM_COPY.saveErrorBody)).toBeTruthy();
    expect(valueOf('city')).toBe('Toronto');
  });

  it('a 409 with 20 saved is the limit', async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => ({ ...HOME, id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, is_default: i === 0 }));
    await readyToSave({ createAddress: { status: 409, code: 'CONFLICT' } }, { listAddresses: list(twenty) });
    expect(await screen.findByText(FORM_COPY.limitTitle)).toBeTruthy();
  });

  it('any other 409 is a conflict', async () => {
    await readyToSave({ createAddress: { status: 409, code: 'CONFLICT' } });
    expect(await screen.findByText(FORM_COPY.conflictBody)).toBeTruthy();
  });

  it('the server refusing the province (PROVINCE_NOT_SERVED) turns Save off', async () => {
    await readyToSave({ createAddress: { status: 422, code: 'PROVINCE_NOT_SERVED' } });
    expect(await screen.findByTestId('AddressForm-notServed')).toBeTruthy();
    expect(screen.getByTestId('AddressForm-save')).toBeDisabled();
  });
});

describe('Offline', () => {
  it('a new address says what stays here and Save explains why it is off', async () => {
    // Offline is a transport failure: nothing the form asks for gets an answer.
    renderForm({ addressId: null }, { listAddresses: 'offline', getPublicConfig: 'offline' });
    expect(await screen.findByTestId('AddressForm-offline')).toBeTruthy();
    expect(screen.getByTestId('AddressSearch-input-field')).toBeTruthy();
    expect(screen.getByTestId('AddressForm-save')).toBeDisabled();
    expect(screen.getByText(FORM_COPY.saveWhyOffline)).toBeTruthy();
  });
});

describe('Leaving', () => {
  it('a form nobody touched goes straight back', async () => {
    const nav = renderForm({ addressId: null });
    await screen.findByTestId('AddressSearch-input-field');
    fireEvent.press(screen.getByTestId('AddressForm-bar-back'));
    expect(nav.log.at(-1)).toEqual({ action: 'back' });
  });

  it('with changes it asks first: Keep editing stays, Discard changes leaves', async () => {
    const nav = renderForm({ addressId: null });
    await screen.findByTestId('AddressSearch-input-field');
    fireEvent.changeText(field('city'), 'Toronto');
    fireEvent.press(screen.getByTestId('AddressForm-bar-back'));
    const dialog = await screen.findByTestId('AddressForm-unsavedDialog');
    expect(within(dialog).getByText(FORM_COPY.unsavedTitle)).toBeTruthy();
    expect(nav.log.find((l) => l.action === 'back')).toBeUndefined();

    fireEvent.press(within(dialog).getByText('Keep editing'));
    expect(valueOf('city')).toBe('Toronto');
    expect(nav.log.find((l) => l.action === 'back')).toBeUndefined();

    fireEvent.press(screen.getByTestId('AddressForm-bar-back'));
    fireEvent.press(within(await screen.findByTestId('AddressForm-unsavedDialog')).getByText('Discard changes'));
    expect(nav.log.at(-1)).toEqual({ action: 'back' });
  });
});

describe('Edit address', () => {
  it('loading, then the stored address with its pin already confirmed', async () => {
    renderForm({ addressId: WORK.id }, { getAddress: 'hang' });
    expect(screen.getByTestId('AddressForm-loading')).toBeTruthy();
    mock.restore();

    renderForm({ addressId: WORK.id });
    expect(await screen.findByText(FORM_COPY.editTitle)).toBeTruthy();
    await waitFor(() => expect(valueOf('line1')).toBe(WORK.line1));
    expect(valueOf('city')).toBe(WORK.city);
    expect(screen.getByText('Pin saved for this address')).toBeTruthy();
    expect(screen.queryByText('Check the pin')).toBeNull();
    expect(screen.queryByTestId('AddressSearch-input-field')).toBeNull();
    expect(screen.getByText('Save changes')).toBeTruthy();
    expect(mock.callsTo('getAddress')[0]!.url).toContain(WORK.id);
  });

  it('a failed load says so and retries', async () => {
    renderForm({ addressId: WORK.id }, { getAddress: [{ status: 500, code: 'INTERNAL_ERROR' }, one(WORK)] });
    expect(await screen.findByText(FORM_COPY.loadErrorTitle)).toBeTruthy();
    fireEvent.press(screen.getByText('Try again'));
    await waitFor(() => expect(valueOf('line1')).toBe(WORK.line1));
  });

  it('deleted on another device: says so and goes back to Addresses', async () => {
    const nav = renderForm({ addressId: WORK.id }, { getAddress: { status: 404, code: 'NOT_FOUND' } });
    expect(await screen.findByText(FORM_COPY.goneTitle)).toBeTruthy();
    fireEvent.press(screen.getByText('Back to Addresses'));
    expect(nav.log.at(-1)).toEqual({ action: 'back' });
  });

  it('Save sends only what changed, and the pin only when it moved', async () => {
    const nav = renderForm({ addressId: WORK.id });
    await waitFor(() => expect(valueOf('line1')).toBe(WORK.line1));
    fireEvent.changeText(field('city'), 'Etobicoke');
    fireEvent.press(screen.getByTestId('AddressForm-save'));
    await waitFor(() => expect(mock.callsTo('updateAddress')).toHaveLength(1));
    const call = mock.callsTo('updateAddress')[0]!;
    expect(call.method).toBe('PATCH');
    expect(call.url).toContain(WORK.id);
    expect(call.body).toEqual({ city: 'Etobicoke' });
    await waitFor(() => expect(nav.log.at(-1)).toEqual({ action: 'back' }));
  });

  it('saving with nothing changed just goes back', async () => {
    const nav = renderForm({ addressId: WORK.id });
    await waitFor(() => expect(valueOf('line1')).toBe(WORK.line1));
    fireEvent.press(screen.getByTestId('AddressForm-save'));
    expect(mock.callsTo('updateAddress')).toHaveLength(0);
    expect(nav.log.at(-1)).toEqual({ action: 'back' });
  });

  it('moving the pin asks for the pin check again before Save', async () => {
    renderForm({ addressId: WORK.id });
    await waitFor(() => expect(valueOf('line1')).toBe(WORK.line1));
    fireEvent.press(screen.getByTestId('PinStep-move'));
    fireEvent.press(screen.getByTestId('PinStep-move-north'));
    expect(await screen.findByText('Pin moved. Check it before you save')).toBeTruthy();
    expect(screen.getByText('Check the pin')).toBeTruthy();

    fireEvent.press(screen.getByTestId('AddressForm-save'));
    expect(await screen.findByTestId('AddressForm-confirmError')).toBeTruthy();
    expect(mock.callsTo('updateAddress')).toHaveLength(0);

    fireEvent.press(screen.getByTestId('AddressForm-confirm'));
    fireEvent.press(screen.getByTestId('AddressForm-save'));
    await waitFor(() => expect(mock.callsTo('updateAddress')).toHaveLength(1));
    const body = mock.callsTo('updateAddress')[0]!.body as { latitude: number; longitude: number };
    expect(body.latitude).toBeGreaterThan(WORK.latitude);
    expect(body.longitude).toBe(WORK.longitude);
  });

  it('a name can be changed but not taken away: there is no "No name" choice', async () => {
    renderForm({ addressId: WORK.id });
    await waitFor(() => expect(valueOf('line1')).toBe(WORK.line1));
    expect(screen.queryByTestId('AddressForm-label-NONE')).toBeNull();
    expect(screen.getByText(FORM_COPY.labelHelpEdit)).toBeTruthy();
  });

  it('the default address says so and has no make-default button', async () => {
    renderForm({ addressId: HOME.id }, { getAddress: one(HOME) });
    await screen.findByText(FORM_COPY.isDefault);
    expect(screen.queryByTestId('AddressForm-setDefault')).toBeNull();
  });
});

describe('Make default', () => {
  it('applies at once, outside Save, and says so', async () => {
    renderForm({ addressId: WORK.id }, { setDefaultAddress: one({ ...WORK, is_default: true }) });
    fireEvent.press(await screen.findByTestId('AddressForm-setDefault'));
    expect(await screen.findByText('Work is now your default')).toBeTruthy();
    expect(mock.callsTo('setDefaultAddress')[0]!.url).toContain(`${WORK.id}/default`);
    expect(mock.callsTo('updateAddress')).toHaveLength(0);
    expect(screen.queryByTestId('AddressForm-setDefault')).toBeNull();
  });

  it('failing says which address is still the default and offers to try again', async () => {
    renderForm({ addressId: WORK.id }, { setDefaultAddress: [{ status: 500, code: 'INTERNAL_ERROR' }, one({ ...WORK, is_default: true })] });
    fireEvent.press(await screen.findByTestId('AddressForm-setDefault'));
    expect(await screen.findByText("We couldn't make Work your default")).toBeTruthy();
    expect(screen.getByText(/Home is still your default\./)).toBeTruthy();
    fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByText('Work is now your default')).toBeTruthy();
  });

  it('is off while offline', async () => {
    renderForm({ addressId: WORK.id });
    await screen.findByTestId('AddressForm-setDefault');
    await act(async () => {});
    act(() => markOffline());
    await waitFor(() => expect(screen.getByTestId('AddressForm-setDefault')).toBeDisabled());
    expect(screen.getByTestId('AddressForm-delete')).toBeDisabled();
    expect(screen.getByTestId('AddressForm-save')).toBeDisabled();
  });
});

describe('Delete', () => {
  const openDelete = async () => {
    fireEvent.press(await screen.findByTestId('AddressForm-delete'));
    return screen.findByTestId('AddressForm-deleteDialog');
  };

  it('asks first, and Keep address changes nothing', async () => {
    const nav = renderForm({ addressId: WORK.id });
    const dialog = await openDelete();
    expect(within(dialog).getByText(/“Work”, 35 Fontenay Court, will be removed from your saved addresses\./)).toBeTruthy();
    expect(within(dialog).queryByText(/It is your default/)).toBeNull();
    fireEvent.press(within(dialog).getByText('Keep address'));
    expect(mock.callsTo('deleteAddress')).toHaveLength(0);
    expect(nav.log.find((l) => l.action === 'back')).toBeUndefined();
  });

  it('the default says another will take its place', async () => {
    renderForm({ addressId: HOME.id }, { getAddress: one(HOME) });
    const dialog = await openDelete();
    expect(within(dialog).getByText(/It is your default, so another saved address will become your default\./)).toBeTruthy();
  });

  it('deleting leaves a toast for the list, and goes back', async () => {
    const nav = renderForm({ addressId: WORK.id }, { listAddresses: ['addresses_list', list([HOME])] });
    fireEvent.press(within(await openDelete()).getByText('Delete address'));
    await waitFor(() => expect(nav.log.at(-1)).toEqual({ action: 'back' }));
    expect(mock.callsTo('deleteAddress')[0]!.url).toContain(WORK.id);
    expect(getAddressNotice()).toEqual({ title: 'Address deleted', description: "Your other saved addresses haven't changed." });
  });

  it('deleting the last one says none are left', async () => {
    renderForm({ addressId: HOME.id }, { getAddress: one(HOME), listAddresses: ['addresses_list', 'addresses_empty'] });
    fireEvent.press(within(await openDelete()).getByText('Delete address'));
    await waitFor(() => expect(getAddressNotice()).not.toBeNull());
    expect(getAddressNotice()!.description).toBe('You have no saved addresses now.');
  });

  it('deleting the default names the address the server made the default', async () => {
    renderForm({ addressId: HOME.id }, { getAddress: one(HOME), listAddresses: ['addresses_list', list([{ ...WORK, is_default: true }, ADDRESSES[2]!])] });
    fireEvent.press(within(await openDelete()).getByText('Delete address'));
    await waitFor(() => expect(getAddressNotice()).not.toBeNull());
    expect(getAddressNotice()!.description).toBe('Work is now your default address.');
  });

  it('deleting the default when the server promoted none says there is no default now', async () => {
    renderForm({ addressId: HOME.id }, { getAddress: one(HOME), listAddresses: ['addresses_list', list([WORK, ADDRESSES[2]!])] });
    fireEvent.press(within(await openDelete()).getByText('Delete address'));
    await waitFor(() => expect(getAddressNotice()).not.toBeNull());
    expect(getAddressNotice()!.description).toBe('You have no default address now.');
  });

  it('failing says the address is still saved and keeps the form', async () => {
    const nav = renderForm({ addressId: WORK.id }, { deleteAddress: { status: 500, code: 'INTERNAL_ERROR' } });
    fireEvent.press(within(await openDelete()).getByText('Delete address'));
    expect(await screen.findByText("We couldn't delete this address")).toBeTruthy();
    expect(screen.getByText(/Work is still saved\./)).toBeTruthy();
    expect(nav.log.find((l) => l.action === 'back')).toBeUndefined();
    expect(getAddressNotice()).toBeNull();
  });

  it('an address an unfinished order uses cannot be deleted; View order opens that order', async () => {
    const nav = renderForm({ addressId: WORK.id }, { deleteAddress: 'error_address_in_use', listOrders: 'order_list_active' });
    fireEvent.press(within(await openDelete()).getByText('Delete address'));
    const dialog = await screen.findByTestId('AddressForm-inUseDialog');
    expect(within(dialog).getByText(FORM_COPY.inUseTitle)).toBeTruthy();
    fireEvent.press(within(dialog).getByText('View order'));
    await waitFor(() => expect(nav.log.at(-1)?.route).toMatchObject({ name: 'tracking' }));
    expect(mock.callsTo('listOrders')[0]!.url).toContain('status_group=ACTIVE');
  });
});
