import { expect, test, type Page, type Route } from '@playwright/test';

import { E2E_MODE } from './mode';
import { refuse, shoot, never, fixture } from './redesign-admin.refunds-staff.support';
import { ID, onlyYou, openStaff, sevenAndNoor, sevenAndOmar, secondSuperInvited, secondSuperSuspended, withoutSana, edgeRows, zainab } from './redesign-admin.staff.scene';

test.skip(E2E_MODE !== 'mock', 'written against the mock server; run with E2E_MODE=mock');

/**
 * The staff area of the redesigned admin console, each state captured for the design board it
 * must match (tools/e2e/README.md, "Design captures"): the staff list in every state a viewer sees,
 * the account panel beside it, the invite form's results, and the 720, 320 and 1024 wide layouts.
 *
 * The accounts are the boards' own (redesign-admin.staff.scene.ts), answered with `page.route`;
 * the browser clock is the boards' (28 September 2026, a little before ten in the morning).
 *
 * The boards of the area that are not captured here are declared in
 * redesign-admin.refunds-staff-unpairable.spec.ts, each with its reason. Board ids are written out
 * in full on purpose: tools/e2e/web/check-boards.mjs validates only literal ids.
 */
const BASE = process.env.E2E_ADMIN_REDESIGN_URL ?? process.env.BASE_URL;
if (BASE) test.use({ baseURL: BASE });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.metadata.viewport === 'tablet', 'the boards are drawn at their own widths; the desktop project sets each');
});

const grid = (page: Page) => page.getByRole('grid', { name: 'Staff accounts' });
const listed = async (page: Page, name = 'Sana Qureshi') => expect(grid(page).getByText(name).first()).toBeVisible();

test.describe('redesigned admin · staff list (mock)', () => {
  test.use({ colorScheme: 'light' });

  test('super admin, populated', async ({ page }) => {
    await openStaff(page, '#/staff');
    await listed(page);
    await shoot(page, { 1440: 'admin/staff/Main' });
  });

  test('admin, read-only', async ({ page }) => {
    await openStaff(page, '#/staff', { role: 'ADMIN' });
    await listed(page);
    await shoot(page, { 1440: 'admin/staff/StaffAdminReadOnly' });
  });

  test('loading', async ({ page }) => {
    await openStaff(page, '#/staff', { rows: 'never' });
    await expect(page.getByRole('button', { name: /Invite staff/ })).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/StaffLoading' }, { idle: false });
  });

  test('the list does not load', async ({ page }) => {
    await openStaff(page, '#/staff', { rows: 'error' });
    await expect(page.getByText("Staff accounts didn't load")).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/StaffError' });
  });

  test('admin, loading', async ({ page }) => {
    await openStaff(page, '#/staff', { role: 'ADMIN', rows: 'never' });
    await expect(page.getByText(/You can view staff accounts/)).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/StaffAdminLoading' }, { idle: false });
  });

  test('admin, the list does not load', async ({ page }) => {
    await openStaff(page, '#/staff', { role: 'ADMIN', rows: 'error' });
    await expect(page.getByText("Staff accounts didn't load")).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/StaffAdminError' });
  });

  test('only one super admin is active (a suspended second one)', async ({ page }) => {
    await openStaff(page, '#/staff', { rows: secondSuperSuspended() });
    await expect(page.getByText('Only one super admin is active.')).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/StaffSuperWarning' });
  });

  test('only one super admin is active (the second still invited)', async ({ page }) => {
    await openStaff(page, '#/staff', { rows: secondSuperInvited() });
    await expect(page.getByText('Only one super admin is active.')).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/StaffSuperInvited' });
  });

  test('a support agent has no permission', async ({ page }) => {
    await openStaff(page, '#/staff', { role: 'SUPPORT_AGENT' });
    await expect(page.getByText('You don’t have permission for this')).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/StaffSupportDenied' });
  });

  test('more to load, no total', async ({ page }) => {
    await openStaff(page, '#/staff', { hasMore: true });
    await listed(page);
    await expect(page.getByRole('button', { name: 'Load more' })).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/StaffLoadMore' });
  });

  test('the next page does not load', async ({ page }) => {
    await openStaff(page, '#/staff', { hasMore: true, more: 'error' });
    await listed(page);
    await page.getByRole('button', { name: 'Load more' }).click();
    await expect(page.getByText("The next accounts didn't load")).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/StaffLoadMoreFailed' });
  });

  test('find in the loaded accounts', async ({ page }) => {
    await openStaff(page, '#/staff');
    await listed(page);
    await page.getByLabel('Find by name or email').fill('khan');
    await expect(page.getByText('1 of 7 loaded accounts matches “khan”.')).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/StaffFind' });
  });

  test('rows that need care', async ({ page }) => {
    await openStaff(page, '#/staff', { rows: edgeRows() });
    await listed(page, 'Omar Farouk');
    await expect(grid(page).getByText('Invite link expired')).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/StaffEdgeRows' });
  });

  test('offline', async ({ page }) => {
    await openStaff(page, '#/staff');
    await listed(page);
    await page.context().setOffline(true);
    await expect(page.getByText('You’re offline.')).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/StaffOffline' });
  });

  test('more to load, one active super admin on the page', async ({ page }) => {
    await openStaff(page, '#/staff', { rows: withoutSana(), hasMore: true });
    await listed(page, 'Maryam Khan');
    await shoot(page, { 1440: 'admin/staff/StaffSuperUnknownCount' });
  });

  test('admin, read-only, one active super admin', async ({ page }) => {
    await openStaff(page, '#/staff', { role: 'ADMIN', rows: secondSuperInvited() });
    await expect(page.getByText(/Only a super admin can invite staff: Aminah Rahman\./)).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/StaffAdminOneSuper' });
  });

  test('the skip link has focus', async ({ page }) => {
    await openStaff(page, '#/staff');
    await listed(page);
    await page.getByRole('link', { name: 'Skip to main content' }).focus();
    await shoot(page, { 1440: 'admin/staff/SkipLinkFocus' });
  });
});

