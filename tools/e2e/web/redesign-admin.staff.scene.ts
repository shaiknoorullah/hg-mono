import { expect, type Page, type Route } from '@playwright/test';

import { routeLogin, routeQueueDepth, signIn, type StaffRole } from './redesign-admin.support';
import { failing, never } from './redesign-admin.refunds-staff.support';

/**
 * The scene the staff captures draw (redesign-admin.staff*.spec.ts): the accounts the staff
 * canvas's boards list, and the calls around them, answered with `page.route`.
 *
 * The boards all draw one clock (28 September 2026, a little before ten in the morning in
 * Toronto) and one set of seven accounts, plus the few the edge-row, invite-sent and detail boards
 * add. The rows are the board's own, with the board's account ids where a board shows one, because
 * the contract's staff fixtures carry placeholder names ("Full Name") and one address, and a list of
 * placeholders cannot be compared with a list of people. The shape of every row is the contract's
 * `StaffUser`, taken from the same fixtures.
 */

/** The clock every board of the area is drawn at. */
export const NOW = '2026-09-28T09:41:00-04:00';

const at = (local: string): string => new Date(local).toISOString();

export type StaffUser = {
  id: string;
  email: string;
  full_name: string;
  role: string;
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'DEACTIVATED';
  mfa_enrolled: boolean;
  last_login_at: string | null;
  created_at: string;
};

export const ID = {
  aminah: '01920a11-2b3c-7d4e-8f5a-6b7c8d9e0f1a',
  sana: 'a0000000-0000-4000-8000-000000000002',
  maryam: '0192f4a8-7c1e-7b3a-9e21-5d6c8a0b3f12',
  yusuf: 'a0000000-0000-4000-8000-000000000004',
  idris: '0193a2c1-4d5e-7f60-8a1b-2c3d4e5f6a70',
  bilal: '01926b10-3c4d-7e5f-9a60-7b8c9d0e1f23',
  hana: '0192f4a8-9d0e-7f1a-8b2c-3d4e5f6a7b8c',
  omar: '0193a0aa-1b2c-7d3e-8f40-5a6b7c8d9e01',
  layla: 'a0000000-0000-4000-8000-000000000010',
  tariq: '0192e9f1-5a6b-7c8d-9e0f-1a2b3c4d5e6f',
  noor: '0192e7b1-3c4d-7e5f-8a6b-9c0d1e2f3a4b',
  zainab: 'a0000000-0000-4000-8000-000000000008',
} as const;

const person = (id: string, name: string, role: string, status: StaffUser['status'], over: Partial<StaffUser> = {}): StaffUser => ({
  id,
  full_name: name,
  email: `${name.toLowerCase().replace(/ /g, '.')}@halalgoes.ca`,
  role,
  status,
  mfa_enrolled: true,
  last_login_at: null,
  created_at: at('2026-07-15T09:00:00-04:00'),
  ...over,
});

/** The seven accounts of `Main`. */
export function sevenAccounts(): StaffUser[] {
  return [
    person(ID.aminah, 'Aminah Rahman', 'SUPER_ADMIN', 'ACTIVE', { last_login_at: at('2026-09-28T08:02:00-04:00'), created_at: at('2026-06-02T09:00:00-04:00') }),
    person(ID.sana, 'Sana Qureshi', 'SUPER_ADMIN', 'ACTIVE', { last_login_at: at('2026-09-27T17:40:00-04:00'), created_at: at('2026-06-02T09:00:00-04:00') }),
    person(ID.maryam, 'Maryam Khan', 'ADMIN', 'ACTIVE', { last_login_at: at('2026-09-28T09:10:00-04:00') }),
    person(ID.yusuf, 'Yusuf Ali', 'ADMIN', 'ACTIVE', { last_login_at: at('2026-09-19T11:25:00-04:00') }),
    person(ID.idris, 'Idris Okafor', 'SUPPORT_AGENT', 'INVITED', { mfa_enrolled: false, created_at: at('2026-09-26T09:00:00-04:00') }),
    person(ID.bilal, 'Bilal Chaudhry', 'SUPPORT_AGENT', 'SUSPENDED', { last_login_at: at('2026-09-03T14:02:00-04:00'), created_at: at('2026-08-01T09:00:00-04:00') }),
    person(ID.hana, 'Hana Siddiqui', 'ADMIN', 'DEACTIVATED', { last_login_at: at('2026-08-30T16:45:00-04:00') }),
  ];
}

