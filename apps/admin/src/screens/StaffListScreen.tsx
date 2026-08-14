/**
 * A-01 — the staff account list.
 *
 * On mount it calls `GET /v1/admin/staff` (`operationId: listStaff`) and renders the accounts
 * with `@hg/ui-web`'s `DataTable` — a real table, comfortable density from the admin register.
 * Admins may read the list; only a super admin may change it, so this V0 screen is read-only.
 *
 * Loading, empty and error states are all real and driven by the table's own states off a
 * single `useLoad`.
 */
import { useCallback } from 'react';
import type { Schema } from '@hg/api-client';
import {
  Chip,
  DataTable,
  EmptyState,
  type DataTableColumn,
  type DataTableError,
} from '@hg/ui-web';

import { api } from '../lib/api.js';
import { unwrap, useLoad } from '../lib/load.js';

type StaffUser = Schema['StaffUser'];

const DATE_FMT = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short' });

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : DATE_FMT.format(parsed);
}

/** A staff account that is not currently usable wears the `warning` tone; active is neutral. */
const STATUS_TONE: Partial<Record<string, 'warning' | 'neutral'>> = {
  ACTIVE: 'neutral',
  INVITED: 'warning',
  SUSPENDED: 'warning',
  DEACTIVATED: 'warning',
};

const COLUMNS: readonly DataTableColumn<StaffUser>[] = [
  {
    key: 'full_name',
    header: 'Name',
    contentClass: 'text',
    cell: (row) => row.full_name,
    textValue: (row) => row.full_name,
  },
  {
    key: 'email',
    header: 'Email',
    contentClass: 'text',
    cell: (row) => row.email,
  },
  {
    key: 'role',
    header: 'Role',
    contentClass: 'enum',
    cell: (row) => row.role,
  },
  {
    key: 'status',
    header: 'Status',
    contentClass: 'enum',
    cell: (row) => <Chip label={row.status} tone={STATUS_TONE[row.status] ?? 'neutral'} />,
    textValue: (row) => row.status,
  },
  {
    key: 'mfa_enrolled',
    header: 'MFA',
    contentClass: 'text',
    cell: (row) => (row.mfa_enrolled ? 'Enrolled' : 'Not enrolled'),
  },
  {
    key: 'last_login_at',
    header: 'Last login',
    contentClass: 'date',
    cell: (row) => formatTimestamp(row.last_login_at),
  },
];

export function StaffListScreen() {
  const fetcher = useCallback(
    () => unwrap(api.GET('/v1/admin/staff', { params: { query: { limit: 25 } } })),
    [],
  );

  const { status, data, error, reload } = useLoad(fetcher);

  const tableError: DataTableError | null =
    status === 'error'
      ? { code: error.code, message: error.message, onRetry: reload }
      : null;

  const rows = (data?.data ?? []) as readonly StaffUser[];

  return (
    <section aria-labelledby="staff-heading" className="adm-stack">
      <h1 id="staff-heading" className="text-title-md text-fg-primary mb-1">
        Staff accounts
      </h1>
      <p className="text-body-md text-fg-secondary mb-4">
        Everyone with a platform role. Admins may read this list; only a super admin may change it.
      </p>

      <DataTable<StaffUser>
        id="staff-list"
        caption="Platform staff accounts"
        entityPlural="staff accounts"
        columns={COLUMNS}
        rows={rows}
        getRowId={(row) => row.id}
        getRowLabel={(row) => `${row.full_name} (${row.role})`}
        loading={status === 'loading'}
        error={tableError}
        emptyState={
          <EmptyState
            title="No staff accounts"
            description="No one has been invited yet. A super admin can invite the first account."
          />
        }
      />
    </section>
  );
}
