/**
 * WP8 R10 notifications ask and R11 Review, light and dark: the ask after a successful submit
 * (turn on, not now, no support), and Review's states per RiderOnboardingState and
 * KycDocumentState: sent, waiting, notifications off, reconnecting (a failed re-read), partial,
 * a row turned down live, slow (past 72 h), approved, error, and the hand-over to Fix.
 */
import './mocks';

import { AppState, Linking } from 'react-native';
import { act, screen, waitFor, within } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';

import { registerForPush } from '../../../push';
import { SCHEMES } from '../../test/render';
import { REVIEW_POLL_MS } from '../data';
import { apiError, docs, hoursAgo, openDocuments, press, route, scooterSet, start, status, stop } from './harness';

afterEach(() => {
  jest.restoreAllMocks();
  (registerForPush as jest.Mock).mockClear();
  stop();
});

const REVIEW_ME = { next_route: 'ONBOARDING_AWAITING_REVIEW', onboarding_state: 'DOCUMENTS_REVIEW' };

function review(over: Record<string, unknown> = {}) {
  return status('rider_onboarding_documents_review', { submitted_at: hoursAgo(1), ...over });
}

function set(states: Record<string, string>) {
  return docs(...scooterSet().map((d) => ({ ...d, state: states[d.doc_type as string] ?? 'IN_REVIEW' })));
}

function openReview(scheme: 'light' | 'dark', api: Record<string, unknown>, extra: { payouts?: boolean } = {}) {
  return start({ scheme, me: REVIEW_ME, payouts: extra.payouts, api: { getRiderOnboardingStatus: review(), listRiderDocuments: set({}), ...(api as object) } });
}

function row(type: string) {
  return within(screen.getByTestId(`review-row-${type}`));
}

describe.each(SCHEMES)('notifications ask (%s)', (scheme) => {
  async function submitted(api: Record<string, unknown> = {}) {
    start({
      scheme,
      api: {
        getRiderOnboardingStatus: (_c: unknown, nth: number) => (nth === 0 ? 'rider_onboarding_documents_pending' : review()),
        listRiderDocuments: (_c: unknown, nth: number) => (nth === 0 ? docs(...scooterSet()) : set({})),
        submitRiderDocuments: 'rider_onboarding_documents_review',
        ...(api as object),
      },
    });
    await openDocuments();
    await press('documents-submit');
    await screen.findByText('Get told when we decide on your application');
  }

  it('after the set is sent: "Your documents are sent"; Turn on notifications registers the device, then Review', async () => {
    await submitted();
    expect(screen.getByText('A person will check them.')).toBeTruthy();
    expect(
      screen.getByText('Turn on notifications so we can reach you. Once you ride, delivery offers also come this way when the app is closed. Either choice leaves your documents sent.'),
    ).toBeTruthy();
    expect(screen.getByText('Call support')).toBeTruthy();
    await press('notify-on');
    expect(registerForPush).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("We're checking your documents")).toBeTruthy();
  });

  it('Not now goes to Review without asking the phone', async () => {
    await submitted();
    await press('notify-not-now');
    expect(await screen.findByText("We're checking your documents")).toBeTruthy();
    expect(registerForPush).not.toHaveBeenCalled();
  });

  it('support off: "Support isn\'t available right now."', async () => {
    await submitted({ getPublicConfig: status('public_config', { support_enabled: false }) });
    expect(screen.getByText("Support isn't available right now.")).toBeTruthy();
    expect(screen.queryByText('Call support')).toBeNull();
  });
});

