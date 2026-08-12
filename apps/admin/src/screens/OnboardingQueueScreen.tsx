/**
 * The admin console's one smoke screen: the restaurant onboarding review queue.
 *
 * On mount it calls exactly one real GET the mock serves —
 * `GET /v1/admin/restaurant-applications` (`operationId: listRestaurantApplications`,
 * A-13, fixture `contracts/fixtures/admin/restaurant_application_queue.json`) — and
 * renders the FIFO queue with `@hg/ui-web`'s `DataTable`. Loading, error and empty states
 * are all real, driven by the table's own states.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Schema } from '@hg/api-client';
import { HgApiError, isApiError } from '@hg/api-client';
import type { DataTableColumn, DataTableError } from '@hg/ui-web';
import { DataTable } from '@hg/ui-web';

import { api } from '../lib/api.js';

type ApplicationRow = Schema['RestaurantApplicationSummary'];

interface QueueState {
  status: 'loading' | 'ready' | 'error';
  rows: readonly ApplicationRow[];
  error: DataTableError | null;
}

const DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatTimestamp(value: string | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : DATE_FMT.format(parsed);
}

const COLUMNS: readonly DataTableColumn<ApplicationRow>[] = [
  {
    key: 'display_name',
    header: 'Restaurant',
    contentClass: 'text',
    cell: (row) => row.display_name,
    textValue: (row) => row.display_name,
  },
  {
    key: 'city',
    header: 'City',
    contentClass: 'text',
    cell: (row) => [row.city, row.province].filter(Boolean).join(', ') || '—',
  },
  {
    key: 'onboarding_state',
    header: 'State',
    contentClass: 'enum',
    cell: (row) => row.onboarding_state,
  },
  {
    key: 'submission_count',
    header: 'Submissions',
    contentClass: 'numeric',
    align: 'end',
    cell: (row) => String(row.submission_count ?? 0),
  },
  {
    key: 'submitted_at',
    header: 'Submitted',
    contentClass: 'date',
    cell: (row) => formatTimestamp(row.submitted_at),
  },
  {
    key: 'sla_due_at',
    header: 'SLA due',
    contentClass: 'date',
    cell: (row) => formatTimestamp(row.sla_due_at),
  },
];

export function OnboardingQueueScreen() {
  const [state, setState] = useState<QueueState>({
    status: 'loading',
    rows: [],
    error: null,
  });

  const load = useCallback(async () => {
    setState({ status: 'loading', rows: [], error: null });
    try {
      const { data, error, response } = await api.GET('/v1/admin/restaurant-applications', {
        params: { query: { limit: 25 } },
      });
      if (error || !data) {
        throw new HgApiError(response.status, error as never);
      }
      setState({ status: 'ready', rows: data.data, error: null });
    } catch (err) {
      const message = isApiError(err) ? err.message : 'Could not reach the admin API.';
      const code = isApiError(err) ? String(err.code) : 'TRANSPORT_ERROR';
      setState({
        status: 'error',
        rows: [],
        error: { code, message, onRetry: () => void load() },
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-labelledby="queue-heading">
      <h1 id="queue-heading" className="text-title-md text-fg-primary mb-1">
        Restaurant onboarding queue
      </h1>
      <p className="text-body-md text-fg-secondary mb-4">
        Applications awaiting review, oldest first.
      </p>

      <DataTable<ApplicationRow>
        id="onboarding-queue"
        caption="Restaurant onboarding review queue"
        entityPlural="applications"
        columns={COLUMNS}
        rows={state.rows}
        getRowId={(row) => row.restaurant_id}
        getRowLabel={(row) => `application from ${row.display_name}`}
        loading={state.status === 'loading'}
        error={state.status === 'error' ? state.error : null}
      />
    </section>
  );
}
