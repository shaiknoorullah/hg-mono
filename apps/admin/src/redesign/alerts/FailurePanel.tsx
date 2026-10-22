/**
 * The three "live alerts are not arriving" screens that are not a plain connection loss
 * (`ORD/LiveAlertsTicketFailed`, `ORD/LiveAlertsForbidden`, `ORD/LiveAlertsInvalidChannel`).
 *
 * Which one is shown, and what it offers, follows what can actually put the cause right
 * (`contracts/websocket.md`):
 *
 * - `ticket`: `POST /v1/realtime/ticket` failed, so no socket was opened. A later attempt mints a fresh
 *   ticket, so "Try again" can work.
 * - `forbidden`: `subscribe_error` `forbidden`. The same request would be refused again, so there is
 *   no retry; the words say what a person can do (sign in again after a role change, or ask an admin).
 * - `invalid-channel`: `subscribe_error` `invalid_channel`. The page asked for a channel the server
 *   does not know. Asking again sends the same request, so the only action is a full reload.
 */
import { Button, Disclosure, Icon } from '../ds';
import { ALERTS } from './copy';

export type PanelKind = 'ticket' | 'forbidden' | 'invalid-channel';

interface PanelContent {
  readonly title: string;
  readonly body: string;
  readonly code: string;
  readonly icon: 'warning' | 'lock';
  readonly action: { readonly label: string } | null;
}

function contentOf(kind: PanelKind): PanelContent {
  const c = ALERTS.failure;
  switch (kind) {
    case 'ticket':
      return { ...c.ticket, icon: 'warning', action: { label: c.ticket.action } };
    case 'forbidden':
      return { ...c.forbidden, icon: 'lock', action: null };
    case 'invalid-channel':
      return { ...c.invalidChannel, icon: 'warning', action: { label: c.invalidChannel.action } };
  }
}

export function FailurePanel({ kind, onAction }: { kind: PanelKind; onAction: () => void }) {
  const c = contentOf(kind);
  return (
    <div role="alert" data-testid="alerts-failure" data-kind={kind} className="flex flex-col items-center gap-3 p-10 text-center">
      <span className={c.icon === 'lock' ? 'text-fg-secondary' : 'text-feedback-warning-icon'}>
        <Icon name={c.icon} size="2xl" />
      </span>
      <h2 className="m-0 text-heading-md text-fg-primary">{c.title}</h2>
      <p className="m-0 max-w-[560px] text-body-md text-fg-secondary">{c.body}</p>
      {c.action ? (
        <Button variant="primary" iconStart="refresh" onPress={onAction}>
          {c.action.label}
        </Button>
      ) : null}
      <Disclosure title={ALERTS.failure.technical}>
        <span className="font-mono text-body-sm text-fg-secondary">{c.code}</span>
      </Disclosure>
    </div>
  );
}
