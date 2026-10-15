/**
 * The account panel (`StaffDetail*` boards), built from the loaded list row: there is no
 * "get one staff account" operation, so a link to one account waits for the list and finds the
 * row in it.
 *
 * Every change to an account (remove access, reset two-step sign-in, cancel an invite, restore)
 * is a person's job today, so the panel shows the on-call path in words and offers no button
 * that sends a request. Only a super admin sees those paths; an admin is told whom to ask.
 */
import { useState } from 'react';
import { useHref } from 'react-router-dom';

import { formatFullDateTime } from '../data/format';
import { Badge, Button, DetailPanel, ErrorState, InlineAlert, KeyValueList, Skeleton } from '../ds';
import { useViewer } from '../verification/shared/useViewer';
import { DETAIL } from './copy';
import {
  inviteExpired,
  isKnownRole,
  ROLE_LABEL,
  STATUS_LABEL,
  STATUS_STYLE,
  staffAccess,
  joinNames,
  type StaffUser,
} from './model';
import { OnCallPath, type OnCallKind } from './OnCallPath';

interface Props {
  staffId: string;
  row: StaffUser | null;
  load: 'loading' | 'ready' | 'error';
  hasMore: boolean;
  loadingMore: boolean;
  superAdminNames: readonly string[];
  onLoadMore: () => void;
  onRetry: () => void;
  onClose: () => void;
}

export function StaffDetail({ staffId, row, load, hasMore, loadingMore, superAdminNames, onLoadMore, onRetry, onClose }: Props) {
  const viewer = useViewer();
  const access = staffAccess(viewer.role);
  const [path, setPath] = useState<{ id: string; kind: OnCallKind } | null>(null);

  if (row === null) {
    // Waiting for the list, or the list has no such account.
    if (load === 'loading' || (load === 'ready' && loadingMore)) {
      return (
        <DetailPanel title="Staff account" onClose={onClose}>
          <p role="status" className="mb-3 text-body-md text-fg-secondary">
            {DETAIL.loading}
          </p>
          <div aria-busy="true">
            <Skeleton variant="lines" count={6} label={DETAIL.loading} />
          </div>
        </DetailPanel>
      );
    }
    if (load === 'error') {
      return (
        <DetailPanel title="Staff account" onClose={onClose}>
          <ErrorState title={DETAIL.listFailed.title} description={DETAIL.listFailed.body} onRetry={onRetry} />
        </DetailPanel>
      );
    }
    return (
      <DetailPanel title="Staff account" onClose={onClose}>
        <InlineAlert tone="neutral" title={DETAIL.notFound.title}>
          {DETAIL.notFound.body}
        </InlineAlert>
        {hasMore ? (
          <div className="mt-3">
            <Button variant="primary" onPress={onLoadMore} loading={loadingMore}>
              {DETAIL.notFound.loadMore}
            </Button>
          </div>
        ) : null}
        <span hidden data-testid="StaffNotFound">
          {staffId}
        </span>
      </DetailPanel>
    );
  }

  const self = row.id === viewer.accountId;
  const known = isKnownRole(row.role);
  const status = STATUS_STYLE[row.status];
  const expired = inviteExpired(row);

  if (path && path.id === row.id && access.canUseOnCallPath && !self) {
    return <OnCallPath kind={path.kind} row={row} onBack={() => setPath(null)} onClose={onClose} />;
  }

  const statusBadge = expired ? (
    <Badge variant="warning" size="md" icon="clock">
      Invite link expired
    </Badge>
  ) : (
    <Badge variant={status.tone} size="md" icon={status.icon}>
      {STATUS_LABEL[row.status]}
    </Badge>
  );

  const items = [
    { key: 'role', label: DETAIL.labels.role, value: known ? ROLE_LABEL[row.role as keyof typeof ROLE_LABEL] : <span>Unrecognised role <span className="font-mono">{row.role}</span></span> },
    ...(access.fullRecord
      ? [
          { key: 'email', label: DETAIL.labels.email, value: row.email, mono: true },
          {
            key: 'mfa',
            label: DETAIL.labels.mfa,
            value:
              row.status === 'INVITED' ? (
                'Set up when they accept'
              ) : row.mfa_enrolled ? (
                'Set up'
              ) : (
                <span className="flex flex-col">
                  <Badge variant="warning" size="md" icon="warning">
                    Not set up
                  </Badge>
                  <span className="mt-1 text-body-sm text-fg-secondary">{DETAIL.mfaNote}</span>
                </span>
              ),
          },
          { key: 'last', label: DETAIL.labels.last, value: row.last_login_at ? formatFullDateTime(row.last_login_at) : DETAIL.neverSignedIn },
          { key: 'added', label: DETAIL.labels.added, value: formatFullDateTime(row.created_at) },
          { key: 'id', label: DETAIL.labels.id, value: <IdValue id={row.id} />, mono: false },
        ]
      : []),
  ];

  return (
    <DetailPanel
      key={row.id}
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span>{row.full_name}</span>
          {statusBadge}
          {self ? (
            <Badge variant="outline" size="sm">
              You
            </Badge>
          ) : null}
        </span>
      }
      onClose={onClose}
      closeLabel={DETAIL.closeLabel}
    >
      <div className="flex flex-col gap-5">
        <KeyValueList items={items} />

        <section aria-labelledby="staff-changes" className="flex flex-col gap-3 border-t border-line-decorative pt-4">
          <h3 id="staff-changes" className="text-label-lg text-fg-primary">
            {DETAIL.changes}
          </h3>
          <Changes
            row={row}
            self={self}
            known={known}
            expired={expired}
            canUseOnCallPath={access.canUseOnCallPath}
            superAdminNames={superAdminNames}
            open={(kind) => setPath({ id: row.id, kind })}
          />
        </section>
      </div>
    </DetailPanel>
  );
}

