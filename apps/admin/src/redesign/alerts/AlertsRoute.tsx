/**
 * Live alerts (`ASS/Alerts*`, manifest section 2.6): what the platform is telling staff right now.
 *
 * What is on the page, and why it is shaped this way:
 * - The list is the alerts store (`./store`), fed by the one `admin:ops` subscription the shell
 *   holds. There is no REST history, so the page never claims more than "recent alerts the live
 *   connection can replay"; it says "the last 7 days" only when the replay began at the first event
 *   and was not cut.
 * - New alerts are HELD while the pointer or focus is in the list, so rows do not move under a
 *   hand; "Show N new alerts" releases them and moves focus to the table.
 * - Every connection state is said once in a status region: connecting, live, reconnecting (with
 *   the wait and "Reconnect now"), refused five times, offline, and a reconnect that missed events.
 * - The queue chips are the live counts from `admin.queue_depth`; no number before the first frame,
 *   never 0 as a stand-in. Support agents have no rider queue, and the review queues are view-only
 *   for them.
 * - Nothing here changes anything: no acknowledge, no assign (no such operations exist).
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useHref, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useRealtimeControls } from '@hg/ui-web/live';

import { useOnline } from '../auth/online';
import { formatFullDateTime, formatShortDateTime, formatTime, formatTimeWithSeconds } from '../data/format';
import { getSession, staffRoleOf, subscribeSession, type StaffRole } from '../data/session';
import {
  Badge,
  Banner,
  Button,
  DataGrid,
  EmptyState,
  FilterBar,
  Icon,
  InlineAlert,
  Price,
  Select,
  Skeleton,
  SplitPanes,
  type DataGridColumn,
} from '../ds';
import { useQueueDepth, type QueueCounts } from '../realtime/queueDepth';
import { onCallContact, RUNBOOK_URL, telHref } from '../system/onCall';
import { AlertDetail } from './AlertDetail';
import { usePageBar } from '../app/pageTitle';
import { ALERTS } from './copy';
import { FailurePanel, type PanelKind } from './FailurePanel';
import { ReauthDialog } from './ReauthDialog';
import {
  GROUP_LABEL,
  KIND_OPTIONS,
  matchesKind,
  parseKindFilter,
  reconLabel,
  severityLabel,
  subjectOf,
  whatHappened,
  type AlertRow,
  type KindFilter,
} from './model';
import { useAlerts } from './store';

type Connection = 'connecting' | 'live' | 'reconnecting' | 'offline' | 'failed' | 'signed-out';

const REFUSED_LIMIT = 5;

function useNow(everyMs: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs, active]);
  return now;
}

/** The queue chips: live counts and where each queue is worked. */
function QueueChips({ counts, role }: { counts: QueueCounts | null; role: StaffRole | null }) {
  const navigate = useNavigate();
  const support = role === 'SUPPORT_AGENT';
  const chip = (key: string, label: string, to: string, count: number | null | undefined, tone: 'warning' | 'neutral' = 'neutral', viewOnly = false) => {
    const shown = typeof count === 'number';
    const name = `${label}${viewOnly ? ' · view only' : ''}${shown ? `, ${count} ${tone === 'warning' ? 'failed' : 'waiting'}` : ''}`;
    return (
      <Button key={key} variant="tertiary" aria-label={name} onPress={() => navigate(to)}>
        {label}
        {viewOnly ? ' · view only' : ''}
        {shown ? (
          <span className="ms-2">
            <Badge variant={tone === 'warning' && count > 0 ? 'warning' : 'neutral'}>{count}</Badge>
          </span>
        ) : null}
      </Button>
    );
  };
  return (
    <nav aria-label={ALERTS.queues} className="flex flex-wrap items-center gap-2">
      {chip('certificates', 'Halal certificates to review', '/certificates', null, 'neutral', support)}
      {chip('refunds', 'Failed refunds', '/refunds?queue=failed-refunds', counts?.failed_refunds, 'warning')}
      {chip('disputes', 'Open disputes', '/refunds?queue=open-disputes', counts?.open_disputes)}
      {chip('restaurants', 'Restaurant applications', '/restaurants', counts?.pending_restaurant_reviews, 'neutral', support)}
      {support ? null : chip('riders', 'Rider applications', '/riders', counts?.pending_rider_reviews)}
    </nav>
  );
}

