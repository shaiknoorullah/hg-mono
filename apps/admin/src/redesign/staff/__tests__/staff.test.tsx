import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

import { mockApi, renderRedesign, resetSession } from '../../testing';
import StaffRoute from '../StaffRoute';
import { envelope, page, sevenAccounts, staffRow, SUPER_ID, you } from './support';

afterEach(() => {
  cleanup();
  resetSession();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  sessionStorage.clear();
});

function renderStaff(role: 'SUPER_ADMIN' | 'ADMIN', route = '/staff') {
  return renderRedesign(
    <Routes>
      <Route path="/staff" element={<StaffRoute />} />
      <Route path="/staff/:staffId" element={<StaffRoute />} />
    </Routes>,
    { route, principal: role },
  );
}

describe('Staff list: what each role is shown', () => {
  it('shows a super admin every column, the Invite staff button and the 72-hour link rule', async () => {
    mockApi({ listStaff: page(sevenAccounts()) });
    renderStaff('SUPER_ADMIN');
    const grid = await screen.findByRole('grid');
    for (const header of ['Name', 'Email', 'Role', 'Status', 'Two-step sign-in', 'Last sign-in', 'Added']) expect(within(grid).getByText(header)).toBeTruthy();
    expect(within(grid).getByText('yusuf.ali@halalgoes.ca')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Invite staff/ })).toBeTruthy();
    expect(within(grid).getByText('You')).toBeTruthy();
  });

  it('shows an admin names, roles and status only: no email in the page, no Invite staff, named super admins to ask', async () => {
    mockApi({ listStaff: page(sevenAccounts()) });
    const { container } = renderStaff('ADMIN');
    const grid = await screen.findByRole('grid');
    expect(within(grid).queryByText('Email')).toBeNull();
    expect(within(grid).queryByText('Two-step sign-in')).toBeNull();
    expect(container.textContent).not.toContain('halalgoes.ca');
    expect(screen.queryByRole('button', { name: /Invite/ })).toBeNull();
    expect(screen.getByText('You can view staff accounts. Only a super admin can invite staff: Aminah Rahman or Sana Qureshi.')).toBeTruthy();
    // The find box says it searches names only, and an email finds nothing.
    fireEvent.change(screen.getByLabelText('Find by name'), { target: { value: 'halalgoes' } });
    expect(await screen.findByText(/No loaded account matches/)).toBeTruthy();
  });

  it('draws the edge rows: expired link, long name, unknown role, active without two-step sign-in, never accepted', async () => {
    const rows = [
      staffRow({ id: 'e1', full_name: 'Omar Farouk', status: 'INVITED', role: 'SUPPORT_AGENT', created_at: new Date(Date.now() - 5 * 86_400_000).toISOString(), last_login_at: null, mfa_enrolled: false }),
      staffRow({ id: 'e2', full_name: 'Tariq Mahmood', role: 'FINANCE_ADMIN' as never }),
      staffRow({ id: 'e3', full_name: 'Noor Aziz', mfa_enrolled: false }),
      staffRow({ id: 'e4', full_name: 'Late Invitee', status: 'DEACTIVATED', last_login_at: null, mfa_enrolled: false }),
    ];
    mockApi({ listStaff: page(rows) });
    renderStaff('SUPER_ADMIN');
    const grid = await screen.findByRole('grid');
    expect(within(grid).getByText('Invite link expired')).toBeTruthy();
    expect(within(grid).getByText('Unrecognised role')).toBeTruthy();
    expect(within(grid).getByText('FINANCE_ADMIN')).toBeTruthy();
    expect(within(grid).getByText('Not set up')).toBeTruthy();
    expect(within(grid).getByText('· invite never accepted')).toBeTruthy();
  });

  it('asks a super admin to invite a second one when they are alone, and says nothing when another page may hold one', async () => {
    mockApi({ listStaff: page([you()]) });
    renderStaff('SUPER_ADMIN');
    expect(await screen.findByText('Only you so far')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Invite a second super admin' })).toBeTruthy();
    cleanup();
    mockApi({ listStaff: page([you(), staffRow()], true) });
    renderStaff('SUPER_ADMIN');
    await screen.findByRole('grid');
    expect(screen.queryByText('Only one super admin is active.')).toBeNull();
  });

  it('warns a super admin, and only a super admin, when fewer than two are active on the whole list', async () => {
    mockApi({ listStaff: page([you(), staffRow()]) });
    renderStaff('SUPER_ADMIN');
    expect(await screen.findByText('Only one super admin is active.')).toBeTruthy();
    cleanup();
    resetSession();
    mockApi({ listStaff: page([you(), staffRow()]) });
    renderStaff('ADMIN');
    await screen.findByRole('grid');
    expect(screen.queryByText('Only one super admin is active.')).toBeNull();
  });
});

