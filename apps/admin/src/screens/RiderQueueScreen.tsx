/**
 * The rider onboarding review queue — `GET /v1/admin/rider-applications`
 * (`operationId: listRiderApplications`, A-23). "Structurally identical to the restaurant
 * queue, with the rider document set" (contract description) — same LyteNyte keyset grid.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Schema } from '@hg/api-client';
import { HgApiError, isApiError } from '@hg/api-client';
import { Chip, useCursorPagination, type PageMeta } from '@hg/ui-web';

import { api } from '../lib/api.js';
import { formatTimestamp, enumLabel } from '../lib/format.js';
import { KeysetGrid, type GridColumn } from '../components/KeysetGrid.js';

type RiderApplicationRow = Schema['RiderApplicationSummary'];

interface QueueState {
  status: 'loading' | 'ready' | 'error';
  rows: readonly RiderApplicationRow[];
  meta: PageMeta | null;
  error: { code: string; message: string } | null;
}

function slaChip(row: RiderApplicationRow) {
  const breached = row.sla_due_at ? new Date(row.sla_due_at).getTime() < Date.now() : false;
  return <Chip label={breached ? 'SLA breached' : 'On track'} tone={breached ? 'warning' : 'neutral'} />;
}

export function RiderQueueScreen() {
  const navigate = useNavigate();
  const pagination = useCursorPagination();
  const [state, setState] = useState<QueueState>({ status: 'loading', rows: [], meta: null, error: null });

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, status: 'loading', error: null }));
    try {
      const { data, error, response } = await api.GET('/v1/admin/rider-applications', {
        params: { query: { limit: pagination.limit, cursor: pagination.cursor ?? undefined } },
      });
      if (error || !data) throw new HgApiError(response.status, error as never);
      setState({ status: 'ready', rows: data.data, meta: data.meta, error: null });
    } catch (err) {
      const message = isApiError(err) ? err.message : 'Could not reach the admin API.';
      const code = isApiError(err) ? String(err.code) : 'TRANSPORT_ERROR';
      setState({ status: 'error', rows: [], meta: null, error: { code, message } });
    }
  }, [pagination.limit, pagination.cursor]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: readonly GridColumn<RiderApplicationRow>[] = [
    { id: 'display_name', name: 'Rider', width: 220, render: (row) => row.display_name },
    { id: 'vehicle_type', name: 'Vehicle', width: 140, render: (row) => enumLabel(row.vehicle_type) },
    { id: 'onboarding_state', name: 'State', width: 160, render: (row) => row.onboarding_state },
    { id: 'attempt_number', name: 'Attempt', width: 100, render: (row) => String(row.attempt_number ?? 1) },
    { id: 'submitted_at', name: 'Submitted', width: 180, render: (row) => formatTimestamp(row.submitted_at) },
    { id: 'sla_due_at', name: 'SLA', width: 150, render: (row) => slaChip(row) },
  ];

  return (
    <section aria-labelledby="rider-queue-heading" className="adm-stack">
      <h1 id="rider-queue-heading" className="text-title-md text-fg-primary mb-1">
        Rider onboarding queue
      </h1>
      <p className="text-body-md text-fg-secondary mb-4">
        Rider applications awaiting review, oldest first. Click a row to open the full review.
      </p>

      <KeysetGrid<RiderApplicationRow>
        columns={columns}
        rows={state.rows}
        meta={state.meta}
        pagination={pagination}
        loading={state.status === 'loading'}
        error={state.status === 'error' ? state.error : null}
        onRetry={() => void load()}
        getRowId={(row) => row.rider_account_id}
        onRowActivate={(row) => navigate(`/riders/${row.rider_account_id}`)}
        unit="applications"
        emptyTitle="Queue is empty"
        emptyDescription="No rider applications are waiting on review right now."
      />
    </section>
  );
}
