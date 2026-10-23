/**
 * Staff (staff canvas, `Main` and every `Staff*` board): who can sign in to the admin console,
 * what their role allows, and whether two-step sign-in is set up. The detail (`/staff/:staffId`)
 * and the invite form open in a panel beside the list.
 *
 * Authorisation, in one place (`./model.ts`, `staffAccess`):
 * - The route is closed to support agents by the route table (the shell draws "No permission").
 * - Admins read the list and see name, role and status. They get no Invite staff button and no
 *   account-changing panel. The server sends them the whole record anyway; this screen does not
 *   draw it, and does not search it either.
 * - Super admins see everything and may invite. The server refuses an invite from anyone else.
 *
 * Nothing here changes an existing account: the contract has no operation for it. Remove access,
 * Reset two-step sign-in and Cancel invite are written instructions for calling the platform
 * on-call engineer (`./StaffDetail.tsx`), not buttons that send a request.
 *
 * Not built, with the reason: the two draw-ahead boards for Reset two-step sign-in (their
 * operation does not exist), and a reactivate-on-invite path (the server refuses an email that
 * belongs to a deactivated account).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHref, useNavigate, useParams } from 'react-router-dom';

import { usePageBar } from '../app/pageTitle';
import { api } from '../data/api';
import { useOnline } from '../auth/online';
import { formatShortDate, formatFullDateTime } from '../data/format';
import { boardBadge } from '../ds-stubs/internal/boardBadge';
import { Badge, Banner, Button, DataGrid, Disclosure, EmptyState, ErrorState, InlineAlert, Input, Skeleton, SplitPanes, type DataGridColumn } from '../ds';
import { unwrap } from '../../lib/load';
import { useViewer } from '../verification/shared/useViewer';
import { LIST } from './copy';
import { InvitePanel } from './InvitePanel';
import { StaffDetail } from './StaffDetail';
import {
  findRows,
  inviteExpired,
  isKnownRole,
  joinNames,
  neverAccepted,
  ROLE_LABEL,
  STATUS_LABEL,
  STATUS_STYLE,
  staffAccess,
  superAdminNames,
  superAdminNotice,
  type StaffUser,
} from './model';

const PAGE_SIZE = 25;

type Load = 'loading' | 'ready' | 'error';

interface Page {
  rows: StaffUser[];
  cursor: string | null;
  hasMore: boolean;
}

async function fetchPage(cursor: string | null): Promise<Page> {
  const body = await unwrap(api.GET('/v1/admin/staff', { params: { query: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) } } }));
  return { rows: body.data, cursor: body.meta.next_cursor, hasMore: body.meta.has_more };
}

export default function StaffRoute() {
  const viewer = useViewer();
  const access = staffAccess(viewer.role);
  const navigate = useNavigate();
  const base = useHref('/staff');
  const online = useOnline();
  const { staffId } = useParams();

  const [rows, setRows] = useState<StaffUser[]>([]);
  const [page, setPage] = useState<Pick<Page, 'cursor' | 'hasMore'>>({ cursor: null, hasMore: false });
  const [load, setLoad] = useState<Load>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [inviting, setInviting] = useState<{ role?: 'SUPER_ADMIN' } | null>(null);
  const [sent, setSent] = useState<StaffUser | null>(null);
  const ticket = useRef(0);
  const inviteButton = useRef<HTMLButtonElement | null>(null);

  const run = useCallback(async () => {
    const mine = ++ticket.current;
    setLoad('loading');
    setLoadMoreFailed(false);
    try {
      const first = await fetchPage(null);
      if (mine !== ticket.current) return;
      setRows(first.rows);
      setPage({ cursor: first.cursor, hasMore: first.hasMore });
      setLoad('ready');
    } catch {
      if (mine === ticket.current) setLoad('error');
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  const loadMore = useCallback(async () => {
    if (!page.cursor || loadingMore) return;
    const mine = ticket.current;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const next = await fetchPage(page.cursor);
      if (mine !== ticket.current) return;
      setRows((current) => [...current, ...next.rows.filter((r) => !current.some((c) => c.id === r.id))]);
      setPage({ cursor: next.cursor, hasMore: next.hasMore });
    } catch {
      if (mine === ticket.current) setLoadMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }, [page.cursor, loadingMore]);

  const ready = load === 'ready';
  // The account count sits in the app bar under the title (boards `STF/*`).
  const panelOpen = inviting !== null || staffId !== undefined;
  usePageBar(
    ready ? (page.hasMore ? `Showing ${rows.length}` : `${rows.length} staff ${rows.length === 1 ? 'account' : 'accounts'}`) : load === 'loading' ? LIST.loading : undefined,
    undefined,
    panelOpen,
  );
  const shown = useMemo(() => findRows(rows, query, access), [rows, query, access]);
  const notice = ready && access.canInvite ? superAdminNotice(rows, page.hasMore) : ({ kind: 'none' } as const);
  const onlyYou = ready && access.canInvite && !page.hasMore && rows.length === 1 && rows[0]!.id === viewer.accountId;
  const selected = staffId ? (rows.find((r) => r.id === staffId) ?? null) : null;

  function openInvite(role?: 'SUPER_ADMIN') {
    setSent(null);
    setInviting(role ? { role } : {});
  }

  const compact = panelOpen;
  const columns: DataGridColumn<StaffUser>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (row) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-fg-primary">{row.full_name}</span>
          {row.id === viewer.accountId ? (
            <Badge variant="outline" size="sm">
              {LIST.you}
            </Badge>
          ) : null}
        </span>
      ),
    },
    ...(access.fullRecord && !compact ? [{ key: 'email', header: 'Email', mono: true, render: (row: StaffUser) => <span className="break-all">{row.email}</span> }] : []),
    { key: 'role', header: 'Role', render: (row) => <RoleCell role={row.role} /> },
    { key: 'status', header: 'Status', render: (row) => <StatusCell row={row} /> },
    ...(access.fullRecord && !compact ? [{ key: 'mfa', header: 'Two-step sign-in', render: (row: StaffUser) => <MfaCell row={row} /> }] : []),
    ...(access.fullRecord ? [{ key: 'last', header: 'Last sign-in', render: (row: StaffUser) => <TimeCell iso={row.last_login_at ?? null} empty={LIST.neverSignedIn} /> }] : []),
    ...(access.fullRecord && !compact ? [{ key: 'added', header: 'Added', render: (row: StaffUser) => <TimeCell iso={row.created_at} empty="" /> }] : []),
  ];

  const names = superAdminNames(rows, page.hasMore);

  const listPane = (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3" data-testid="StaffListPane">
      {!online ? <Banner tone="warning" title={LIST.offline.title} description={LIST.offline.body} announce="status" /> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[60ch] text-body-md text-fg-secondary">{access.canInvite ? LIST.subtitle : ready || load === 'loading' ? LIST.adminLine(joinNames(names)) : LIST.adminLine('')}</p>
        {access.canInvite ? (
          <div className="flex items-center gap-3">
            {!online ? <span className="text-body-sm text-fg-secondary">{LIST.inviteOffline}</span> : null}
            <Button ref={inviteButton} variant="primary" iconStart="plus" disabled={!online} onPress={() => openInvite()}>
              {LIST.invite}
            </Button>
          </div>
        ) : null}
      </div>

      {sent && inviting === null ? (
        <InlineAlert tone="success-tint" title={sent.full_name ? `Invite sent to ${sent.full_name}` : 'Invite sent'}>
          They’ll get an email at {sent.email}. The link works for 72 hours.
        </InlineAlert>
      ) : null}

      {notice.kind === 'only-one' || notice.kind === 'invited' ? (
        <InlineAlert
          tone="warning"
          title={notice.kind === 'invited' ? LIST.superInvited(notice.name).title : LIST.superOnlyOne.title}
          action={
            <Button variant="tertiary" disabled={!online} onPress={() => openInvite('SUPER_ADMIN')}>
              {LIST.inviteSuper}
            </Button>
          }
        >
          {notice.kind === 'invited' ? LIST.superInvited(notice.name).body : LIST.superOnlyOne.body}
        </InlineAlert>
      ) : null}

      {onlyYou ? (
        <EmptyState
          icon="profile"
          title={LIST.onlyYou.title}
          description={
            <>
              {LIST.onlyYou.body} {LIST.onlyYou.second}
            </>
          }
          action={
            <Button variant="primary" disabled={!online} onPress={() => openInvite('SUPER_ADMIN')}>
              {LIST.inviteSecondSuper}
            </Button>
          }
        />
      ) : (
        <>
          {ready && rows.length > 0 ? (
            <div className="max-w-[420px]">
              <Input
                variant="search"
                label={access.fullRecord ? LIST.find.label : LIST.find.labelNameOnly}
                value={query}
                onValueChange={setQuery}
                helperText={query.trim() !== '' ? LIST.find.help(rows.length) : undefined}
              />
              {query.trim() !== '' ? (
                <p className="mt-1 flex items-center gap-2 text-body-sm text-fg-secondary" role="status">
                  {LIST.findCount(shown.length, rows.length, query.trim(), page.hasMore)}
                  <Button variant="ghost" size="sm" onPress={() => setQuery('')}>
                    {LIST.clearFind}
                  </Button>
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-line-decorative bg-surface-raised" id="staff-table">
            <DataGrid<StaffUser>
              label={LIST.caption}
              columns={columns}
              rows={shown}
              getRowId={(row) => row.id}
              rowLabel={(row) => `staff account ${row.full_name}`}
              rowHref={(row) => `${base}/${row.id}`}
              onOpenRow={(row) => navigate(`/staff/${row.id}`)}
              selectedId={staffId ?? null}
              loading={load === 'loading'}
              loadingSlot={<Skeleton variant="rows" count={7} label={LIST.loading} />}
              errorSlot={load === 'error' ? <ErrorState title={LIST.error.title} description={LIST.error.body} onRetry={() => void run()} /> : undefined}
              emptySlot={
                query.trim() !== '' ? (
                  <EmptyState icon="search" variant="filtered" title={LIST.findNone(query.trim()).title} description={LIST.findNone(query.trim()).body} />
                ) : (
                  <EmptyState icon="profile" title="No staff accounts" description="There are no staff accounts to show." />
                )
              }
              hasMore={page.hasMore}
              autoLoadMore={false}
              loadingMore={loadingMore}
              loadMoreFailed={loadMoreFailed}
              onLoadMore={() => void loadMore()}
            />
          </div>
          {loadMoreFailed ? (
            <InlineAlert tone="warning" blocking title={LIST.loadMoreFailed.title}>
              {LIST.loadMoreFailed.body(rows.length)}
            </InlineAlert>
          ) : null}
          {ready ? <Reference showRoles={true} /> : null}
        </>
      )}
    </div>
  );

  const detailPane = inviting ? (
    <InvitePanel
      rows={rows}
      initialRole={inviting.role}
      onlyActiveSuper={notice.kind !== 'none' || onlyYou}
      onClose={() => {
        setInviting(null);
        inviteButton.current?.focus();
      }}
      onSent={(row) => {
        setRows((current) => [row, ...current.filter((r) => r.id !== row.id)]);
        setSent(row);
        setInviting(null);
      }}
      onOpenAccount={(id) => {
        setInviting(null);
        navigate(`/staff/${id}`);
      }}
      reloadList={run}
    />
  ) : staffId ? (
    <StaffDetail
      staffId={staffId}
      row={selected}
      load={load}
      hasMore={page.hasMore}
      loadingMore={loadingMore}
      superAdminNames={names}
      onLoadMore={() => void loadMore()}
      onRetry={() => void run()}
      onClose={() => navigate('/staff')}
    />
  ) : null;

  return (
    <section aria-label="Staff" className="flex min-h-0 flex-1 flex-col">
      <SplitPanes
        panes={[
          { id: 'staff-list', label: 'Staff list', fill: true, content: listPane },
          ...(detailPane ? [{ id: 'staff-detail', label: 'Account', defaultSize: 440, minSize: 340, maxSize: 640, content: <div className="h-full overflow-hidden border-s border-line-decorative">{detailPane}</div> }] : []),
        ]}
      />
    </section>
  );
}

function RoleCell({ role }: { role: string }) {
  if (isKnownRole(role)) return <span>{ROLE_LABEL[role]}</span>;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-1.5">
      <span className="text-fg-secondary">{LIST.unknownRole}</span>
      <span className="font-mono">{role}</span>
    </span>
  );
}

function StatusCell({ row }: { row: StaffUser }) {
  if (inviteExpired(row)) {
    return (
      <Badge variant="warning" size="md" icon="clock" style={boardBadge('warning')}>
        {LIST.inviteExpired}
      </Badge>
    );
  }
  const style = STATUS_STYLE[row.status];
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Badge variant={style.tone} size="md" icon={style.icon} style={boardBadge(style.tone)}>
        {STATUS_LABEL[row.status]}
      </Badge>
      {neverAccepted(row) ? <span className="text-body-sm text-fg-secondary">{LIST.neverAccepted}</span> : null}
    </span>
  );
}

function MfaCell({ row }: { row: StaffUser }) {
  if (row.status === 'INVITED') return <span className="text-fg-secondary">{LIST.mfa.whenAccept}</span>;
  if (neverAccepted(row)) return <span className="text-fg-secondary">{LIST.mfa.never}</span>;
  if (row.mfa_enrolled) return <span>{LIST.mfa.on}</span>;
  // Opt-in for staff (owner decision, 5 October 2026): a normal state, so tint only and no alarm.
  return (
    <Badge variant="warning" size="md" icon="warning" style={boardBadge('warning')}>
      {LIST.mfa.off}
    </Badge>
  );
}

function TimeCell({ iso, empty }: { iso: string | null; empty: string }) {
  if (!iso) return <span className="text-fg-secondary">{empty}</span>;
  return (
    <time dateTime={iso} title={formatFullDateTime(iso)}>
      {formatShortDate(iso)}
    </time>
  );
}

/** "What the statuses mean" and, closed by default, "What each role can do". */
function Reference({ showRoles }: { showRoles: boolean }) {
  // The boards (`STF/Main`) draw the three statuses in three columns under a heading. An expired invite is
  // a state of "Invited" that the row's badge names, so it has no line of its own.
  return (
    <div className="flex flex-col gap-3">
      <section aria-labelledby="staff-status-key" className="flex flex-col gap-1.5">
        <h2 id="staff-status-key" className="m-0 text-body-md font-semibold leading-normal text-fg-primary">
          {LIST.statusesTitle}
        </h2>
        <div className="grid grid-cols-3 gap-6 text-body-sm leading-normal text-fg-secondary">
          {LIST.statuses.map(([name, body]) => (
            <p key={name} className="m-0">
              <strong className="font-semibold text-fg-primary">{`${name}:`}</strong> {body}
            </p>
          ))}
        </div>
      </section>
      {showRoles ? (
        <div className="rounded-md border border-line-decorative bg-surface-raised">
          <Disclosure title={LIST.rolesTitle} headingLevel={3}>
            <dl className="m-0 grid grid-cols-3 gap-6 text-body-sm leading-normal">
              {(['SUPPORT_AGENT', 'ADMIN', 'SUPER_ADMIN'] as const).map((role) => (
                <div key={role} className="flex flex-col gap-1">
                  <dt className="text-body-md font-semibold text-fg-primary">{ROLE_LABEL[role]}</dt>
                  <dd className="m-0 text-fg-secondary">{LIST.roles[role]}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-body-sm text-fg-secondary">{LIST.rolesNote}</p>
          </Disclosure>
        </div>
      ) : null}
    </div>
  );
}
