/**
 * Going online and offline: `PUT /v1/riders/me/availability` (`setRiderAvailability`), the only
 * way availability changes by rider action (D-10). Nothing here sets a mode on a tap: the
 * request goes out, the screen says "Checking you can go online" / "Setting you offline", and
 * only the server's answer changes what Home shows.
 *
 * - Go online sends a real fix (`getFreshFix`). A refused OS permission is the
 *   FOREGROUND_LOCATION_PERMISSION row, without a request that could only fail.
 * - 422 CANNOT_GO_ONLINE → one row per `details.blocking_reasons[]` code; 403
 *   ONBOARDING_INCOMPLETE / ACCOUNT_NOT_ACTIVE / PAYOUT_ACCOUNT_INCOMPLETE → the same rows.
 * - 409 ACTIVE_DELIVERY_IN_PROGRESS on Go offline → offer `go_offline_after_delivery`.
 * - A network or 5xx failure is drawn apart from a 422 (HomeOnlineFailed / HomeOfflineFailed).
 */
import { unwrap, type Schema } from '@hg/api-client';

import { getFreshFix } from '../../location';
import { rider } from '../data/client';
import { toRiderError } from '../data/errors';
import { knownReasons, type BlockingReason } from './copy';
import { getHomeState, updateHomeState } from './dashboard';

type AvailabilityInput = Schema['RiderAvailabilityInput'];
type Availability = Schema['RiderAvailability'];

const REASON_CODES = new Set(['ONBOARDING_INCOMPLETE', 'ACCOUNT_NOT_ACTIVE', 'PAYOUT_ACCOUNT_INCOMPLETE']);

async function put(body: AvailabilityInput): Promise<Availability> {
  const res = await unwrap(rider.PUT('/v1/riders/me/availability', { body }));
  return (res as { data: Availability }).data;
}

function confirm(answer: Availability): void {
  updateHomeState({
    pending: null,
    notice: null,
    confirmed: { mode: answer.availability_state, at: Date.now() },
    goOfflineAfter: answer.go_offline_after_delivery ?? false,
    forcedOffline: answer.availability_state === 'OFFLINE' ? getHomeState().forcedOffline : false,
  });
  void getHomeState().query.refetch();
}

function blockedBy(reasons: BlockingReason[]): void {
  updateHomeState({ pending: null, notice: { kind: 'blocked', reasons } });
}

export async function goOnline(): Promise<void> {
  if (getHomeState().pending) return;
  updateHomeState({ pending: 'online', notice: null });

  const fix = await getFreshFix();
  if (!fix.ok && fix.reason === 'PERMISSION_DENIED') {
    updateHomeState({ locationDenied: true });
    blockedBy(['FOREGROUND_LOCATION_PERMISSION']);
    return;
  }
  const body: AvailabilityInput = { is_online: true };
  if (fix.ok) {
    body.latitude = fix.fix.latitude;
    body.longitude = fix.fix.longitude;
    if (fix.fix.accuracy_m !== undefined) body.accuracy_m = fix.fix.accuracy_m;
  }

  try {
    const answer = await put(body);
    const reasons = knownReasons(answer.blocking_reasons);
    if (answer.availability_state === 'OFFLINE' && reasons.length > 0) {
      blockedBy(reasons);
      return;
    }
    updateHomeState({ locationDenied: false, forcedOffline: false });
    confirm(answer);
  } catch (e) {
    const err = toRiderError(e);
    const code = err.code ?? '';
    if (code === 'CANNOT_GO_ONLINE') {
      const details = err.details as { blocking_reasons?: string[] } | undefined;
      const reasons = knownReasons(details?.blocking_reasons);
      if (reasons.length > 0) return blockedBy(reasons);
    }
    if (REASON_CODES.has(code)) return blockedBy([code as BlockingReason]);
    updateHomeState({ pending: null, notice: { kind: 'online-failed' } });
  }
}

export async function goOffline(): Promise<void> {
  if (getHomeState().pending) return;
  updateHomeState({ pending: 'offline', notice: null });
  try {
    confirm(await put({ is_online: false }));
  } catch (e) {
    const err = toRiderError(e);
    if (err.code === 'ACTIVE_DELIVERY_IN_PROGRESS') {
      updateHomeState({ pending: null, notice: { kind: 'offline-refused' } });
      void getHomeState().query.refetch();
      return;
    }
    updateHomeState({ pending: null, notice: { kind: 'offline-failed' } });
  }
}

/**
 * "Go offline after this delivery" (`true`) or "Stay online after this delivery" (`false`):
 * the supported way to end a shift while ON_DELIVERY.
 */
export async function setGoOfflineAfterDelivery(after: boolean): Promise<void> {
  if (getHomeState().pending) return;
  updateHomeState({ pending: 'after' });
  try {
    const answer = await put({ is_online: true, go_offline_after_delivery: after });
    updateHomeState({ pending: null, notice: null, goOfflineAfter: answer.go_offline_after_delivery ?? after });
  } catch (e) {
    updateHomeState({ pending: null, notice: { kind: 'after-failed', error: toRiderError(e) } });
  }
}

/** Ask Stripe for a fresh onboarding link (never cached) and open it. */
export async function fetchPayoutLink(): Promise<string> {
  const res = await unwrap(rider.POST('/v1/connect/onboarding-link'));
  return (res as { data: Schema['ConnectOnboardingLink'] }).data.url;
}