describe.each(SCHEMES)('review (%s)', (scheme) => {
  it('sent: every row Sent, the 12-hour sent time, "You can close the app"', async () => {
    const api = openReview(scheme, { listRiderDocuments: set({ DRIVERS_LICENCE: 'SUBMITTED', VEHICLE_REGISTRATION: 'SUBMITTED', VEHICLE_INSURANCE: 'SUBMITTED', PROFILE_PHOTO: 'SUBMITTED' }) });
    expect(await screen.findByText('Your documents are sent')).toBeTruthy();
    expect(screen.getByText("They're waiting for a person to pick them up. We aim to decide within 72 hours.")).toBeTruthy();
    expect(screen.getByText('Step 4 of 5: we check your documents')).toBeTruthy();
    expect(screen.getByText('70% done')).toBeTruthy(); // the server's percent
    expect(screen.getAllByText('Sent')).toHaveLength(5); // four rows and the "Sent" label
    expect(within(screen.getByTestId('review-sent-at')).getByText(/^\w+day \d+ \w+ \d{4}, \d{1,2}:\d{2} (am|pm)$/)).toBeTruthy();
    expect(screen.getByText("We'll send you a notification when we decide.")).toBeTruthy();
    expect(screen.getByText("You can close the app. You can't go online until your documents are approved.")).toBeTruthy();
    expect(screen.queryByText(/verif/i)).toBeNull();
    expect(api.callsTo('listRiderDocuments').length).toBeGreaterThan(0);
  });

  it('waiting: In review on each row', async () => {
    openReview(scheme, {});
    expect(await screen.findByText("We're checking your documents")).toBeTruthy();
    expect(screen.getByText('A person checks every document. We aim to decide within 72 hours.')).toBeTruthy();
    expect(screen.getAllByText('In review')).toHaveLength(4);
  });

  it('partial: "2 of 4 checked so far.", Approved keeps its rows', async () => {
    openReview(scheme, { listRiderDocuments: set({ DRIVERS_LICENCE: 'APPROVED', VEHICLE_REGISTRATION: 'APPROVED' }) });
    expect(await screen.findByText('2 of 4 checked so far.')).toBeTruthy();
    expect(row('DRIVERS_LICENCE').getByText('Approved')).toBeTruthy();
    expect(row('VEHICLE_INSURANCE').getByText('In review')).toBeTruthy();
  });

  it('a row turned down live: "needs a new upload", and no Fix button until the server decides', async () => {
    openReview(scheme, { listRiderDocuments: set({ DRIVERS_LICENCE: 'APPROVED', VEHICLE_REGISTRATION: 'REJECTED', VEHICLE_INSURANCE: 'APPROVED' }) });
    expect(await screen.findByText('3 of 4 checked so far.')).toBeTruthy();
    expect(screen.getByText("Vehicle registration needs a new upload. You can fix it once we've finished checking the rest.")).toBeTruthy();
    expect(row('VEHICLE_REGISTRATION').getByText('New upload needed')).toBeTruthy();
    expect(screen.queryByText('Take a new photo')).toBeNull();
  });

  it('notifications off: the alert and Open settings', async () => {
    jest.spyOn(Notifications, 'getPermissionsAsync').mockResolvedValue({ granted: false, canAskAgain: false, status: 'denied' } as never);
    const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    openReview(scheme, {});
    expect(await screen.findByText('Notifications are off')).toBeTruthy();
    expect(screen.getByText('When you open the app, this screen shows the decision. Turn notifications on in Settings to hear about it straight away.')).toBeTruthy();
    expect(screen.queryByText("We'll send you a notification when we decide.")).toBeNull();
    await press('open-settings');
    expect(settings).toHaveBeenCalled();
  });

  it('slow (past 72 hours): "This is taking longer than usual", Call support with the hours', async () => {
    openReview(scheme, { getRiderOnboardingStatus: review({ submitted_at: hoursAgo(80) }) });
    expect(await screen.findByText('This is taking longer than usual')).toBeTruthy();
    expect(screen.getByText("We aim to decide within 72 hours, and yours has taken longer. Your documents are still with us. You don't need to send them again.")).toBeTruthy();
    expect(screen.getByText("We'll send you a notification when we decide. If you want to ask about it, call support.")).toBeTruthy();
    expect(screen.getByTestId('support-hours')).toBeTruthy();
  });

  it('reconnecting: a failed re-read keeps the screen and offers Check now; the timer re-reads', async () => {
    const stub = Object.getOwnPropertyDescriptor(AppState, 'currentState');
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true, writable: true });
    jest.useFakeTimers();
    let api: ReturnType<typeof openReview>;
    try {
      api = openReview(scheme, { getRiderOnboardingStatus: (_c: unknown, nth: number) => (nth < 2 ? review() : 'offline') });
      await screen.findByText("We're checking your documents");
      await act(async () => {
        jest.advanceTimersByTime(REVIEW_POLL_MS);
      });
    } finally {
      jest.useRealTimers();
      if (stub) Object.defineProperty(AppState, 'currentState', stub);
    }
    expect(await screen.findByText('Reconnecting for live updates')).toBeTruthy();
    expect(screen.getByText('This screen may be out of date. Check now to see the latest.')).toBeTruthy();
    expect(screen.getByText("We're checking your documents")).toBeTruthy();
    const before = api.callsTo('getRiderOnboardingStatus').length;
    await press('check-now');
    expect(api.callsTo('getRiderOnboardingStatus').length).toBe(before + 1);
  });

  it('error: "We couldn\'t check for updates", Try again', async () => {
    openReview(scheme, {
      getRiderOnboardingStatus: (_c: unknown, nth: number) => (nth === 1 ? apiError(500, 'INTERNAL_ERROR', 'Boom.') : review()),
    });
    expect(await screen.findByText("We couldn't check for updates")).toBeTruthy();
    expect(screen.getByText('Your documents are still with us. Nothing is lost.')).toBeTruthy();
    await press('retry');
    expect(await screen.findByText("We're checking your documents")).toBeTruthy();
  });

  it('approved: "Your documents are approved" with the day, Set up payouts opens Payouts', async () => {
    openReview(
      scheme,
      { getRiderOnboardingStatus: (_c: unknown, nth: number) => (nth === 0 ? review() : 'rider_onboarding_documents_approved') },
      { payouts: true },
    );
    expect(await screen.findByText('Your documents are approved')).toBeTruthy();
    expect(screen.getByText(/^Checked \w+day [78] August 2026\. One step left: tell Stripe where to send your pay\.$/)).toBeTruthy();
    expect(screen.getByText('Step 5 of 5: payouts')).toBeTruthy();
    await press('set-up-payouts');
    expect(route()).toBe('payouts {"context":"application"}');
  });

  it('the decision to fix moves the rider to Fix (the server decides the screen)', async () => {
    openReview(scheme, { getRiderOnboardingStatus: (_c: unknown, nth: number) => (nth === 0 ? review() : 'rider_onboarding_documents_rejected') });
    await waitFor(() => expect(screen.getByTestId('fix')).toBeTruthy());
  });
});
