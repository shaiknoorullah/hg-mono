import { useSyncExternalStore } from 'react';

import { getSession, staffRoleOf, subscribeSession, type StaffRole } from '../../data/session';

export interface Viewer {
  readonly role: StaffRole | null;
  readonly accountId: string | null;
  /** Admins and super admins decide; support agents only read. */
  readonly canDecide: boolean;
  readonly isSuperAdmin: boolean;
}

/** The signed-in staff member, re-read when the session changes. */
export function useViewer(): Viewer {
  const session = useSyncExternalStore(subscribeSession, getSession, getSession);
  const role = staffRoleOf(session.principal);
  return {
    role,
    accountId: session.principal?.account_id ?? null,
    canDecide: role === 'ADMIN' || role === 'SUPER_ADMIN',
    isSuperAdmin: role === 'SUPER_ADMIN',
  };
}
