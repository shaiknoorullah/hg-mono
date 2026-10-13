/**
 * R48 Sign out: confirm → working → signed out, or failed with "Try again"
 * (PA/Account-SignOut, -Active, -Working, -Failed).
 *
 * Order matters. The device's push token is unregistered first (`unregisterDevice`, while the
 * session can still authorise it: "Logout always calls this; a revoked device receives
 * nothing"), then the session is revoked (`logout`), then the phone forgets it (`signOut()`,
 * which the gate reads as a sign-out the rider asked for). If the revoke fails the rider is
 * still signed in on this phone, so the device registers again and the Account screen says so.
 * A 401 on `logout` means the session is already gone: that is a success.
 */
import * as React from 'react';
import { HgApiError } from '@hg/api-client';

import { registerForPush, takeRegisteredDeviceId } from '../../push';
import { rider } from '../data/client';
import { signOut } from '../session/signOut';

export type SignOutPhase = 'idle' | 'confirm' | 'working' | 'failed';

export interface SignOutFlow {
  phase: SignOutPhase;
  /** Open the confirm. */
  ask: () => void;
  cancel: () => void;
  confirm: () => Promise<void>;
}

async function revokeSession(): Promise<void> {
  const { error, response } = await rider.POST('/v1/auth/logout');
  if (error && response.status !== 401) throw new HgApiError(response.status, error as never);
}

export async function signOutEverywhereOnThisPhone(): Promise<void> {
  const deviceId = takeRegisteredDeviceId();
  if (deviceId) {
    // Push is never a gate: a failed unregister does not keep the rider signed in.
    await rider.DELETE('/v1/devices/{deviceId}', { params: { path: { deviceId } } }).catch(() => undefined);
  }
  try {
    await revokeSession();
  } catch (e) {
    if (deviceId) void registerForPush();
    throw e;
  }
  signOut();
}

export function useSignOutFlow(): SignOutFlow {
  const [phase, setPhase] = React.useState<SignOutPhase>('idle');
  const mounted = React.useRef(true);
  React.useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  return {
    phase,
    ask: () => setPhase('confirm'),
    cancel: () => setPhase('idle'),
    confirm: async () => {
      setPhase('working');
      try {
        await signOutEverywhereOnThisPhone();
      } catch {
        if (mounted.current) setPhase('failed');
      }
    },
  };
}
