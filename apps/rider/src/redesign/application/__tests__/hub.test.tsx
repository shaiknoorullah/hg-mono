/**
 * WP7 R04 hub (the `application` flow host) and R13 closed, against the contract's fixtures,
 * light and dark: welcome, in progress, loading, error, offline, the hand-off to the steps other
 * WPs own, the terms links (only with WP9's legal screen), and the closed application.
 */
import './mocks';

import { Linking } from 'react-native';
import { act, screen, waitFor } from '@testing-library/react-native';

import { getToken } from '../../../token';
import { reportTransportFailure } from '../../data/connectivity';
import { handleBack } from '../../nav/Navigator';
import { screenFor } from '../../nav/registry';
import { SCHEMES } from '../../test/render';
import { apiError, press, route, scooterDocs, start, status, stop } from './harness';

afterEach(stop);

describe.each(SCHEMES)('application hub (%s)', (scheme) => {
  it('loading: skeletons and a status line, nothing else', async () => {
    start({ scheme, api: { getRiderOnboardingStatus: 'pending' } });
    expect(await screen.findByText('Loading your application')).toBeTruthy();
    expect(screen.queryByText('Apply to ride')).toBeNull();
    expect(screen.queryByTestId('tab-home')).toBeNull(); // a flow: no BottomNav
  });

  it('welcome (PHONE_VERIFIED): the five-row plan, the terms line, Start with your details', async () => {
    const api = start({ scheme, api: { getRiderOnboardingStatus: 'rider_onboarding_phone_verified' } });
    expect(await screen.findByText('Apply to ride')).toBeTruthy();
    expect(screen.getByText('Four things to do, and one check by our team.')).toBeTruthy();
    expect(screen.getByText('Step 1 of 5: your details')).toBeTruthy();
    expect(screen.getByText('10% done')).toBeTruthy(); // the server's percent, never computed
    for (const t of ['Your details', 'How you deliver', 'Documents', 'We check your documents', 'Payouts']) {
      expect(screen.getByText(t)).toBeTruthy();
    }
    expect(screen.getByText('A person checks each one, usually within 72 hours')).toBeTruthy();
    expect(screen.getByText('By continuing you agree to the rider terms and privacy notice.')).toBeTruthy();
    // WP9's legal document screen is not registered on this build: no links.
    expect(screen.queryByText('Read the rider terms')).toBeNull();
    expect(screen.queryByText(/verif/i)).toBeNull(); // "verified" is reserved for halal
    expect(screen.getByText('Call support')).toBeTruthy();
    expect(api.callsTo('getRiderOnboardingStatus')).toHaveLength(1);

    await press('application-next');
    expect(await screen.findByText('Tell us who you are')).toBeTruthy();
  });

  it('welcome with WP9 registered: Read the rider terms / privacy notice open the legal document', async () => {
    start({ scheme, wp9: true, api: { getRiderOnboardingStatus: 'rider_onboarding_phone_verified' } });
    await screen.findByText('Read the rider terms');
    await press('read-terms');
    expect(route()).toBe('legalDocument {"doc":"terms"}');
  });

  it('in progress (vehicle next): details Done with the name, Continue with how you deliver', async () => {
    start({
      scheme,
      me: { first_name: 'Yusuf', last_name: 'Ahmed', next_route: 'ONBOARDING_VEHICLE', onboarding_state: 'VEHICLE_PENDING' },
      api: { getRiderOnboardingStatus: 'rider_onboarding_vehicle_pending' },
    });
    expect(await screen.findByText('Finish your application')).toBeTruthy();
    expect(screen.getByText('Step 2 of 5: how you deliver')).toBeTruthy();
    expect(screen.getByText('Yusuf Ahmed')).toBeTruthy();
    expect(screen.getAllByText('Done')).toHaveLength(1);
    expect(screen.getByText('Car, scooter, motorcycle, bicycle or on foot · you are here')).toBeTruthy();
    expect(screen.getAllByText('Not started')).toHaveLength(3);
    await press('application-next');
    expect(await screen.findByText(/How will you deliver\?/)).toBeTruthy();
  });

  it('in progress (documents next): the vehicle and plate, "2 of 4 added", Continue with documents', async () => {
    start({
      scheme,
      me: {
        first_name: 'Yusuf',
        last_name: 'Ahmed',
        next_route: 'ONBOARDING_DOCUMENTS',
        vehicle: { ...{ id: 'v-1', make: null, model: null, year: null, colour: null, is_active: true }, vehicle_type: 'SCOOTER', licence_plate: 'CJRA 204' },
      },
      api: {
        getRiderOnboardingStatus: status('rider_onboarding_documents_pending', {
          progress_percent: 40,
          documents: scooterDocs().filter((d) => (d as { doc_type: string }).doc_type !== 'PROFILE_PHOTO'),
        }),
      },
    });
    expect(await screen.findByText('Step 3 of 5: documents')).toBeTruthy();
    expect(screen.getByText('40% done')).toBeTruthy();
    expect(screen.getByText('Scooter · CJRA 204')).toBeTruthy();
    expect(screen.getByText('2 of 4 added · you are here')).toBeTruthy();
    expect(screen.getAllByText('Done')).toHaveLength(2);
    // A done row reopens its step.
    await press('plan-row-2');
    expect(await screen.findByText('About your scooter')).toBeTruthy();
  });

  it('documents next: Continue with documents opens the documents step (WP8)', async () => {
    start({ scheme, me: { next_route: 'ONBOARDING_DOCUMENTS' }, api: { getRiderOnboardingStatus: 'rider_onboarding_documents_pending' } });
    await screen.findByText('Continue with documents');
    await press('application-next');
    expect(route()).toBe('applicationDocuments null');
  });

  it('error: "We couldn\'t load your application", Try again reloads', async () => {
    const api = start({
      scheme,
      api: { getRiderOnboardingStatus: (_c, nth) => (nth === 0 ? apiError(500, 'INTERNAL_ERROR', 'Something went wrong on our side.') : 'rider_onboarding_phone_verified') },
    });
    expect(await screen.findByText("We couldn't load your application")).toBeTruthy();
    expect(screen.getByText('Your progress is saved on our side. Try again to pick up where you left off.')).toBeTruthy();
    await press('retry');
    expect(await screen.findByText('Apply to ride')).toBeTruthy();
    expect(api.callsTo('getRiderOnboardingStatus')).toHaveLength(2);
  });

  it('offline: the plan stays readable under "You are offline"', async () => {
    start({
      scheme,
      me: { next_route: 'ONBOARDING_DOCUMENTS' },
      api: { getRiderOnboardingStatus: 'rider_onboarding_documents_pending' },
    });
    await screen.findByText('Finish your application');
    act(() => reportTransportFailure());
    expect(screen.getByText('You are offline')).toBeTruthy();
    expect(screen.getByText('Your progress is saved. You can look around, but nothing new is sent until you are back online.')).toBeTruthy();
    expect(screen.getByText('Finish your application')).toBeTruthy();
  });

  it.each([
    ['rider_onboarding_documents_review', 'applicationReview null'],
    ['rider_onboarding_documents_rejected', 'applicationFix null'],
  ])('next_step from %s hands over to %s', async (scenario, shown) => {
    start({ scheme, api: { getRiderOnboardingStatus: scenario } });
    await waitFor(() => expect(route()).toBe(shown));
  });

  it('payouts next with WP9 registered: hands over to Payouts in its application context', async () => {
    start({ scheme, wp9: true, api: { getRiderOnboardingStatus: 'rider_onboarding_payout_pending' } });
    await waitFor(() => expect(route()).toBe('payouts {"context":"application"}'));
  });

  it('Android Back on the hub is swallowed (the flow closes itself)', async () => {
    start({ scheme, api: { getRiderOnboardingStatus: 'rider_onboarding_phone_verified' } });
    await screen.findByText('Apply to ride');
    expect(screenFor('application')?.back).toBe('none');
    expect(handleBack({ current: { name: 'application' } } as never)).toBe(true);
  });
});

describe.each(SCHEMES)('application closed (%s)', (scheme) => {
  it('DEACTIVATED: facts only, Call support with hours, Sign out', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    start({ scheme, api: { getRiderOnboardingStatus: status('rider_onboarding_documents_rejected', { account_status: 'DEACTIVATED', attempt_number: 4 }) } });
    expect(await screen.findByText('Your application is closed')).toBeTruthy();
    expect(screen.getByText('Only our support team can reopen it.')).toBeTruthy();
    expect(screen.getByTestId('support-hours')).toBeTruthy();
    await press('call-support');
    expect(open).toHaveBeenCalledWith('tel:+18005550199');
    await press('sign-out');
    expect(getToken()).toBeNull();
    expect(route()).toBe('signIn {}');
    open.mockRestore();
  });

  it('403 ACCOUNT_NOT_ACTIVE on the status is the closed screen too', async () => {
    start({ scheme, api: { getRiderOnboardingStatus: apiError(403, 'ACCOUNT_NOT_ACTIVE', 'This account is not active.') } });
    expect(await screen.findByText('Your application is closed')).toBeTruthy();
  });
});
