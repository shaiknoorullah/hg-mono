/**
 * WP7 R07 How you deliver (step 2), light and dark: all five vehicle types, nothing chosen,
 * switching to a bicycle (plate fields cleared and never sent), plate required, year before
 * 1990, 409 PLATE_IN_USE, 422 FIELD_REQUIRED / FIELD_NOT_APPLICABLE, 5xx, saving, loading,
 * offline, and changing type after documents were added. Asserts the exact RiderVehicleInput.
 */
import './mocks';

import { Linking } from 'react-native';
import { act, screen } from '@testing-library/react-native';

import { reportTransportFailure } from '../../data/connectivity';
import { SCHEMES } from '../../test/render';
import { apiError, bodies, openVehicle, press, route, scooterDocs, start, status, stop, type } from './harness';

afterEach(stop);

const AT_VEHICLE = { first_name: 'Yusuf', last_name: 'Ahmed', next_route: 'ONBOARDING_VEHICLE', onboarding_state: 'VEHICLE_PENDING' };
const VEHICLE_STEP = { getRiderOnboardingStatus: 'rider_onboarding_vehicle_pending' };

function err(text: string) {
  return screen.getByText(text, { exact: false });
}

describe.each(SCHEMES)('how you deliver (%s)', (scheme) => {
  it('loading: "Loading your vehicle"', async () => {
    start({ scheme, me: AT_VEHICLE, api: { getRiderOnboardingStatus: (_c, nth) => (nth === 0 ? 'rider_onboarding_vehicle_pending' : 'pending') } });
    await screen.findByText('Continue with how you deliver');
    await press('application-next');
    expect(await screen.findByText('Loading your vehicle')).toBeTruthy();
  });

  it('nothing chosen: five roomy options; Continue asks for one and sends nothing', async () => {
    const api = start({ scheme, me: AT_VEHICLE, api: VEHICLE_STEP });
    await openVehicle();
    expect(screen.getByText('Step 2 of 5: how you deliver')).toBeTruthy();
    expect(screen.getByLabelText('Back to your application')).toBeTruthy();
    for (const label of ['Car', 'Scooter', 'Motorcycle', 'Bicycle', 'On foot']) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getAllByText('Licence, registration, insurance and a photo of you')).toHaveLength(3);
    expect(screen.getAllByText('Government ID and a photo of you')).toHaveLength(2);
    expect(screen.queryByText(/About your/)).toBeNull();
    await press('vehicle-continue');
    expect(screen.getByText('Choose how you will deliver')).toBeTruthy();
    expect(screen.getByText('It decides which documents we ask for.')).toBeTruthy();
    expect(err('Choose one to continue.')).toBeTruthy();
    expect(api.callsTo('submitRiderVehicle')).toHaveLength(0);
  });

  it.each([
    ['CAR', 'About your car'],
    ['MOTORCYCLE', 'About your motorcycle'],
  ])('%s shows "%s" with the plate and optional fields', async (value, heading) => {
    start({ scheme, me: AT_VEHICLE, api: VEHICLE_STEP });
    await openVehicle();
    await press(`vehicle-${value}`);
    expect(screen.getByText(heading)).toBeTruthy();
    for (const id of ['vehicle-plate', 'vehicle-make', 'vehicle-model', 'vehicle-year', 'vehicle-colour']) expect(screen.getByTestId(id)).toBeTruthy();
  });

  it('scooter with a plate: sends the exact RiderVehicleInput, then documents', async () => {
    start({ scheme, me: AT_VEHICLE, api: VEHICLE_STEP });
    await openVehicle();
    await press('vehicle-SCOOTER');
    expect(screen.getByText('About your scooter')).toBeTruthy();
    type('vehicle-plate', 'cjra 204');
    type('vehicle-make', 'Honda');
    type('vehicle-year', '2021');
    await press('vehicle-continue');
    expect(await screen.findByTestId('route')).toBeTruthy();
    expect(route()).toBe('applicationDocuments null');
    expect(bodies('submitRiderVehicle')).toEqual([{ vehicle_type: 'SCOOTER', licence_plate: 'CJRA 204', make: 'Honda', year: 2021 }]);
  });

  it.each(['BICYCLE', 'ON_FOOT'])('%s sends the type alone', async (value) => {
    start({ scheme, me: AT_VEHICLE, api: { ...VEHICLE_STEP, submitRiderVehicle: 'rider_vehicle_on_foot' } });
    await openVehicle();
    await press(`vehicle-${value}`);
    expect(screen.queryByTestId('vehicle-plate')).toBeNull();
    await press('vehicle-continue');
    await screen.findByTestId('route');
    expect(bodies('submitRiderVehicle')).toEqual([{ vehicle_type: value }]);
  });

  it('switched to a bicycle: plate and scooter details cleared, said so, and never sent', async () => {
    start({ scheme, me: AT_VEHICLE, api: { ...VEHICLE_STEP, submitRiderVehicle: 'rider_vehicle_on_foot' } });
    await openVehicle();
    await press('vehicle-SCOOTER');
    type('vehicle-plate', 'CJRA 204');
    type('vehicle-make', 'Honda');
    await press('vehicle-BICYCLE');
    expect(screen.getByText('We cleared your plate and scooter details')).toBeTruthy();
    expect(screen.getByText("Bicycles don't need them, so they won't be sent.")).toBeTruthy();
    await press('vehicle-SCOOTER');
    expect(screen.getByTestId('vehicle-plate-field').props.value).toBe('');
    await press('vehicle-BICYCLE');
    await press('vehicle-continue');
    await screen.findByTestId('route');
    expect(bodies('submitRiderVehicle')).toEqual([{ vehicle_type: 'BICYCLE' }]);
  });

  it('plate required: no plate for a scooter is caught before sending', async () => {
    const api = start({ scheme, me: AT_VEHICLE, api: VEHICLE_STEP });
    await openVehicle();
    await press('vehicle-SCOOTER');
    await press('vehicle-continue');
    expect(err('Enter the plate on your scooter, 2 to 8 letters and numbers.')).toBeTruthy();
    expect(screen.getByText('Scooters need a licence plate. We check it against your registration.')).toBeTruthy();
    expect(api.callsTo('submitRiderVehicle')).toHaveLength(0);
  });

  it('year before 1990 is caught before sending', async () => {
    const api = start({ scheme, me: AT_VEHICLE, api: VEHICLE_STEP });
    await openVehicle();
    await press('vehicle-SCOOTER');
    type('vehicle-plate', 'CJRA 204');
    type('vehicle-year', '1985');
    await press('vehicle-continue');
    expect(err('Enter a year from 1990 on, like 2021.')).toBeTruthy();
    expect(api.callsTo('submitRiderVehicle')).toHaveLength(0);
  });

  it("409 PLATE_IN_USE: the plate error and \"It's my vehicle: call support\" with the hours", async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    start({ scheme, me: AT_VEHICLE, api: { ...VEHICLE_STEP, submitRiderVehicle: apiError(409, 'PLATE_IN_USE', 'Licence plate is already registered to another vehicle.') } });
    await openVehicle();
    await press('vehicle-SCOOTER');
    type('vehicle-plate', 'CJRA 204');
    await press('vehicle-continue');
    expect(await screen.findByText("This plate is on another rider's account. Check it matches your registration.", { exact: false })).toBeTruthy();
    expect(screen.getByTestId('support-hours')).toBeTruthy();
    await press('its-my-vehicle');
    expect(open).toHaveBeenCalledWith('tel:+18005550199');
    open.mockRestore();
  });

  it('422 FIELD_REQUIRED from the server shows the plate error', async () => {
    start({ scheme, me: AT_VEHICLE, api: { ...VEHICLE_STEP, submitRiderVehicle: apiError(422, 'FIELD_REQUIRED', 'licence_plate is required for motorised vehicles.') } });
    await openVehicle();
    await press('vehicle-CAR');
    type('vehicle-plate', 'AB12');
    await press('vehicle-continue');
    expect(await screen.findByText('Enter the plate on your car, 2 to 8 letters and numbers.', { exact: false })).toBeTruthy();
  });

  it('422 FIELD_NOT_APPLICABLE: "We couldn\'t save your vehicle", details removed, Try again', async () => {
    const api = start({
      scheme,
      me: AT_VEHICLE,
      api: {
        ...VEHICLE_STEP,
        submitRiderVehicle: (_c, nth) =>
          nth === 0 ? apiError(422, 'FIELD_NOT_APPLICABLE', 'licence_plate is not applicable for this vehicle type.', [{ field: 'licence_plate', code: 'not_applicable', message: 'x' }]) : 'rider_vehicle_on_foot',
      },
    });
    await openVehicle();
    await press('vehicle-BICYCLE');
    await press('vehicle-continue');
    expect(await screen.findByText("We couldn't save your vehicle")).toBeTruthy();
    expect(screen.getByText("Bicycles don't take a plate or vehicle details. We removed them. Try again.")).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
    await press('vehicle-continue');
    await screen.findByTestId('route');
    expect(bodies('submitRiderVehicle')).toEqual([{ vehicle_type: 'BICYCLE' }, { vehicle_type: 'BICYCLE' }]);
    expect(api.callsTo('submitRiderVehicle')).toHaveLength(2);
  });

  it('5xx: "Your choice is still here", Try again resends', async () => {
    start({ scheme, me: AT_VEHICLE, api: { ...VEHICLE_STEP, submitRiderVehicle: (_c, nth) => (nth === 0 ? 'error_internal_error' : 'rider_vehicle_scooter') } });
    await openVehicle();
    await press('vehicle-SCOOTER');
    type('vehicle-plate', 'CJRA 204');
    await press('vehicle-continue');
    expect(await screen.findByText('Something went wrong on our side. Your choice is still here.')).toBeTruthy();
    await press('vehicle-continue');
    await screen.findByTestId('route');
    const sent = bodies('submitRiderVehicle');
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
  });

  it('saving: busy, the choice locked', async () => {
    start({ scheme, me: AT_VEHICLE, api: { ...VEHICLE_STEP, submitRiderVehicle: 'pending' } });
    await openVehicle();
    await press('vehicle-BICYCLE');
    await press('vehicle-continue');
    expect(screen.getByTestId('vehicle-continue').props.accessibilityState).toMatchObject({ busy: true });
  });

  it('offline: the choice stays, Continue is off and nothing is sent', async () => {
    const api = start({ scheme, me: AT_VEHICLE, api: VEHICLE_STEP });
    await openVehicle();
    await press('vehicle-BICYCLE');
    act(() => reportTransportFailure());
    expect(screen.getByText('Your choice is kept on this phone. Continue works again once you are back online.')).toBeTruthy();
    await press('vehicle-continue');
    expect(api.callsTo('submitRiderVehicle')).toHaveLength(0);
  });

  it('changing type after documents were added asks first; Keep leaves it, Change switches', async () => {
    start({
      scheme,
      me: {
        ...AT_VEHICLE,
        next_route: 'ONBOARDING_DOCUMENTS',
        vehicle: { id: 'v-1', vehicle_type: 'SCOOTER', licence_plate: 'CJRA 204', make: 'Honda', model: null, year: null, colour: null, is_active: true },
      },
      api: { getRiderOnboardingStatus: status('rider_onboarding_documents_pending', { documents: scooterDocs() }) },
    });
    await screen.findByText('Continue with documents');
    await press('plan-row-2');
    await screen.findByText('About your scooter');
    expect(screen.getByText('You added 3 documents for a scooter.')).toBeTruthy();
    expect(screen.getByTestId('vehicle-plate-field').props.value).toBe('CJRA 204');

    await press('vehicle-BICYCLE');
    expect(screen.getByText('Change to a bicycle?')).toBeTruthy();
    expect(
      screen.getByText("Bicycles need a government ID and a photo of you. Your licence, registration and insurance won't be sent for review. Your photo of you stays."),
    ).toBeTruthy();
    await press('vehicle-change-keep');
    expect(screen.queryByText('Change to a bicycle?')).toBeNull();
    expect(screen.getByText('About your scooter')).toBeTruthy();

    await press('vehicle-BICYCLE');
    await press('vehicle-change-confirm');
    expect(screen.queryByText('About your scooter')).toBeNull();
    expect(screen.getByText('We cleared your plate and scooter details')).toBeTruthy();
    // Going back to a motorised vehicle asks again.
    await press('vehicle-CAR');
    expect(screen.getByText('Change to a car?')).toBeTruthy();
  });
});
