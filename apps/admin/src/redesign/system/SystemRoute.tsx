/**
 * System status (`ASS/System*`, manifest section 2.6): is the API ready, which version is running,
 * and what to do when it is not.
 *
 * Who sees what (the role matrix, not decoration):
 * - Everyone signed in reads the two public probes, so everyone sees the status pane. A support
 *   agent's pane says what customers may notice and what to tell them.
 * - The dependency table and the server's own messages are for admins and super admins only: the
 *   messages can name internal addresses (see the pull request), and `getDependencyStatus`, the
 *   report with addresses, is admin-only and host-only anyway.
 * - Nothing here changes anything. There is no action but "Check again".
 *
 * Every state has a board: first check (loading), ready, rechecking, recovered, not ready (with and
 * without the part named), readiness unfinished, version unknown, nobody answered, empty report,
 * inconsistent report, offline, and the text-message sender notice.
 *
 * Not built, and why, are listed in the pull request: the dependencies-as-connected section and its
 * start-up checks (`getDependencyStatus` is host-only), and the email-domain check (nothing reports
 * it to the browser).
 */
import { useSyncExternalStore } from 'react';

import { useOnline } from '../auth/online';
import { formatFullDateTime, formatShortDateTime, formatTimeWithSeconds } from '../data/format';
import { getSession, staffRoleOf, subscribeSession } from '../data/session';
import { Badge, Button, Icon, InlineAlert, Skeleton, SplitPanes, type AnyIconName } from '../ds';
import { SYSTEM } from './copy';
import { onCallContact, RUNBOOK_URL, telHref } from './onCall';
import {
  checkNow,
  DEPENDENCY_ORDER,
  useStatus,
  viewOf,
  type DependencyName,
  type DependencyReading,
  type Reading,
  type StatusState,
  type StatusView,
} from './status';

const CARD = 'rounded-lg border border-line-decorative bg-surface-raised p-4';

function OnCallActions({ withRunbook = true }: { withRunbook?: boolean }) {
  const contact = onCallContact();
  return (
    <>
      {contact ? (
        <Button
          variant="tertiary"
          href={telHref(contact.phone)}
          aria-label={`Call ${contact.name} · ${contact.phone}, platform on-call engineer`}
        >
          {`Call ${contact.name} · ${contact.phone}`}
        </Button>
      ) : null}
      {withRunbook ? (
        <Button variant="ghost" href={RUNBOOK_URL}>
          Open the platform runbook
        </Button>
      ) : null}
    </>
  );
}

function VersionLine({ reading }: { reading: Reading }) {
  if (reading.health.kind !== 'ok') return null;
  return (
    <p className="m-0 text-body-md text-fg-secondary">
      API version <span className="font-mono text-fg-primary">{reading.health.version}</span>
      {' · running since '}
      <time dateTime={reading.health.startedAt}>{formatShortDateTime(reading.health.startedAt)}</time>
    </p>
  );
}