/** `StaffEdgeRows`: two of the seven, then an expired invite, an invite nobody accepted (deactivated by the server), an unknown role and an active account without two-step sign-in. */
export function edgeRows(): StaffUser[] {
  const [aminah, sana] = sevenAccounts();
  return [
    aminah!,
    sana!,
    person(ID.omar, 'Omar Farouk', 'SUPPORT_AGENT', 'INVITED', { mfa_enrolled: false, created_at: at('2026-09-20T09:00:00-04:00') }),
    person(ID.layla, 'Layla Hassan', 'ADMIN', 'DEACTIVATED', { mfa_enrolled: false, created_at: at('2026-09-08T09:00:00-04:00') }),
    person(ID.tariq, 'Tariq Mahmood', 'FINANCE_ADMIN', 'ACTIVE', { last_login_at: at('2026-09-27T10:15:00-04:00'), created_at: at('2026-09-01T09:00:00-04:00') }),
    person(ID.noor, 'Noor Aziz', 'ADMIN', 'ACTIVE', { mfa_enrolled: false, last_login_at: at('2026-09-25T13:05:00-04:00'), created_at: at('2026-08-20T09:00:00-04:00') }),
  ];
}

/** The seven without Sana (`StaffSuperUnknownCount`: one active super admin on the loaded page, more to load). */
export const withoutSana = (): StaffUser[] => sevenAccounts().filter((r) => r.id !== ID.sana);

/** The seven and the expired invite the detail board opens. */
export const sevenAndOmar = (): StaffUser[] => [...sevenAccounts(), edgeRows().find((r) => r.id === ID.omar)!];

/** Sana still has to accept (`StaffSuperInvited`). */
export function secondSuperInvited(): StaffUser[] {
  return sevenAccounts().map((r) => (r.id === ID.sana ? { ...r, status: 'INVITED', mfa_enrolled: false, last_login_at: null, created_at: at('2026-09-27T09:00:00-04:00') } : r));
}

/** Sana suspended (`StaffSuperWarning`, the defensive board). */
export function secondSuperSuspended(): StaffUser[] {
  return sevenAccounts().map((r) => (r.id === ID.sana ? { ...r, status: 'SUSPENDED' } : r));
}

/** The account `InviteSent` adds at the top of the list. */
export const zainab = (): StaffUser => person(ID.zainab, 'Zainab Hussain', 'ADMIN', 'INVITED', { mfa_enrolled: false, created_at: at('2026-09-28T09:00:00-04:00') });

export const page = (data: StaffUser[], hasMore = false) => ({ data, meta: { next_cursor: hasMore ? 'cursor-2' : null, has_more: hasMore } });

export interface StaffScene {
  /** The signed-in role; a super admin by default. */
  role?: StaffRole;
  /** The first page, or how the call goes wrong. */
  rows?: StaffUser[] | 'error' | 'never';
  hasMore?: boolean;
  /** The next page (reached by its cursor), or how it goes wrong. */
  more?: StaffUser[] | 'error';
  /** How `createStaffUser` is answered. */
  create?: (route: Route) => Promise<void>;
}

/** The viewer's own row on the boards: Aminah Rahman for a super admin, Maryam Khan for an admin. */
const viewerOf = (role: StaffRole): string => (role === 'ADMIN' ? ID.maryam : ID.aminah);

/** Routes the scene's calls, signs in and opens `hash` (`#/staff` or `#/staff/<id>`). */
export async function openStaff(page_: Page, hash: string, scene: StaffScene = {}): Promise<void> {
  const role = scene.role ?? 'SUPER_ADMIN';
  await page_.clock.setFixedTime(new Date(NOW));
  await routeLogin(page_, role, { accountId: viewerOf(role) });
  await routeQueueDepth(page_);
  await page_.route(/\/v1\/admin\/staff(\?.*)?$/, async (route) => {
    const request = route.request();
    if (request.method() === 'POST') return scene.create ? scene.create(route) : route.fallback();
    if (new URL(request.url()).searchParams.get('cursor')) {
      if (scene.more === 'error') return failing(route);
      return route.fulfill({ json: page(scene.more ?? [], false) });
    }
    if (scene.rows === 'error') return failing(route);
    if (scene.rows === 'never') return never();
    return route.fulfill({ json: page(scene.rows ?? sevenAccounts(), scene.hasMore ?? false) });
  });
  await page_.goto('/');
  await signIn(page_);
  await expect(page_.locator('#app-bar-heading')).toBeVisible();
  await page_.evaluate((h) => {
    window.location.hash = h;
  }, hash);
}


/** Only the signed-in super admin (`StaffOnlyYou`, `InviteSecondSuper`). */
export const onlyYou = (): StaffUser[] => [sevenAccounts()[0]!];

/** The seven and the active admin without two-step sign-in the detail board opens. */
export const sevenAndNoor = (): StaffUser[] => [...sevenAccounts(), edgeRows().find((r) => r.id === ID.noor)!];