function Changes({
  row,
  self,
  known,
  expired,
  canUseOnCallPath,
  superAdminNames,
  open,
}: {
  row: StaffUser;
  self: boolean;
  known: boolean;
  expired: boolean;
  canUseOnCallPath: boolean;
  superAdminNames: readonly string[];
  open: (kind: OnCallKind) => void;
}) {
  const account = useHref('/account');
  if (self) {
    return (
      <>
        <p className="text-body-md text-fg-secondary">{DETAIL.self.body}</p>
        <div>
          <Button variant="tertiary" href={account}>
            {DETAIL.self.open}
          </Button>
        </div>
      </>
    );
  }
  // An admin has nothing to press: the server has no change an admin may make, so none is drawn.
  if (!canUseOnCallPath) return <p className="text-body-md text-fg-secondary">{DETAIL.admin(joinNames(superAdminNames))}</p>;

  if (row.status === 'INVITED') {
    return (
      <>
        <p className="text-body-md text-fg-secondary">{expired ? DETAIL.invited.expired : DETAIL.invited.body}</p>
        <div>
          <Button variant={expired ? 'primary' : 'tertiary'} onPress={() => open('cancel')}>
            {DETAIL.invited.cancel}
          </Button>
        </div>
      </>
    );
  }
  if (row.status === 'SUSPENDED') {
    return (
      <>
        <p className="text-body-md text-fg-secondary">{DETAIL.suspended}</p>
        <OnCallPath kind="contact" row={row} embedded />
      </>
    );
  }
  if (row.status === 'DEACTIVATED') return <p className="text-body-md text-fg-secondary">{DETAIL.deactivated}</p>;

  if (!known) {
    return (
      <>
        <p className="text-body-md text-fg-secondary">{DETAIL.unknownRole.body}</p>
        <div>
          <Button variant="primary" onPress={() => open('remove')}>
            {DETAIL.active.remove}
          </Button>
        </div>
        <OnCallPath kind="contact" row={row} embedded />
      </>
    );
  }
  return (
    <>
      <p className="text-body-md text-fg-secondary">{DETAIL.active.lead}</p>
      <div>
        <Button variant="primary" onPress={() => open('remove')}>
          {DETAIL.active.remove}
        </Button>
      </div>
      {row.mfa_enrolled ? (
        <>
          <div>
            <Button variant="tertiary" onPress={() => open('reset')}>
              {DETAIL.active.reset}
            </Button>
          </div>
          <p className="text-body-sm text-fg-secondary">{DETAIL.active.resetHelp}</p>
        </>
      ) : null}
      <p className="text-body-sm text-fg-secondary">{DETAIL.none}</p>
    </>
  );
}

function IdValue({ id }: { id: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      setState('copied');
    } catch {
      setState('failed');
    }
  }
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="break-all font-mono">{id}</span>
      <Button variant="tertiary" size="sm" onPress={() => void copy()}>
        {DETAIL.copyId}
      </Button>
      <span role="status" className="text-body-sm text-fg-secondary">
        {state === 'copied' ? DETAIL.copied : state === 'failed' ? DETAIL.copyFailed : ''}
      </span>
    </span>
  );
}