function pretty(names: readonly DependencyName[]): string {
  const labels = names.map((n) => SYSTEM.dependencies[n].name);
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

function failing(reading: Reading): DependencyName[] {
  const r = reading.readiness;
  if (r.kind !== 'answered' || r.dependencies === null) return [];
  return r.dependencies.filter((d) => !d.ready).map((d) => d.name);
}

function Heading({ children, icon }: { children: string; icon?: AnyIconName }) {
  return (
    <h2 className="m-0 flex items-center gap-2 text-heading-sm text-fg-primary">
      {icon ? <Icon name={icon} size="md" /> : null}
      {children}
    </h2>
  );
}

/** "Check again", with the spinner while a check is running. */
function RecheckButton({ checking, online }: { checking: boolean; online: boolean }) {
  return (
    <Button variant="tertiary" iconStart="refresh" loading={checking} disabled={!online} onPress={() => void checkNow()}>
      {SYSTEM.recheck}
    </Button>
  );
}

function StatusPane({ state, reading, role, online }: { state: StatusState; reading: Reading; role: 'SUPPORT_AGENT' | 'ADMIN' | 'SUPER_ADMIN'; online: boolean }) {
  const view: StatusView = viewOf(reading);
  const support = role === 'SUPPORT_AGENT';
  const at = formatFullDateTime(reading.at);
  const named = failing(reading);
  const r = reading.readiness;
  const versionKnown = reading.health.kind === 'ok';
  const earlier = state.lastFull && state.lastFull !== reading ? formatTimeWithSeconds(state.lastFull.at) : null;

  if (view === 'unreachable') {
    return (
      <section aria-label="API status" className="flex flex-col gap-3">
        <InlineAlert tone="warning" blocking title={SYSTEM.unreachable.title} action={<RecheckButton checking={state.checking} online={online} />}>
          <p className="m-0">{SYSTEM.unreachable.body}</p>
          <p className="m-0 mt-2">{SYSTEM.unreachable.startup}</p>
          <p className="m-0 mt-2">{SYSTEM.notReady.todoBody(at)}</p>
          <span className="mt-2 flex flex-wrap gap-2">
            <OnCallActions />
          </span>
        </InlineAlert>
      </section>
    );
  }

  if (view === 'not-ready') {
    if (support) {
      return (
        <section aria-label="API status" className="flex flex-col gap-3">
          <InlineAlert tone="warning" title={SYSTEM.notReady.title}>
            <p className="m-0 font-semibold">{SYSTEM.supportNotReady.customers}</p>
            <p className="m-0">{SYSTEM.supportNotReady.customersBody}</p>
            <p className="m-0 mt-2 font-semibold">{SYSTEM.supportNotReady.tell}</p>
            <p className="m-0">{SYSTEM.supportNotReady.tellBody}</p>
            <p className="m-0 mt-2">{SYSTEM.supportNotReady.escalate}</p>
            <span className="mt-2 flex flex-wrap gap-2">
              <OnCallActions withRunbook={false} />
            </span>
          </InlineAlert>
          <div className={CARD}>
            <div className="flex flex-wrap items-center gap-3">
              <Heading>{SYSTEM.notReady.cardTitle}</Heading>
              <Badge variant="warning" icon="warning">
                {SYSTEM.notReady.badge}
              </Badge>
            </div>
            <p className="m-0 mt-2 text-body-md text-fg-secondary">{supportDetail(r)}</p>
            <VersionTail reading={reading} />
            <div className="mt-3">
              <RecheckButton checking={state.checking} online={online} />
            </div>
          </div>
        </section>
      );
    }
    return (
      <section aria-label="API status" className="flex flex-col gap-3">
        <InlineAlert tone="warning" title={SYSTEM.notReady.title}>
          <p className="m-0">{named.length > 0 ? SYSTEM.notReady.named(`${pretty(named)} ${named.length === 1 ? 'is' : 'are'}`) : SYSTEM.notReady.unnamed}</p>
          <p className="m-0 mt-2">
            <strong>{SYSTEM.notReady.todo}</strong> {SYSTEM.notReady.todoBody(at)}
          </p>
          <span className="mt-2 flex flex-wrap gap-2">
            <OnCallActions />
          </span>
        </InlineAlert>
        <div className={CARD}>
          <div className="flex flex-wrap items-center gap-3">
            <Heading>{SYSTEM.notReady.cardTitle}</Heading>
            <Badge variant="warning" icon="warning">
              {SYSTEM.notReady.badge}
            </Badge>
          </div>
          <p className="m-0 mt-2 text-body-md text-fg-secondary">
            {r.kind === 'answered' && r.dependencies === null ? (
              <>
                {SYSTEM.notReady.answered} {r.message ? <q>{r.message}</q> : null} {SYSTEM.notReady.notSaid}
              </>
            ) : (
              SYSTEM.notReady.answeredNamed
            )}
          </p>
          <p className="m-0 mt-2 text-body-md text-fg-secondary">{SYSTEM.notReady.rotation}</p>
          <VersionTail reading={reading} />
          <div className="mt-3">
            <RecheckButton checking={state.checking} online={online} />
          </div>
        </div>
      </section>
    );
  }

  if (view === 'empty' || view === 'inconsistent' || view === 'readiness-timeout') {
    const title = view === 'empty' ? SYSTEM.empty.title : view === 'inconsistent' ? SYSTEM.inconsistent.title : SYSTEM.timeout.title;
    const badge = view === 'empty' ? SYSTEM.empty.badge : view === 'inconsistent' ? SYSTEM.inconsistent.badge : SYSTEM.timeout.badge;
    const body =
      view === 'empty'
        ? SYSTEM.empty.body(at)
        : view === 'inconsistent'
          ? SYSTEM.inconsistent.body(pretty(named))
          : SYSTEM.timeout.body(reading.health.kind === 'ok' ? reading.health.version : 'unknown', formatTimeWithSeconds(reading.at), earlier);
    return (
      <section aria-label="API status" className="flex flex-col gap-3">
        <div className={CARD}>
          <Heading>{title}</Heading>
          <div className="mt-2">
            <Badge variant="warning" icon="warning">
              {badge}
            </Badge>
          </div>
          <p className="m-0 mt-3 text-body-md text-fg-primary">{body}</p>
          {view === 'empty' ? null : <p className="m-0 mt-2 text-body-md text-fg-primary">{SYSTEM.callWith(at)}</p>}
          <span className="mt-3 flex flex-wrap gap-2">
            <OnCallActions />
            <RecheckButton checking={state.checking} online={online} />
          </span>
        </div>
      </section>
    );
  }

  // ready
  return (
    <section aria-label="API status" className="flex flex-col gap-3">
      <div className={CARD}>
        <Heading>{SYSTEM.ready.title}</Heading>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="outline" icon="check">
            {SYSTEM.ready.badge}
          </Badge>
        </div>
        {state.recovered ? (
          <p className="m-0 mt-3 text-body-md text-fg-primary">{SYSTEM.recovered(formatTimeWithSeconds(state.recovered.at), formatTimeWithSeconds(state.recovered.from))}</p>
        ) : null}
        <div className="mt-3 flex flex-col gap-1">
          {versionKnown ? <VersionLine reading={reading} /> : <p className="m-0 text-body-md text-fg-primary">{SYSTEM.versionUnknown.body}</p>}
          {!versionKnown ? <p className="m-0 text-body-md text-fg-secondary">{SYSTEM.versionUnknown.escalate(at)}</p> : null}
          <p className="m-0 text-body-md text-fg-secondary">{SYSTEM.replicaNote}</p>
        </div>
        {state.checking ? (
          <p role="status" className="m-0 mt-3 text-body-sm text-fg-secondary">
            {SYSTEM.checking}
          </p>
        ) : null}
        <span className="mt-3 flex flex-wrap gap-2">
          {!versionKnown ? <OnCallActions /> : null}
          <RecheckButton checking={state.checking} online={online} />
        </span>
      </div>
    </section>
  );
}

function supportDetail(r: Reading['readiness']): string {
  if (r.kind === 'answered' && r.message) return `“${r.message}”`;
  return SYSTEM.notReady.notSaid;
}

function VersionTail({ reading }: { reading: Reading }) {
  if (reading.health.kind !== 'ok') return null;
  return (
    <p className="m-0 mt-2 text-body-md text-fg-secondary">
      API version <span className="font-mono text-fg-primary">{reading.health.version}</span> · running since{' '}
      <time dateTime={reading.health.startedAt}>{formatShortDateTime(reading.health.startedAt)}</time> (the liveness check still answers)
    </p>
  );
}

function badgeFor(name: DependencyName, reading: Reading | null, stale: boolean) {
  const r = reading?.readiness;
  const found: DependencyReading | undefined = r && r.kind === 'answered' && r.dependencies ? r.dependencies.find((d) => d.name === name) : undefined;
  if (!found) return { badge: <Badge variant="neutral" icon="info">{SYSTEM.badges.notReported}</Badge>, detail: null };
  if (!found.ready) return { badge: <Badge variant="warning" icon="warning">{SYSTEM.badges.notReady}</Badge>, detail: found.detail };
  if (stale) return { badge: <Badge variant="neutral" icon="clock">{SYSTEM.badges.stale}</Badge>, detail: found.detail };
  return { badge: <Badge variant="outline" icon="check">{SYSTEM.badges.ready}</Badge>, detail: found.detail };
}

/** What the API needs to work (admins only). Never claims a state the server did not give. */
function DependencyTable({ shown, stale }: { shown: Reading | null; stale: boolean }) {
  return (
    <table className="w-full border-collapse text-start text-body-md">
      <caption className="sr-only">{SYSTEM.tableCaption}</caption>
      <thead>
        <tr className="border-b border-line-decorative text-start text-label-md text-fg-secondary">
          <th scope="col" className="px-3 py-2 text-start font-semibold">{SYSTEM.columns.name}</th>
          <th scope="col" className="px-3 py-2 text-start font-semibold">{SYSTEM.columns.role}</th>
          <th scope="col" className="px-3 py-2 text-start font-semibold">{SYSTEM.columns.status}</th>
          <th scope="col" className="px-3 py-2 text-start font-semibold">{SYSTEM.columns.detail}</th>
        </tr>
      </thead>
      <tbody>
        {DEPENDENCY_ORDER.map((name) => {
          const { badge, detail } = badgeFor(name, shown, stale);
          return (
            <tr key={name} className="border-b border-line-decorative align-top">
              <th scope="row" className="px-3 py-2 text-start font-semibold text-fg-primary">{SYSTEM.dependencies[name].name}</th>
              <td className="px-3 py-2 text-fg-secondary">{SYSTEM.dependencies[name].role}</td>
              <td className="px-3 py-2">{badge}</td>
              <td className="px-3 py-2 text-fg-secondary">{detail ?? SYSTEM.none}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The failed text-message sender check (`ASS/SystemSmsSender`), for every staff role. */
function SmsNotice({ state }: { state: StatusState }) {
  const sms = state.sms;
  if (sms.kind !== 'failed') return null;
  return (
    <section aria-label={SYSTEM.sms.title} id="sms-sender-notice" tabIndex={-1}>
      <InlineAlert tone="warning" title={SYSTEM.sms.title}>
        <p className="m-0 flex flex-wrap items-center gap-2">
          <Badge variant="warning" icon="warning">
            {SYSTEM.sms.badge}
          </Badge>
          <strong>{SYSTEM.sms.head}</strong>
        </p>
        {sms.message ? (
          <p className="m-0 mt-2">
            {SYSTEM.sms.messageFromServer} <q>{sms.message}</q>
          </p>
        ) : null}
        {sms.failingSince ? <p className="m-0 mt-1 text-fg-secondary">{SYSTEM.sms.since(formatFullDateTime(sms.failingSince))}</p> : null}
        <p className="m-0 mt-2 font-semibold">{SYSTEM.sms.notice}</p>
        <p className="m-0">{SYSTEM.sms.noticeBody}</p>
        <p className="m-0 mt-2 font-semibold">{SYSTEM.sms.todo}</p>
        <p className="m-0">{SYSTEM.sms.todoBody}</p>
        <p className="m-0 mt-2 text-fg-secondary">{SYSTEM.sms.notInReadiness}</p>
      </InlineAlert>
    </section>
  );
}

export default function SystemRoute() {
  const state = useStatus();
  const online = useOnline();
  const session = useSyncExternalStore(subscribeSession, getSession, getSession);
  const role = staffRoleOf(session.principal) ?? 'SUPPORT_AGENT';
  const admin = role !== 'SUPPORT_AGENT';
  const reading = state.latest;

  // First check still running: skeletons, and the table in its loading state.
  if (!reading) {
    return (
      <section aria-label="System status" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        {online ? (
          <Skeleton variant="lines" count={4} label={SYSTEM.loading} />
        ) : (
          <div className={CARD}>
            <Heading>{SYSTEM.offline.nothing}</Heading>
            <p className="m-0 mt-2 text-body-md text-fg-secondary">{SYSTEM.offline.body}</p>
          </div>
        )}
        <div>
          <RecheckButton checking={state.checking} online={online} />
        </div>
      </section>
    );
  }

  const view = viewOf(reading);
  const stale = view === 'readiness-timeout';
  const tableReading = stale ? state.lastFull : reading;
  const left = online ? (
    <StatusPane state={state} reading={reading} role={role} online={online} />
  ) : (
    <section aria-label="API status" className="flex flex-col gap-3">
      <div className={CARD}>
        <Heading>{view === 'ready' ? SYSTEM.offline.ready : view === 'unreachable' ? SYSTEM.offline.nothing : SYSTEM.offline.notReady}</Heading>
        <div className="mt-2">
          <Badge variant="neutral">{SYSTEM.offline.badge(formatTimeWithSeconds(reading.at))}</Badge>
        </div>
        <p className="m-0 mt-3 text-body-md text-fg-secondary">{SYSTEM.offline.body}</p>
        <div className="mt-3">
          <RecheckButton checking={state.checking} online={online} />
        </div>
      </div>
    </section>
  );

  const header = (
    <p className="m-0 text-body-md text-fg-secondary">
      Checked <time dateTime={reading.at.toISOString()}>{formatFullDateTime(reading.at)}</time> · {SYSTEM.recheckNote}
    </p>
  );
  const announce = (
    <p role="status" className="sr-only">
      {state.announcement ?? ''}
    </p>
  );

  return (
    <section aria-label="System status" className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
      {header}
      {announce}
      <SmsNotice state={state} />
      {admin ? (
        <SplitPanes
          panes={[
            { id: 'system-status-pane', label: 'status', content: left, defaultSize: 520, minSize: 320 },
            {
              id: 'system-deps-pane',
              label: 'what the API needs',
              fill: true,
              content: <DependencyTable shown={tableReading} stale={stale} />,
            },
          ]}
        />
      ) : (
        left
      )}
    </section>
  );
}
