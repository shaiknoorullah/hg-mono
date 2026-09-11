/**
 * A-33 / A-35 — dispute and refund case management.
 *
 * `GET /v1/refunds` (`operationId: listRefunds`) lists every refund visible to staff
 * (admin/support see all, not just their own), keyset-paginated. The "new case" form issues
 * a refund under the caller's authority cap via `POST /v1/admin/refunds`
 * (`operationId: issueRefund`); a request over the cap does not fail — it comes back `202`
 * as a `RefundApprovalRequest`, escalated rather than dropped, and this screen shows that
 * distinction rather than papering over it.
 *
 * `RefundState` is never rendered red: `FAILED`/`DECLINED` get the tinted `warning` tone,
 * matching the platform-wide rule that red is reserved for a halal ruling this is not.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Schema } from '@hg/api-client';
import { HgApiError, cents, isApiError } from '@hg/api-client';
import {
  Button,
  Card,
  Chip,
  DataTable,
  EmptyState,
  Icon,
  Input,
  Select,
  Textarea,
  useCursorPagination,
  useToast,
  type DataTableColumn,
  type DataTableError,
  type PageMeta,
} from '@hg/ui-web';

import { api } from '../lib/api.js';
import { toAsyncError } from '../lib/load.js';
import { formatMoney, formatTimestamp, enumLabel } from '../lib/format.js';

type Refund = Schema['Refund'];

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const TERMINAL_BAD = new Set(['FAILED', 'DECLINED', 'CANCELLED']);

const COLUMNS: readonly DataTableColumn<Refund>[] = [
  {
    key: 'order_id',
    header: 'Order',
    contentClass: 'id',
    // The Refund contract carries only `order_id` (a UUID) — no human order code (that
    // lives on the Order resource, not this one), so the id is shown truncated with the
    // full UUID as a title; the row itself is clickable through to the order (see
    // `onRowActivate` below), matching the Orders grid's "click through to detail" pattern.
    cell: (row) => <span title={row.order_id}>{row.order_id.slice(0, 8)}</span>,
  },
  { key: 'kind', header: 'Kind', contentClass: 'enum', cell: (row) => enumLabel(row.kind) },
  { key: 'reason_code', header: 'Reason', contentClass: 'enum', cell: (row) => enumLabel(row.reason_code) },
  { key: 'amount_cents', header: 'Amount', contentClass: 'money', align: 'end', cell: (row) => formatMoney(row.amount_cents) },
  {
    key: 'state',
    header: 'State',
    contentClass: 'enum',
    cell: (row) => <Chip label={row.state} tone={TERMINAL_BAD.has(row.state) ? 'warning' : 'neutral'} />,
    textValue: (row) => row.state,
  },
  { key: 'requested_at', header: 'Requested', contentClass: 'date', cell: (row) => formatTimestamp(row.requested_at) },
];

const SCOPES = [
  { value: 'FULL', label: 'Full refund' },
  { value: 'PARTIAL_ITEMS', label: 'Partial — items' },
  { value: 'PARTIAL_AMOUNT', label: 'Partial — amount (goodwill only)' },
] as const;

const REASONS = [
  { value: 'RESTAURANT_REJECTED', label: 'Restaurant rejected' },
  { value: 'MISSING_ITEMS', label: 'Missing items' },
  { value: 'WRONG_ITEMS', label: 'Wrong items' },
  { value: 'FOOD_QUALITY', label: 'Food quality' },
  { value: 'NEVER_DELIVERED', label: 'Never delivered' },
  { value: 'LATE_DELIVERY', label: 'Late delivery' },
  { value: 'HALAL_CONCERN', label: 'Halal concern' },
  { value: 'HALAL_INTEGRITY', label: 'Halal integrity' },
  { value: 'GOODWILL', label: 'Goodwill' },
  { value: 'DISPUTE_RESOLUTION', label: 'Dispute resolution' },
  { value: 'CHARGEBACK_PREEMPTIVE', label: 'Chargeback pre-emptive' },
  { value: 'OTHER', label: 'Other' },
] as const;

export function RefundCasesScreen() {
  const navigate = useNavigate();
  const toast = useToast();
  const pagination = useCursorPagination();
  const [rows, setRows] = useState<readonly Refund[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [tableStatus, setTableStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [tableError, setTableError] = useState<{ code: string; message: string } | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [orderId, setOrderId] = useState('');
  const [scope, setScope] = useState<string>('FULL');
  const [reason, setReason] = useState<string>('RESTAURANT_REJECTED');
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setTableStatus('loading');
    try {
      const { data, error, response } = await api.GET('/v1/refunds', {
        params: { query: { limit: pagination.limit, cursor: pagination.cursor ?? undefined } },
      });
      if (error || !data) throw new HgApiError(response.status, error as never);
      setRows(data.data as Refund[]);
      setMeta(data.meta);
      setTableStatus('ready');
    } catch (err) {
      const message = isApiError(err) ? err.message : 'Could not reach the admin API.';
      const code = isApiError(err) ? String(err.code) : 'TRANSPORT_ERROR';
      setTableError({ code, message });
      setTableStatus('error');
    }
  }, [pagination.limit, pagination.cursor]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = useCallback(async () => {
    setBusy(true);
    try {
      const body: Schema['AdminRefundInput'] = {
        order_id: orderId.trim(),
        scope: scope as Schema['AdminRefundInput']['scope'],
        reason_code: reason as Schema['AdminRefundInput']['reason_code'],
        reason_text: note,
        ...(reason === 'GOODWILL' && scope === 'PARTIAL_AMOUNT' && amount
          ? { amount_cents: cents(Math.round(Number(amount) * 100)) }
          : {}),
      };
      const { data, error, response } = await api.POST('/v1/admin/refunds', {
        params: { header: { 'Idempotency-Key': newIdempotencyKey() } },
        body,
      });
      if (error || !data) throw new HgApiError(response.status, error as never);
      if (response.status === 202) {
        toast.show({
          variant: 'warning',
          title: 'Above your authority cap — escalated',
          description: 'An approval request was created. No refund exists yet.',
        });
      } else {
        toast.show({ variant: 'success', title: 'Refund case opened' });
      }
      setFormOpen(false);
      setOrderId('');
      setNote('');
      setAmount('');
      pagination.reset();
      void load();
    } catch (err) {
      toast.show({ variant: 'danger', title: 'Could not open the case', description: toAsyncError(err).message });
    } finally {
      setBusy(false);
    }
  }, [orderId, scope, reason, note, amount, toast, pagination, load]);

  const dtError: DataTableError | null = tableStatus === 'error' && tableError ? { ...tableError, onRetry: load } : null;

  return (
    <section aria-labelledby="refunds-heading" className="adm-stack">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end' }}>
        <div>
          <h1 id="refunds-heading" className="text-title-md text-fg-primary mb-1">
            Refunds &amp; disputes
          </h1>
          <p className="text-body-md text-fg-secondary">
            A-33 / A-35. Every case is server-priced except goodwill, which is capped and
            dual-approved above CAD 50.
          </p>
        </div>
        <Button
          variant="primary"
          iconStart={formOpen ? <Icon name="close" size={18} /> : <Icon name="plus" size={18} weight="bold" />}
          onPress={() => setFormOpen((v) => !v)}
        >
          {formOpen ? 'Close' : 'Open a case'}
        </Button>
      </div>

      {formOpen ? (
        <Card variant="outlined" header={<h2 className="text-heading-sm text-fg-primary">New refund case</h2>}>
          <div className="adm-form-grid">
            <Input label="Order ID" helperText="The order's UUID." value={orderId} onChange={setOrderId} />
            <Select label="Scope" options={SCOPES} value={scope} onChange={setScope} />
            <Select label="Reason" options={REASONS} value={reason} onChange={setReason} />
            {reason === 'GOODWILL' && scope === 'PARTIAL_AMOUNT' ? (
              <Input label="Amount (CAD)" value={amount} onChange={setAmount} />
            ) : null}
          </div>
          <Textarea label="Reason detail" helperText="10–1000 characters." value={note} onChange={setNote} />
          <div className="adm-form-actions mt-3">
            <Button
              variant="primary"
              onPress={() => void submit()}
              disabled={busy || orderId.trim().length === 0 || note.trim().length < 10}
            >
              {busy ? 'Submitting…' : 'Submit'}
            </Button>
          </div>
        </Card>
      ) : null}

      <DataTable<Refund>
        id="refund-cases"
        caption="Refunds and disputes"
        entityPlural="refunds"
        columns={COLUMNS}
        rows={rows}
        getRowId={(row) => row.id}
        getRowLabel={(row) => `${row.kind} refund for order ${row.order_id}`}
        onRowActivate={(row) => navigate(`/orders/${row.order_id}`)}
        loading={tableStatus === 'loading'}
        error={dtError}
        emptyState={<EmptyState title="No refunds" description="No refunds or disputes have been recorded yet." />}
      />

      <div className="adm-form-actions">
        {pagination.canGoPrevious ? (
          <Button variant="tertiary" size="sm" iconStart={<Icon name="back" size={16} />} onPress={pagination.previous}>
            Previous page
          </Button>
        ) : null}
        {meta?.has_more ? (
          <Button variant="tertiary" size="sm" onPress={() => pagination.next(meta)}>
            Next page
          </Button>
        ) : null}
      </div>
    </section>
  );
}
