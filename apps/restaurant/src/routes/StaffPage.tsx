import { useState, type FormEvent } from 'react';
import type { Schema } from '@hg/api-client';
import { Button, Card, EmptyState, Icon, IconButton, Input, Select } from '@hg/ui-web';
import { StatusChip } from '../components/StatusChip';
import { IconAlert, IconTrash, IconUsers } from '../lib/icons';

/**
 * Restaurant-scoped staff management has no backend surface: `contracts/openapi.yaml`
 * defines exactly one staff-write endpoint, `POST /v1/admin/staff` (`createStaffUser`),
 * and it is `x-roles: [SUPER_ADMIN]` with a role enum of `[SUPPORT_AGENT, ADMIN,
 * SUPER_ADMIN]` — a *platform* staff directory, not a per-restaurant one. `RESTAURANT_OWNER`
 * / `RESTAURANT_MANAGER` / `RESTAURANT_STAFF` exist as `Role` grants (see `Role` in the
 * contract) but nothing in the contract lists, invites or revokes them for a restaurant.
 *
 * Rather than hand-invent an endpoint the generated client doesn't have (forbidden — see
 * AGENTS.md §6), this screen is an honest, fully-functional *local* roster: it persists to
 * `localStorage` scoped to this browser/restaurant session so the UI can be reviewed and the
 * flow can be designed, and it says so out loud. Wiring this to a real API is a contract
 * change (new `/v1/restaurant/staff` operations), tracked the same way AGENTS.md §8 tracks
 * every other known gap.
 */
const STORAGE_KEY = 'hg_restaurant_staff_roster_v1';

type LocalRole = Extract<Schema['Role'], 'RESTAURANT_OWNER' | 'RESTAURANT_MANAGER' | 'RESTAURANT_STAFF'>;

interface LocalStaffMember {
  id: string;
  full_name: string;
  email: string;
  role: LocalRole;
  added_at: string;
}

const ROLE_LABEL: Record<LocalRole, string> = {
  RESTAURANT_OWNER: 'Owner',
  RESTAURANT_MANAGER: 'Manager',
  RESTAURANT_STAFF: 'Staff',
};

function loadRoster(): LocalStaffMember[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LocalStaffMember[]) : [];
  } catch {
    return [];
  }
}

function saveRoster(roster: LocalStaffMember[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(roster));
}

function InviteForm({ onAdd }: { onAdd: (member: LocalStaffMember) => void }) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<LocalRole>('RESTAURANT_STAFF');
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (fullName.trim().length < 2) {
      setError('Enter a full name.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Enter a valid email address.');
      return;
    }
    onAdd({
      id: crypto.randomUUID(),
      full_name: fullName.trim(),
      email: email.trim(),
      role,
      added_at: new Date().toISOString(),
    });
    setFullName('');
    setEmail('');
    setRole('RESTAURANT_STAFF');
  }

  return (
    <Card>
      <h2 className="mb-3 text-label-lg font-extrabold text-fg-primary">Add a team member</h2>
      <form onSubmit={submit} className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[1fr_1fr_140px_auto]">
        <Input label="Full name" value={fullName} onChange={setFullName} placeholder="Amina Rahman" />
        <Input label="Email" variant="email" value={email} onChange={setEmail} placeholder="amina@restaurant.ca" />
        <Select
          label="Role"
          value={role}
          onChange={(v) => setRole(v as LocalRole)}
          options={[
            { value: 'RESTAURANT_MANAGER', label: 'Manager' },
            { value: 'RESTAURANT_STAFF', label: 'Staff' },
          ]}
        />
        <Button type="submit" className="self-end" iconStart={<Icon name="plus" size={15} />}>
          Add
        </Button>
      </form>
      {error ? (
        <p role="alert" className="mt-2 text-caption font-semibold text-feedback-danger-text">
          {error}
        </p>
      ) : null}
    </Card>
  );
}

export function StaffPage() {
  const [roster, setRoster] = useState<LocalStaffMember[]>(() => loadRoster());

  function addMember(member: LocalStaffMember) {
    const next = [...roster, member];
    setRoster(next);
    saveRoster(next);
  }

  function removeMember(id: string) {
    const next = roster.filter((m) => m.id !== id);
    setRoster(next);
    saveRoster(next);
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-heading-md font-extrabold text-fg-primary">
          <IconUsers size={20} /> Staff
        </h1>
        <p className="text-body-sm text-fg-secondary">Who can accept orders, edit the menu and adjust hours for this location.</p>
      </header>

      <div className="mb-5 flex items-start gap-3 rounded-sm border border-feedback-warning-border bg-feedback-warning-tint px-4 py-3 text-caption text-feedback-warning-text">
        <IconAlert size={17} />
        <p>
          This roster is kept in this browser only. The API contract has no restaurant-scoped staff endpoint yet — see
          the note at the top of <code>StaffPage.tsx</code> — so invitations here don't create real sign-in accounts.
        </p>
      </div>

      <InviteForm onAdd={addMember} />

      <div className="mt-5">
        {roster.length === 0 ? (
          <EmptyState
            illustration={<IconUsers size={32} />}
            title="No team members yet"
            description="Add a manager or staff member above."
            variant="inline"
          />
        ) : (
          <Card className="overflow-hidden" padding="0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-start">
                <thead>
                  <tr className="border-b border-line-decorative text-label-sm font-bold uppercase tracking-wide text-fg-tertiary">
                    <th className="px-5 py-3">Name</th>
                    <th className="px-5 py-3">Email</th>
                    <th className="px-5 py-3">Role</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {roster.map((m) => (
                    <tr key={m.id} className="border-b border-line-decorative last:border-0">
                      <td className="px-5 py-3.5 text-body-sm font-semibold text-fg-primary">{m.full_name}</td>
                      <td className="px-5 py-3.5 text-body-sm text-fg-secondary">{m.email}</td>
                      <td className="px-5 py-3.5">
                        <StatusChip tone="accent">{ROLE_LABEL[m.role]}</StatusChip>
                      </td>
                      <td className="px-5 py-3.5 text-end">
                        <IconButton
                          variant="plain"
                          size="sm"
                          accessibilityLabel={`Remove ${m.full_name}`}
                          icon={<IconTrash size={16} />}
                          onPress={() => removeMember(m.id)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