function mono(text: string) {
  return <span className="font-mono text-mono-md text-fg-secondary [overflow-wrap:anywhere]">{text}</span>;
}

export default function AlertsRoute() {
  const { seq: seqParam } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const base = useHref('/alerts');
  const online = useOnline();
  const alerts = useAlerts();
  const queue = useQueueDepth();
  const controls = useRealtimeControls();
  const session = useSyncExternalStore(subscribeSession, getSession, getSession);
  usePageBar(ALERTS.barSubtitle);
  const role = staffRoleOf(session.principal);
  const kind: KindFilter = parseKindFilter(params.get('kind'));
  const openSeq = seqParam && /^\d+$/.test(seqParam) ? Number(seqParam) : null;

  // --- the connection, in one word -------------------------------------------------------
  const retry = controls.retry();
  const failure = alerts.failure;
  const connection: Connection = !online
    ? 'offline'
    : failure?.kind === 'reauth'
      ? 'signed-out'
      : alerts.connection === 'open'
      ? 'live'
      : alerts.connection === 'offline' || retry.attempt >= REFUSED_LIMIT
        ? 'failed'
        : alerts.connection === 'reconnecting'
          ? 'reconnecting'
          : 'connecting';
  // Why alerts are not arriving, when a cause has a screen of its own (`./FailurePanel`).
  const panel: PanelKind | null =
    failure?.kind === 'forbidden'
      ? 'forbidden'
      : failure?.kind === 'invalid-channel'
        ? 'invalid-channel'
        : // A do-not-retry close is checked before the attempt count, because it is the reason the
          // attempts stopped; read the other way round it would show "refused five times" and a
          // Try again that cannot work.
          failure?.kind === 'fatal'
          ? 'fatal'
          : connection === 'failed' && retry.cause === 'ticket'
            ? 'ticket'
            : null;
  const now = useNow(1000, connection === 'reconnecting');
  const waitSeconds = retry.nextAt === null ? null : Math.max(0, Math.ceil((retry.nextAt - now) / 1000));
  const lostAt = alerts.lostAt ? formatTimeWithSeconds(alerts.lostAt) : null;

  // --- what is shown, and what is held ---------------------------------------------------
  const mountedMax = useRef<number | null>(null);
  if (mountedMax.current === null) mountedMax.current = alerts.rows[0]?.seq ?? 0;
  const [holdAfter, setHoldAfter] = useState<number | null>(null);
  const [shownCount, setShownCount] = useState(0);
  const [engaged, setEngaged] = useState(false);
  const gridWrap = useRef<HTMLDivElement | null>(null);

  const matching = useMemo(() => alerts.rows.filter((r) => matchesKind(r, kind)), [alerts.rows, kind]);
  // Engaging the list freezes what is above the line; Show releases it.
  useEffect(() => {
    if (engaged && holdAfter === null) setHoldAfter(alerts.rows[0]?.seq ?? 0);
  }, [engaged, holdAfter, alerts.rows]);
  const held = holdAfter === null ? [] : matching.filter((r) => r.seq > holdAfter);
  const visible = holdAfter === null ? matching : matching.filter((r) => r.seq <= holdAfter);

  function release() {
    setShownCount(held.length);
    setHoldAfter(null);
    // The table takes focus so the next Tab reaches the first new row's link.
    requestAnimationFrame(() => gridWrap.current?.querySelector<HTMLElement>('[role="grid"]')?.focus());
  }

  // --- columns ---------------------------------------------------------------------------
  const columns: DataGridColumn<AlertRow>[] = [
    {
      key: 'at',
      header: ALERTS.columns.time,
      width: 150,
      mono: true,
      render: (r) => (
        <time dateTime={r.at} title={formatFullDateTime(r.at)}>
          {formatShortDateTime(r.at)}
        </time>
      ),
    },
    {
      key: 'kind',
      header: ALERTS.columns.kind,
      width: 190,
      render: (r) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className="font-semibold">{r.group === 'unknown' ? r.type : GROUP_LABEL[r.group]}</span>
          {r.code && r.group !== 'dispatch' ? mono(r.code) : null}
          {r.seq > (mountedMax.current ?? 0) ? <Badge variant="brand">{ALERTS.newBadge}</Badge> : null}
        </span>
      ),
    },
    {
      key: 'severity',
      header: (
        <span>
          {ALERTS.columns.severity}
          <span className="sr-only">{ALERTS.severityNote}</span>
        </span>
      ),
      width: 96,
      render: (r) => (r.group === 'alert' ? severityLabel(r.severity) : null),
    },
    {
      key: 'about',
      header: ALERTS.columns.about,
      width: 280,
      render: (r) => {
        const s = subjectOf(r, role);
        switch (s.kind) {
          case 'platform':
            return ALERTS.platform;
          case 'customer':
            return (
              <span className="flex flex-col gap-0.5">
                {ALERTS.customer}
                {mono(s.id)}
              </span>
            );
          case 'raw':
            return (
              <span className="flex flex-col gap-0.5">
                <span className="font-mono text-mono-md">{s.type}</span>
                {mono(s.id)}
              </span>
            );
          case 'order':
            return (
              <span className="flex flex-col gap-0.5">
                <span className="font-semibold">Order</span>
                {mono(s.id)}
              </span>
            );
          case 'restaurant':
          case 'rider':
            return (
              <span className="flex flex-col gap-0.5">
                <span className="font-semibold">{s.kind === 'restaurant' ? 'Restaurant' : 'Rider'}</span>
                {mono(s.id)}
              </span>
            );
        }
      },
    },
    {
      key: 'what',
      header: ALERTS.columns.what,
      render: (r) => {
        if (r.money) {
          const label = reconLabel(r.code);
          return (
            <span className="inline-flex flex-wrap items-baseline gap-2 whitespace-normal">
              {label ? <span className="font-semibold">{label}</span> : null}
              {r.code ? mono(r.code) : null}
              <span>{ALERTS.detail.expected}</span>
              <Price cents={r.money.expectedCents} size="sm" />
              <span>· {ALERTS.detail.actual}</span>
              <Price cents={r.money.actualCents} size="sm" />
            </span>
          );
        }
        // What happened never truncates: the row grows to fit.
        return <span className="whitespace-normal">{whatHappened(r) ?? (r.group === 'unknown' ? r.type : '')}</span>;
      },
    },
  ];

  const kindLabel = KIND_OPTIONS.find((o) => o.value === kind)?.label.toLowerCase() ?? '';
  const others = alerts.rows.length - matching.length;
  const replayPending = alerts.replay.phase === 'pending' && connection === 'live';
  const kindQuery = kind === 'all' ? '' : `?kind=${kind}`;

  const emptySlot =
    kind !== 'all' ? (
      <EmptyState
        icon="search"
        variant="filtered"
        title={others > 0 ? ALERTS.filteredEmpty(kindLabel, others).title : ALERTS.filteredEmptyNone(kindLabel).title}
        description={others > 0 ? ALERTS.filteredEmpty(kindLabel, others).body : ALERTS.filteredEmptyNone(kindLabel).body}
        action={
          <Button variant="tertiary" onPress={() => setParams({}, { replace: true })}>
            {ALERTS.showAll}
          </Button>
        }
      />
    ) : (
      <EmptyState icon="bell" title={ALERTS.empty.title} description={ALERTS.empty.body} />
    );

  // --- status line -----------------------------------------------------------------------
  let statusBadge: { variant: 'outline' | 'neutral' | 'warning'; icon: 'bell' | 'clock' | 'warning' | 'close' | 'lock'; label: string };
  let statusText: string;
  if (connection === 'signed-out') {
    // The board says only the badge: the dialog and the kept list say the rest.
    statusBadge = { variant: 'outline', icon: 'lock', label: ALERTS.failure.signedOut };
    statusText = '';
  } else if (panel) {
    statusBadge = { variant: 'outline', icon: 'close', label: ALERTS.failure.notConnected };
    statusText = '';
  } else if (connection === 'offline') {
    statusBadge = { variant: 'neutral', icon: 'warning', label: ALERTS.status.offline.badge };
    statusText = ALERTS.status.offline.text(formatTimeWithSeconds(alerts.lostAt ?? new Date()));
  } else if (connection === 'reconnecting' || connection === 'failed') {
    statusBadge = { variant: 'warning', icon: 'warning', label: ALERTS.status.reconnecting.badge };
    statusText = ALERTS.status.reconnecting.text(formatTimeWithSeconds(alerts.lostAt ?? new Date()));
  } else if (connection === 'connecting') {
    statusBadge = { variant: 'neutral', icon: 'clock', label: ALERTS.status.connecting.badge };
    statusText = ALERTS.status.connecting.text;
  } else {
    statusBadge = { variant: 'outline', icon: 'bell', label: ALERTS.status.live.badge };
    statusText = alerts.gap
      ? ALERTS.status.gap(formatTime(alerts.gap.to))
      : replayPending
        ? ALERTS.status.loading.text
        : held.length > 0
          ? ALERTS.status.held(held.length)
          : shownCount > 0
            ? ALERTS.status.shown(shownCount)
            : ALERTS.status.live.text;
  }

  const openRow = openSeq === null ? null : (alerts.rows.find((r) => r.seq === openSeq) ?? null);
  const closeDetail = () => navigate(`/alerts${kindQuery}`, { replace: true });
  const contact = onCallContact();

  // --- the grid's slot: loading, error, rows ---------------------------------------------
  const loading = connection === 'connecting' || replayPending;
  const failedSlot = panel ? (
    <FailurePanel
      kind={panel}
      closeCode={failure?.kind === 'fatal' ? failure.code : null}
      onAction={() => {
        if (panel === 'invalid-channel') window.location.reload();
        else controls.reconnectNow();
      }}
    />
  ) : connection === 'failed' ? (
      <div role="alert" className="flex flex-col items-start gap-3 p-4">
        <h2 className="m-0 flex items-center gap-2 text-heading-sm text-fg-primary">
          <Icon name="warning" size="xl" />
          {ALERTS.failed.title}
        </h2>
        <p className="m-0 text-body-md text-fg-secondary">{ALERTS.failed.body(formatTimeWithSeconds(alerts.lostAt ?? new Date()))}</p>
        <p className="m-0 text-body-md text-fg-secondary">{ALERTS.failed.other(formatFullDateTime(new Date()))}</p>
        <span className="flex flex-wrap gap-2">
          <Button variant="primary" iconStart="refresh" onPress={() => controls.reconnectNow()}>
            {ALERTS.failed.retry}
          </Button>
          <Button variant="tertiary" onPress={() => navigate('/system')}>
            {ALERTS.failed.system}
          </Button>
          {contact ? (
            <Button variant="tertiary" href={telHref(contact.phone)} aria-label={`Call ${contact.name} · ${contact.phone}, platform on-call engineer`}>
              {`Call ${contact.name} · ${contact.phone}`}
            </Button>
          ) : null}
          <Button variant="ghost" href={RUNBOOK_URL}>
            Open the platform runbook
          </Button>
        </span>
      </div>
    ) : undefined;

  const footer =
    alerts.replay.phase === 'done' && visible.length > 0 ? (
      <div className="px-3 py-2 text-body-sm text-fg-secondary">{alerts.replay.complete ? ALERTS.end.whole : ALERTS.end.recent}</div>
    ) : undefined;

  const list = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      {connection === 'reconnecting' ? (
        <Banner
          tone="warning"
          title={ALERTS.lost.title(lostAt)}
          description={ALERTS.lost.body(waitSeconds)}
          announce="none"
          action={{ label: ALERTS.lost.now, onPress: () => controls.reconnectNow() }}
        />
      ) : null}
      {connection === 'offline' ? <Banner tone="warning" title={ALERTS.offline.title} description={ALERTS.offline.body} announce="status" /> : null}
      {alerts.gap ? (
        <Banner
          tone="info"
          title={ALERTS.gapBanner(formatTimeWithSeconds(alerts.gap.from), formatTimeWithSeconds(alerts.gap.to))}
          announce="none"
          action={{ label: ALERTS.reload, onPress: () => window.location.reload() }}
        />
      ) : null}
      {alerts.replay.phase === 'done' && alerts.replay.truncated ? (
        <InlineAlert tone="info" title={ALERTS.truncated} />
      ) : null}

      <FilterBar label="Alert filters" active={kind !== 'all'} onClear={() => setParams({}, { replace: true })}>
        <Select
          label={ALERTS.kindLabel}
          value={kind}
          options={KIND_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          onValueChange={(v) => setParams(v === 'all' ? {} : { kind: v }, { replace: true })}
          style={{ width: 240 }}
        />
        <span role="status" className="flex flex-wrap items-center gap-2 text-body-sm text-fg-secondary">
          <Badge variant={statusBadge.variant} icon={statusBadge.icon}>
            {statusBadge.label}
          </Badge>
          {statusText ? <span>{statusText}</span> : null}
        </span>
      </FilterBar>

      {held.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-line-decorative bg-surface-raised px-3 py-2 text-body-md">
          <Icon name="bell" size="md" />
          <span>{ALERTS.held(held.length)}</span>
          <Button variant="tertiary" onPress={release}>
            {ALERTS.show(held.length)}
          </Button>
        </div>
      ) : null}

      <div
        ref={gridWrap}
        data-testid="alerts-list"
        className="min-h-0 flex-1 overflow-hidden rounded-md border border-line-decorative bg-surface-raised"
        onPointerEnter={() => setEngaged(true)}
        onPointerLeave={() => setEngaged(false)}
        onFocus={() => setEngaged(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEngaged(false);
        }}
      >
        {failedSlot ?? (
          <DataGrid<AlertRow>
            label={ALERTS.gridLabel}
            columns={columns}
            rows={visible}
            getRowId={(r) => String(r.seq)}
            rowLabel={(r) => `${r.group === 'unknown' ? r.type : GROUP_LABEL[r.group]} at ${formatShortDateTime(r.at)}`}
            rowHref={(r) => `${base}/${r.seq}${kindQuery}`}
            onOpenRow={(r) => navigate(`/alerts/${r.seq}${kindQuery}`)}
            selectedId={openSeq === null ? null : String(openSeq)}
            loading={loading}
            loadingSlot={<Skeleton variant="rows" count={6} label="Loading recent alerts" />}
            emptySlot={emptySlot}
            hasMore={false}
            {...(footer ? { footerSlot: footer } : {})}
          />
        )}
      </div>
      {role === 'SUPPORT_AGENT' ? <p className="m-0 text-body-sm text-fg-secondary">{ALERTS.support.note}</p> : null}
    </div>
  );
  // The console's own session-ended dialog wins when a call has already marked the session ended.
  const reauth = failure?.kind === 'reauth' && session.ended === null ? <ReauthDialog at={failure.at} /> : null;

  return (
    <section aria-label="Live alerts page" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <p className="m-0 text-body-md text-fg-secondary">{alerts.replay.complete || alerts.replay.phase === 'pending' ? ALERTS.subtitle : ALERTS.subtitleRecent}</p>
      <QueueChips counts={queue.counts} role={role} />
      {queue.counts !== null && queue.connection !== 'open' ? (
        <p className="m-0 text-body-sm text-fg-secondary">{ALERTS.lost.countsStale(formatTime(queue.updatedAt))}</p>
      ) : null}
      {openSeq !== null ? (
        <SplitPanes
          panes={[
            { id: 'alerts-list-pane', label: 'alerts', content: list, fill: true },
            {
              id: 'alerts-detail-pane',
              label: 'alert details',
              defaultSize: 440,
              minSize: 320,
              content: <AlertDetail row={openRow} waiting={loading} role={role} onClose={closeDetail} />,
            },
          ]}
        />
      ) : (
        list
      )}
      {reauth}
    </section>
  );
}
