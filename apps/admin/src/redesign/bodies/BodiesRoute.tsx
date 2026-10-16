/**
 * Issuing bodies (`Bodies`, `Bodies-Admin`, `Bodies-Empty`, `Bodies-Error`, `Bodies-Loading`,
 * `Bodies-Review`): the registry behind the "Issuer accepted" check.
 *
 * - Super admins see every column and Review / Change status; the panel opens beside the list.
 * - Admins read the same list with no action.
 * - Support agents see name and status only (the server sends them nothing more).
 *
 * Not built, with the reason: who proposed a body and why, the applications waiting on it and
 * the count of certificates naming it are not on `HalalIssuingBody` (the boards mark them Needs
 * API), so those columns and lines are left out.
 */
import { useMemo, useRef, useState } from 'react';

import { api } from '../data/api';
import { unwrap } from '../../lib/load';
import { useOnline } from '../auth/online';
import { usePagedList } from '../data/usePagedList';
import { Badge, Banner, Button, DataGrid, EmptyState, ErrorState, Select, Skeleton, SplitPanes, type DataGridColumn } from '../ds';
import { useViewer } from '../verification/shared/useViewer';
import { BodyPanel } from './BodyPanel';
import { BODIES } from './copy';
import {
  bodiesAccess,
  isKnownStatus,
  passesIssuerCheck,
  sortBodies,
  STATUS_BADGE,
  STATUS_LABEL,
  type Body,
  type BodyStatus,
} from './model';

const PAGE_SIZE = 50;
async function fetchPage(filter: string, cursor: string | null) {
  const status = filter === 'ALL' ? undefined : [filter as BodyStatus];
  const body = await unwrap(
    api.GET('/v1/admin/halal-issuing-bodies', {
      params: { query: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}), ...(status ? { status } : {}) } },
    }),
  );
  return { rows: body.data, cursor: body.meta.next_cursor, hasMore: body.meta.has_more };
}