test.describe('redesigned admin · staff list at 1024 wide (mock)', () => {
  test.use({ colorScheme: 'light', viewport: { width: 1024, height: 900 } });

  test('the table scrolls in its frame', async ({ page }) => {
    await openStaff(page, '#/staff');
    await listed(page);
    await shoot(page, { 1024: 'admin/staff/StaffNarrow' });
  });
});

const detail = (id: string) => `#/staff/${id}`;

test.describe('redesigned admin · staff account panel (mock)', () => {
  test.use({ colorScheme: 'light' });

  test('an active admin', async ({ page }) => {
    await openStaff(page, detail(ID.maryam));
    await expect(page.getByRole('heading', { name: /Maryam Khan/ })).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/StaffDetail' });
  });

  test('an invited account', async ({ page }) => {
    await openStaff(page, detail(ID.idris));
    await expect(page.getByRole('heading', { name: /Idris Okafor/ })).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/StaffDetailInvited' });
  });

  test('an invite whose link expired', async ({ page }) => {
    await openStaff(page, detail(ID.omar), { rows: sevenAndOmar() });
    await expect(page.getByRole('heading', { name: /Omar Farouk/ })).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/StaffDetailInviteExpired' });
  });

  test('your own account', async ({ page }) => {
    await openStaff(page, detail(ID.aminah));
    await expect(page.getByText(/Nobody can change their own role or status/)).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/StaffDetailSelf' });
  });

  test('an account seen by an admin', async ({ page }) => {
    await openStaff(page, detail(ID.yusuf), { role: 'ADMIN' });
    await expect(page.getByRole('heading', { name: /Yusuf Ali/ })).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/StaffDetailAdmin' });
  });

  test('opened from a link, still loading', async ({ page }) => {
    await openStaff(page, detail(ID.maryam), { rows: 'never' });
    await expect(page.getByText('Loading this account…').first()).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/StaffDetailDeepLinkLoading' }, { idle: false });
  });

  test('opened from a link that matches no loaded account', async ({ page }) => {
    await openStaff(page, detail('ffffffff-0000-4000-8000-000000000000'));
    await expect(page.getByText("This account couldn't be opened")).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/StaffDetailDeepLinkError' });
  });

  test('opened from a link by a support agent', async ({ page }) => {
    await openStaff(page, detail(ID.maryam), { role: 'SUPPORT_AGENT' });
    await expect(page.getByText('You don’t have permission for this')).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/StaffDetailSupportDenied' });
  });
});

/** Opens the invite form, fills it and sends it; `create` decides what the server answers. */
async function sendInvite(page: Page) {
  await page.getByRole('button', { name: /Invite staff/ }).click();
  await page.getByRole('textbox', { name: /Full name/ }).fill('Zainab Hussain');
  await page.getByRole('textbox', { name: /Work email/ }).fill('zainab.hussain@halalgoes.ca');
  await page.getByRole('radio', { name: 'Admin', exact: true }).click();
  await page.getByRole('button', { name: /Send invite/ }).click();
}