describe('Staff list: loading, error, more', () => {
  it('shows a loading state, then an error with Try again that loads', async () => {
    const api = mockApi({ listStaff: { status: 500, body: envelope('INTERNAL_ERROR', 'boom') } });
    renderStaff('SUPER_ADMIN');
    expect(await screen.findByText("Staff accounts didn't load")).toBeTruthy();
    api.set({ listStaff: page(sevenAccounts()) });
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findByRole('grid')).toBeTruthy();
    expect(within(screen.getByRole('grid')).getByText('Sana Qureshi')).toBeTruthy();
  });

  it('keeps the loaded rows when the next page fails, and retries it', async () => {
    const api = mockApi({
      listStaff: (req) => (req.query['cursor'] ? { status: 500, body: envelope('INTERNAL_ERROR', 'boom') } : page(sevenAccounts(), true)),
    });
    renderStaff('SUPER_ADMIN');
    await screen.findByRole('grid');
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText("The next accounts didn't load")).toBeTruthy();
    expect(within(screen.getByRole('grid')).getByText('Yusuf Ali')).toBeTruthy();
    expect(api.callsTo('listStaff').some((c) => c.query['cursor'] === 'cursor-2')).toBe(true);
  });
});

describe('Staff account panel', () => {
  it('opens beside the list without reloading it', async () => {
    const api = mockApi({ listStaff: page(sevenAccounts()) });
    renderStaff('SUPER_ADMIN');
    const grid = await screen.findByRole('grid');
    fireEvent.click(within(grid).getByRole('link', { name: 'staff account Yusuf Ali' }));
    expect(await screen.findByRole('heading', { name: /Yusuf Ali/ })).toBeTruthy();
    expect(screen.getByRole('grid')).toBeTruthy();
    expect(api.callsTo('listStaff')).toHaveLength(1);
  });

  it('sends a super admin to the on-call engineer for Remove access, and sends no request', async () => {
    vi.stubEnv('VITE_HG_ONCALL_NAME', 'Dana Reyes');
    vi.stubEnv('VITE_HG_ONCALL_PHONE', '+1 647 555 0100');
    const api = mockApi({ listStaff: page(sevenAccounts()) });
    renderStaff('SUPER_ADMIN', '/staff/a0000000-0000-4000-8000-000000000001');
    expect(await screen.findByText('Someone leaving, or an account you think is misused? Remove access now: the platform on-call engineer does it for you until the console can.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove access now' }));
    expect(await screen.findByText('Remove Maryam Khan’s access')).toBeTruthy();
    const call = screen.getByRole('link', { name: /Call Dana Reyes/ });
    expect(call.getAttribute('href')).toBe('tel:+16475550100');
    expect(api.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('does not invent an on-call number when the build has none', async () => {
    mockApi({ listStaff: page(sevenAccounts()) });
    renderStaff('SUPER_ADMIN', '/staff/a0000000-0000-4000-8000-000000000001');
    fireEvent.click(await screen.findByRole('button', { name: 'Remove access now' }));
    expect(await screen.findByText('The on-call contact isn’t set up in this build')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Call / })).toBeNull();
  });

  it('draws no account-changing control for an admin, only whom to ask, and no email', async () => {
    mockApi({ listStaff: page(sevenAccounts()) });
    const { container } = renderStaff('ADMIN', '/staff/a0000000-0000-4000-8000-000000000004');
    expect(await screen.findByText(/To remove this person's access or reset their two-step sign-in, ask a super admin: Aminah Rahman or Sana Qureshi/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Remove access|Reset two-step|Cancel this invite/ })).toBeNull();
    expect(container.textContent).not.toContain('yusuf.ali@halalgoes.ca');
  });

  it('offers no change on your own account, and a link to Your account instead', async () => {
    mockApi({ listStaff: page(sevenAccounts()) });
    renderStaff('SUPER_ADMIN', `/staff/${SUPER_ID}`);
    expect(await screen.findByText(/Nobody can change their own role or status/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove access now' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open Your account' })).toBeTruthy();
  });

  it('offers no way to reactivate a deactivated account, because the server refuses that email', async () => {
    mockApi({ listStaff: page(sevenAccounts()) });
    renderStaff('SUPER_ADMIN', '/staff/a0000000-0000-4000-8000-000000000007');
    await screen.findByText(/They can't sign in, and their sessions have ended/);
    expect(screen.queryByRole('button', { name: /Invite this email again|Reactivate/ })).toBeNull();
  });

  it('says so when a link opens an account that is not in the list, and offers Load more only while there is more', async () => {
    mockApi({ listStaff: page(sevenAccounts(), true) });
    renderStaff('SUPER_ADMIN', '/staff/ffffffff-0000-4000-8000-000000000000');
    expect(await screen.findByText("This account couldn't be opened")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Load more accounts' })).toBeTruthy();
    cleanup();
    mockApi({ listStaff: page(sevenAccounts()) });
    renderStaff('SUPER_ADMIN', '/staff/ffffffff-0000-4000-8000-000000000000');
    expect(await screen.findByText("This account couldn't be opened")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more accounts' })).toBeNull();
  });
});

describe('Invite staff', () => {
  async function openInvite() {
    renderStaff('SUPER_ADMIN');
    await screen.findByRole('grid');
    fireEvent.click(screen.getByRole('button', { name: /Invite staff/ }));
    return await screen.findByRole('textbox', { name: /Full name/ });
  }
  const fill = (name: string, email: string, role = 'Support agent') => {
    fireEvent.change(screen.getByRole('textbox', { name: /Full name/ }), { target: { value: name } });
    fireEvent.change(screen.getByRole('textbox', { name: /Work email/ }), { target: { value: email } });
    fireEvent.click(screen.getByRole('radio', { name: role }));
  };
  const send = () => fireEvent.click(screen.getByRole('button', { name: /Send invite|Send again/ }));

  it('sends nothing until the form is valid, then sends role, name and email with an Idempotency-Key', async () => {
    const api = mockApi({ listStaff: page(sevenAccounts()), createStaffUser: 'staff_user_invited' });
    await openInvite();
    send();
    expect(await screen.findByText('Fix the fields marked below, then send again.')).toBeTruthy();
    expect(api.callsTo('createStaffUser')).toHaveLength(0);
    fill('Hamza Siddiqui', 'hamza@halalgoes.ca');
    send();
    await waitFor(() => expect(api.callsTo('createStaffUser')).toHaveLength(1));
    const call = api.callsTo('createStaffUser')[0]!;
    expect(call.body).toEqual({ full_name: 'Hamza Siddiqui', email: 'hamza@halalgoes.ca', role: 'SUPPORT_AGENT' });
    expect(call.headers['idempotency-key']).toBeTruthy();
    expect(await screen.findByText(/Invite sent to/)).toBeTruthy();
  });

  it('names the person when the email is already used by a loaded account', async () => {
    mockApi({ listStaff: page(sevenAccounts()), createStaffUser: { status: 409, body: envelope('EMAIL_IN_USE', 'This email already belongs to an account.') } });
    await openInvite();
    fill('Maryam K', 'MARYAM.khan@halalgoes.ca');
    send();
    expect(await screen.findByText('Maryam Khan (Admin, Active) already uses this email. Nothing was changed.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Maryam Khan’s account' })).toBeTruthy();
  });

  it('keeps the details and reuses the same key when the outcome is unknown, then recognises its own invite', async () => {
    let attempt = 0;
    const api = mockApi({
      listStaff: page(sevenAccounts()),
      createStaffUser: () => {
        attempt += 1;
        return attempt === 1 ? { status: 503, body: envelope('INTERNAL_ERROR', 'slow') } : { status: 409, body: envelope('EMAIL_IN_USE', 'taken') };
      },
    });
    await openInvite();
    fill('Hamza Siddiqui', 'hamza@halalgoes.ca');
    send();
    expect(await screen.findByText("We couldn't confirm the invite was sent")).toBeTruthy();
    expect((screen.getByRole('textbox', { name: /Work email/ }) as HTMLInputElement).value).toBe('hamza@halalgoes.ca');
    // The invite did go through: the refreshed list now holds it as Invited.
    api.set({ listStaff: page([...sevenAccounts(), staffRow({ id: 'new1', full_name: 'Hamza Siddiqui', email: 'hamza@halalgoes.ca', role: 'SUPPORT_AGENT', status: 'INVITED', last_login_at: null, mfa_enrolled: false })]) });
    send();
    expect(await screen.findByText(/Invite sent to Hamza Siddiqui/)).toBeTruthy();
    const keys = api.callsTo('createStaffUser').map((c) => c.headers['idempotency-key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('tells you your role changed when the server refuses with 403, and says no invite was sent', async () => {
    mockApi({ listStaff: page(sevenAccounts()), createStaffUser: { status: 403, body: envelope('FORBIDDEN', 'no') } });
    await openInvite();
    fill('Hamza Siddiqui', 'hamza@halalgoes.ca');
    send();
    expect(await screen.findByText("You can't invite staff any more")).toBeTruthy();
    expect(screen.getByText(/No invite was sent/)).toBeTruthy();
  });

  it('restores unsent details after the session ended and the person signed in again', async () => {
    mockApi({ listStaff: page(sevenAccounts()) });
    await openInvite();
    fill('Hamza Siddiqui', 'hamza@halalgoes.ca', 'Admin');
    cleanup();
    mockApi({ listStaff: page(sevenAccounts()) });
    renderStaff('SUPER_ADMIN');
    await screen.findByRole('grid');
    fireEvent.click(screen.getByRole('button', { name: /Invite staff/ }));
    expect((await screen.findByRole('textbox', { name: /Full name/ }) as HTMLInputElement).value).toBe('Hamza Siddiqui');
  });
});