export default function BodiesRoute() {
  const viewer = useViewer();
  const access = bodiesAccess(viewer.role);
  const online = useOnline();
  const [filter, setFilter] = useState('ALL');
  const list = usePagedList<Body>(filter, fetchPage);
  const { rows, setRows, load, loadingMore, loadMoreFailed, loadMore } = list;
  const page = { hasMore: list.hasMore };
  const [openId, setOpenId] = useState<string | null>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  const sorted = useMemo(() => sortBodies(rows), [rows]);
  const open = openId ? (rows.find((r) => r.id === openId) ?? null) : null;
  const ready = load === 'ready';

  function openPanel(id: string, from: HTMLElement | null) {
    returnTo.current = from;
    setOpenId(id);
  }
  function closePanel() {
    setOpenId(null);
    returnTo.current?.focus();
  }

  const compact = open !== null;
  const columns: DataGridColumn<Body>[] = [
    {
      key: 'name',
      header: 'Issuing body',
      render: (b) => (
        <span className="flex flex-col leading-tight">
          <span className="font-semibold text-fg-primary">{b.name}</span>
          {access.fullRecord && b.aliases && b.aliases.length > 0 ? (
            <span className="text-body-sm text-fg-secondary">Printed as {b.aliases.map((a) => `“${a}”`).join(', ')}</span>
          ) : null}
        </span>
      ),
    },
    { key: 'status', header: 'Status', render: (b) => <StatusCell status={b.status} /> },
    ...(access.fullRecord
      ? [
          { key: 'h2', header: 'Passes Issuer accepted', render: (b: Body) => <span>{passesIssuerCheck(b) ? 'Yes' : 'No'}</span> },
          ...(compact
            ? []
            : [
                {
                  key: 'conf',
                  header: 'Issuer confirmation',
                  render: (b: Body) => <span>{b.requires_issuer_confirmation ? BODIES.confirmation.needed : BODIES.confirmation.notNeeded}</span>,
                },
                { key: 'region', header: 'Region', render: (b: Body) => <span>{[b.region, b.country].filter(Boolean).join(', ') || 'Unknown'}</span> },
              ]),
        ]
      : []),
    {
      key: 'action',
      header: access.canChange ? 'Action' : 'Note',
      render: (b) =>
        access.canChange ? (
          <Button
            variant={b.status === 'PROPOSED' ? 'secondary' : 'ghost'}
            size="sm"
            disabled={!online}
            onPress={(e) => openPanel(b.id, e.currentTarget as HTMLElement)}
          >
            {b.status === 'PROPOSED' ? 'Review…' : 'Change status…'}
          </Button>
        ) : access.fullRecord ? (
          <span className="text-fg-secondary">{b.status === 'PROPOSED' ? BODIES.waitingNote : BODIES.changeNote}</span>
        ) : null,
    },
  ];

  const filtered = filter !== 'ALL';
  const emptySlot = filter === 'PROPOSED' ? (
    <EmptyState
      icon="check"
      title={BODIES.emptyProposed.title}
      description={BODIES.emptyProposed.body}
      action={<Button variant="tertiary" onPress={() => setFilter('ALL')}>{BODIES.showEvery}</Button>}
    />
  ) : (
    <EmptyState
      icon="search"
      variant={filtered ? 'filtered' : 'first-run'}
      title={BODIES.empty.title}
      description={BODIES.empty.body}
      action={filtered ? <Button variant="tertiary" onPress={() => setFilter('ALL')}>{BODIES.showEvery}</Button> : undefined}
    />
  );

  const listPane = (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3" data-testid="BodiesListPane">
      {!online ? <Banner tone="warning" title="You’re offline" description="Changes can’t be sent until you’re back online." announce="status" /> : null}
      <div role="search" aria-label="Filter issuing bodies" className="flex items-end gap-4 rounded-md border border-line-decorative bg-surface-raised px-4 py-3">
        <div className="w-80">
          <Select label={BODIES.filterLabel} value={filter} options={BODIES.filters.map((f) => ({ ...f }))} onValueChange={setFilter} />
        </div>
        <p className="ms-auto text-body-lg font-semibold tabular-nums" role="status">
          {load === 'loading' ? 'Loading' : ready ? `Showing ${rows.length}` : ''}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-line-decorative bg-surface-raised" id="bodies-table" aria-busy={load === 'loading'}>
        <DataGrid<Body>
          label={access.fullRecord ? BODIES.caption : BODIES.captionSupport}
          columns={columns}
          rows={sorted}
          getRowId={(b) => b.id}
          rowLabel={(b) => `issuing body ${b.name}`}
          selectedId={openId}
          loading={load === 'loading'}
          loadingSlot={<Skeleton variant="rows" count={5} label={BODIES.loading} />}
          errorSlot={load === 'error' ? <ErrorState title={BODIES.error.title} description={BODIES.error.body} onRetry={() => void list.reload()} /> : undefined}
          emptySlot={emptySlot}
          hasMore={page.hasMore}
          autoLoadMore={false}
          loadingMore={loadingMore}
          loadMoreFailed={loadMoreFailed}
          onLoadMore={() => void loadMore()}
          footerSlot={ready ? <p className="m-0 px-4 py-2 text-body-sm text-fg-secondary">{access.canChange ? BODIES.foot : BODIES.footReadOnly}</p> : undefined}
        />
      </div>
    </div>
  );

  return (
    <section aria-label="Issuing bodies" className="flex min-h-0 flex-1 flex-col">
      <SplitPanes
        panes={[
          { id: 'bodies-list', label: 'Issuing bodies', fill: true, content: listPane },
          ...(open && access.canChange
            ? [
                {
                  id: 'bodies-panel',
                  label: 'Issuing body',
                  defaultSize: 440,
                  minSize: 340,
                  maxSize: 640,
                  content: (
                    <div className="h-full overflow-hidden border-s border-line-decorative">
                      <BodyPanel
                        key={open.id}
                        body={open}
                        onClose={closePanel}
                        onChanged={(b) => setRows((cur) => cur.map((r) => (r.id === b.id ? b : r)))}
                      />
                    </div>
                  ),
                },
              ]
            : []),
        ]}
      />
    </section>
  );
}

function StatusCell({ status }: { status: unknown }) {
  // A missing or unknown status draws no badge: silence is never consent on a halal claim.
  if (!isKnownStatus(status)) return <span className="text-fg-secondary">{BODIES.unknownStatus}</span>;
  return (
    <Badge variant={STATUS_BADGE[status]} size="md">
      {STATUS_LABEL[status]}
    </Badge>
  );
}