test.describe('redesigned admin · inviting staff (mock)', () => {
  test.use({ colorScheme: 'light' });

  test('sent: the new account is listed as Invited', async ({ page }) => {
    await openStaff(page, '#/staff', { create: (route) => route.fulfill({ status: 201, json: { data: zainab() } }) });
    await listed(page);
    await sendInvite(page);
    await expect(page.getByText(/Invite sent to Zainab Hussain/)).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/InviteSent' });
  });

  test('refused: the role changed while the page was open', async ({ page }) => {
    await openStaff(page, '#/staff', { create: refuse(403, 'FORBIDDEN', 'No access.') });
    await listed(page);
    await sendInvite(page);
    await expect(page.getByText("You can't invite staff any more")).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/InviteForbidden' });
  });

  test('the session ended with unsent details', async ({ page }) => {
    await openStaff(page, '#/staff', { create: refuse(401, 'UNAUTHENTICATED', 'Session ended.') });
    await listed(page);
    await sendInvite(page);
    await expect(page.getByRole('dialog')).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/InviteSessionExpired' });
  });
});

test.describe('redesigned admin · staff at 200% zoom (720 wide) and 320 wide (mock)', () => {
  test.use({ colorScheme: 'light' });

  test.describe('720 wide', () => {
    test.use({ viewport: { width: 720, height: 1100 } });

    test('the list', async ({ page }) => {
      await openStaff(page, '#/staff');
      await listed(page);
      await shoot(page, { 720: 'admin/staff/StaffZoom200' });
    });

    test('the navigation drawer is open', async ({ page }) => {
      await openStaff(page, '#/staff');
      await listed(page);
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await expect(page.getByRole('dialog', { name: 'Navigation' })).toBeVisible();
      await shoot(page, { 720: 'admin/staff/StaffZoom200Drawer' });
    });

    test('the drawer is closed again and focus is back on Open navigation', async ({ page }) => {
      await openStaff(page, '#/staff');
      await listed(page);
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await expect(page.getByRole('dialog', { name: 'Navigation' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Navigation' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
      await shoot(page, { 720: 'admin/staff/StaffZoom200DrawerClosed' });
    });

    test('an account takes the whole content area', async ({ page }) => {
      await openStaff(page, detail(ID.maryam));
      await expect(page.getByRole('heading', { name: /Maryam Khan/ })).toBeVisible();
      await shoot(page, { 720: 'admin/staff/StaffDetailZoom200' });
    });
  });

  test.describe('320 wide', () => {
    test.use({ viewport: { width: 320, height: 1100 } });

    test('the list', async ({ page }) => {
      await openStaff(page, '#/staff');
      await listed(page);
      await shoot(page, { 320: 'admin/staff/StaffReflow320' });
    });

    test('the navigation drawer is open', async ({ page }) => {
      await openStaff(page, '#/staff');
      await listed(page);
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await expect(page.getByRole('dialog', { name: 'Navigation' })).toBeVisible();
      await shoot(page, { 320: 'admin/staff/StaffReflow320Drawer' });
    });

    test('an account takes the whole content area', async ({ page }) => {
      await openStaff(page, detail(ID.maryam));
      await expect(page.getByRole('heading', { name: /Maryam Khan/ })).toBeVisible();
      await shoot(page, { 320: 'admin/staff/StaffDetailReflow320' });
    });
  });
});

test.describe('redesigned admin · accepting an invite (mock)', () => {
  test.use({ colorScheme: 'light' });

  test('a link with no token', async ({ page }) => {
    await page.goto('/accept-invite');
    await expect(page.getByRole('heading', { level: 1, name: "This invite link doesn't work" })).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/AcceptInvalid' });
  });
});

/** Opens the invite form from the staff list and fills it as a board does; an empty `role` leaves the choice unmade. */
async function fillInvite(page: Page, name: string, email: string, role?: 'Support agent' | 'Admin' | 'Super admin') {
  await page.getByRole('button', { name: /Invite staff/ }).click();
  const nameField = page.getByRole('textbox', { name: /Full name/ });
  await expect(nameField).toBeVisible();
  if (name) await nameField.fill(name);
  if (email) await page.getByRole('textbox', { name: /Work email/ }).fill(email);
  if (role) await page.getByRole('radio', { name: role, exact: true }).click();
}
const send = (page: Page) => page.getByRole('button', { name: /Send invite|Send again/ }).click();

// The corrected boards: two-step sign-in is optional for staff, a deactivated account's email is
// refused, and an active account without two-step sign-in is a normal state
// (https://github.com/shaiknoorullah/hg-mono/issues/908).
test.describe('redesigned admin · the invite form and accounts without two-step sign-in (mock)', () => {
  test.use({ colorScheme: 'light' });

  test('the form, open', async ({ page }) => {
    await openStaff(page, '#/staff');
    await listed(page);
    await fillInvite(page, '', '');
    await shoot(page, { 1440: 'admin/staff/InviteOpen' });
  });

  test('the form, fix the fields', async ({ page }) => {
    await openStaff(page, '#/staff');
    await listed(page);
    await fillInvite(page, 'M', 'maryam@halalgoes');
    await send(page);
    await expect(page.getByText('Fix the fields marked below, then send again.')).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/InviteValidation' });
  });

  test('sending', async ({ page }) => {
    await openStaff(page, '#/staff', { create: never });
    await listed(page);
    await fillInvite(page, 'Zainab Hussain', 'zainab.hussain@halalgoes.ca', 'Admin');
    await send(page);
    await shoot(page, { 1440: 'admin/staff/InviteSubmitting' }, { idle: false });
  });

  test('the email belongs to a loaded account', async ({ page }) => {
    await openStaff(page, '#/staff', { create: fixture('error_staff_email_in_use') });
    await listed(page);
    await fillInvite(page, 'Maryam Khan', 'maryam.khan@halalgoes.ca', 'Admin');
    await send(page);
    await expect(page.getByText('Maryam Khan (Admin, Active) already uses this email. Nothing was changed.')).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/InviteDuplicate' });
  });

  test('the email belongs to an account that is not loaded', async ({ page }) => {
    await openStaff(page, '#/staff', { create: fixture('error_staff_email_in_use') });
    await listed(page);
    await fillInvite(page, 'Omar Siddiq', 'omar.siddiq@halalgoes.ca', 'Admin');
    await send(page);
    await expect(page.getByText('This email already belongs to an account. Nothing was changed.')).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/InviteDuplicateUnloaded' });
  });

  test('the email belongs to a deactivated account', async ({ page }) => {
    await openStaff(page, '#/staff', { create: fixture('error_staff_email_in_use') });
    await listed(page);
    await fillInvite(page, 'Hana Siddiqui', 'hana.siddiqui@halalgoes.ca', 'Admin');
    await send(page);
    await expect(page.getByText('Hana Siddiqui (Admin, Deactivated) already uses this email. Nothing was changed.')).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/InviteReactivate' });
  });

  test('rejected by the server', async ({ page }) => {
    const reject = (route: Route) =>
      route.fulfill({
        status: 422,
        json: { error: { code: 'VALIDATION_FAILED', message: 'Invalid.', request_id: 'req_e2e', details: [{ field: 'email', message: 'The server didn’t accept this address.' }] } },
      });
    await openStaff(page, '#/staff', { create: reject });
    await listed(page);
    await fillInvite(page, 'Zainab Hussain', 'zainab.hussain@halalgoes.ca', 'Admin');
    await send(page);
    await expect(page.getByText('The server turned these details down. Fix the field marked below, then send again.')).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/InviteRejected' });
  });

  test('the outcome is unknown', async ({ page }) => {
    await openStaff(page, '#/staff', { create: refuse(503, 'INTERNAL_ERROR', 'slow') });
    await listed(page);
    await fillInvite(page, 'Zainab Hussain', 'zainab.hussain@halalgoes.ca', 'Admin');
    await send(page);
    await expect(page.getByText("We couldn't confirm the invite was sent")).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/InviteFailed' });
  });

  test('offline while sending', async ({ page }) => {
    const drop = async (route: Route) => {
      await page.context().setOffline(true);
      await route.abort('internetdisconnected');
    };
    await openStaff(page, '#/staff', { create: drop });
    await listed(page);
    await fillInvite(page, 'Zainab Hussain', 'zainab.hussain@halalgoes.ca', 'Admin');
    await send(page);
    await expect(page.getByText("We couldn't confirm the invite was sent")).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/InviteOfflineSubmit' });
  });

  test('a second super admin, from Only you', async ({ page }) => {
    await openStaff(page, '#/staff', { rows: onlyYou() });
    await page.getByRole('button', { name: 'Invite a second super admin' }).click();
    await expect(page.getByRole('textbox', { name: /Full name/ })).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/InviteSecondSuper' });
  });

  test('only you', async ({ page }) => {
    await openStaff(page, '#/staff', { rows: onlyYou() });
    await expect(page.getByText('Only you so far')).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/StaffOnlyYou' });
  });

  test('an active account without two-step sign-in', async ({ page }) => {
    await openStaff(page, detail(ID.noor), { rows: sevenAndNoor() });
    await expect(page.getByRole('heading', { name: /Noor Aziz/ })).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/StaffDetailNoMfa' });
  });

  test('a deactivated account', async ({ page }) => {
    await openStaff(page, detail(ID.hana));
    await expect(page.getByRole('heading', { name: /Hana Siddiqui/ })).toBeVisible();
    await shoot(page, { 1440: 'admin/staff/StaffDetailDeactivated' });
  });

  test.describe('720 wide', () => {
    test.use({ viewport: { width: 720, height: 1300 } });

    test('the invite form takes the whole content area', async ({ page }) => {
      await openStaff(page, '#/staff');
      await listed(page);
      await fillInvite(page, '', '');
      await shoot(page, { 720: 'admin/staff/InviteZoom200' });
    });
  });
});
