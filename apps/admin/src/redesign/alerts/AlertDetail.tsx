/**
 * One alert's details beside the list (`ASS/AlertsDetail`, `ASS/AlertsFromBanner`): when, what,
 * how serious, what it is about, and what to do next.
 *
 * The console adds nothing to the alert's own words. Amounts are the alert's own cents; the console
 * computes no difference. The steps are the owner-approved reconciliation steps and the payment
 * webhook steps; any other alert gets links only where the console can follow them, and the
 * high-severity pointer to the runbook and the on-call engineer. There is no acknowledge or assign
 * action: no such operation exists in the contract, so none is drawn.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { formatFullDateTime } from '../data/format';
import type { StaffRole } from '../data/session';
import { Button, DetailPanel, KeyValueList, Price, type KeyValueItem } from '../ds';
import { onCallContact, RUNBOOK_URL, telHref } from '../system/onCall';
import { ALERTS } from './copy';
import {
  GROUP_LABEL,
  isHighSeverity,
  reconLabel,
  severityLabel,
  subjectOf,
  whatHappened,
  type AlertRow,
  type Subject,
} from './model';

const TITLES: Record<string, string> = { webhook_delivery_failed: 'Stripe webhook deliveries failing' };

export function detailTitle(row: AlertRow): string {
  if (row.group === 'unknown') return row.type;
  return (row.code ? TITLES[row.code] : undefined) ?? GROUP_LABEL[row.group];
}

function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="tertiary"
      onPress={() => {
        // The clipboard can be refused (insecure page, no permission): then nothing is copied and
        // the button does not claim it was.
        void navigator.clipboard?.writeText(id).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
    >
      {copied ? ALERTS.detail.copied : ALERTS.detail.copyId}
    </Button>
  );
}

function AboutValue({ subject }: { subject: Subject }) {
  const navigate = useNavigate();
  const go = (to: string) => () => navigate(to);
  switch (subject.kind) {
    case 'platform':
      return <>{ALERTS.platform}</>;
    case 'customer':
      return (
        <span className="flex flex-col gap-1">
          {ALERTS.customer}
          <span className="font-mono text-mono-md text-fg-secondary [overflow-wrap:anywhere]">{subject.id}</span>
        </span>
      );
    case 'raw':
      return (
        <span className="flex flex-col gap-1">
          <span className="font-mono text-mono-md">{subject.type}</span>
          <span className="font-mono text-mono-md text-fg-secondary [overflow-wrap:anywhere]">{subject.id}</span>
        </span>
      );
    case 'order':
      return (
        <span className="flex flex-col items-start gap-1">
          <Button variant="tertiary" onPress={go(subject.to)}>
            {ALERTS.detail.openOrder}
          </Button>
          <span className="font-mono text-mono-md text-fg-secondary [overflow-wrap:anywhere]">{subject.id}</span>
        </span>
      );
    case 'restaurant':
    case 'rider':
      return (
        <span className="flex flex-col items-start gap-1">
          <Button variant="tertiary" onPress={go(subject.to)}>
            {subject.kind === 'restaurant' ? ALERTS.detail.openRestaurant : ALERTS.detail.openRider}
          </Button>
          {subject.record ? (
            <Button variant="tertiary" onPress={go(subject.record)}>
              {ALERTS.detail.record}
            </Button>
          ) : null}
          <span className="font-mono text-mono-md text-fg-secondary [overflow-wrap:anywhere]">{subject.id}</span>
        </span>
      );
  }
}

function Steps({ row, subject }: { row: AlertRow; subject: Subject }) {
  const navigate = useNavigate();
  const contact = onCallContact();
  const call = contact ? (
    <Button variant="tertiary" href={telHref(contact.phone)} aria-label={`Call ${contact.name} · ${contact.phone}, platform on-call engineer`}>
      {`Call ${contact.name} · ${contact.phone}`}
    </Button>
  ) : null;
  const runbook = (
    <Button variant="ghost" href={RUNBOOK_URL}>
      {ALERTS.detail.runbook}
    </Button>
  );
  const D = ALERTS.detail;

  if (row.group === 'recon') {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="m-0">{D.recon.check}</p>
        {subject.kind === 'order' ? (
          <Button variant="tertiary" onPress={() => navigate(subject.to)}>
            {D.openOrder}
          </Button>
        ) : null}
        <p className="m-0">{D.recon.runbook}</p>
        {runbook}
        <p className="m-0">{D.recon.escalate}</p>
        {call}
      </div>
    );
  }
  if (row.code === 'webhook_delivery_failed') {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="m-0">{D.webhook.runbook}</p>
        {runbook}
        <p className="m-0">{D.webhook.call}</p>
        {call}
        <p className="m-0 text-fg-secondary">{D.webhook.customers}</p>
      </div>
    );
  }
  if (isHighSeverity(row.severity)) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="m-0">{D.high.runbook}</p>
        {runbook}
        <p className="m-0">{D.high.call}</p>
        {call}
      </div>
    );
  }
  return null;
}

export interface AlertDetailProps {
  readonly row: AlertRow | null;
  /** The list is still being replayed: the alert may yet arrive. */
  readonly waiting: boolean;
  readonly role: StaffRole | null;
  readonly onClose: () => void;
}

export function AlertDetail({ row, waiting, role, onClose }: AlertDetailProps) {
  if (!row) {
    return (
      <DetailPanel open title={waiting ? ALERTS.detail.loadingTitle : ALERTS.detail.notFoundTitle} onClose={onClose} closeLabel={ALERTS.detail.closeLabel}>
        {waiting ? null : <p className="m-0 text-body-md text-fg-secondary">{ALERTS.detail.notFoundBody}</p>}
      </DetailPanel>
    );
  }
  const subject = subjectOf(row, role);
  const label = row.group === 'recon' ? reconLabel(row.code) : null;
  const what = whatHappened(row);
  const items: KeyValueItem[] = [
    { label: ALERTS.detail.when, value: <time dateTime={row.at}>{formatFullDateTime(row.at)}</time> },
    {
      label: ALERTS.detail.what,
      value: (
        <span className="flex flex-col gap-1">
          {what ? <span>{what}</span> : null}
          {row.group === 'unknown' ? <span className="font-mono text-mono-md">{row.type}</span> : null}
          {row.code && row.group !== 'dispatch' ? <span className="font-mono text-mono-md text-fg-secondary">{row.code}</span> : null}
          {label === null && row.group === 'recon' && !what ? <span>Reconciliation exception</span> : null}
        </span>
      ),
    },
  ];
  if (row.money) {
    items.push({ label: ALERTS.detail.expected, value: <Price cents={row.money.expectedCents} size="md" /> });
    items.push({ label: ALERTS.detail.actual, value: <Price cents={row.money.actualCents} size="md" /> });
  }
  const sev = severityLabel(row.severity);
  if (sev) items.push({ label: ALERTS.detail.severity, value: sev });
  items.push({ label: ALERTS.detail.about, value: <AboutValue subject={subject} /> });
  if (subject.kind === 'order') {
    items.push({
      label: ALERTS.detail.order,
      value: (
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-mono-md [overflow-wrap:anywhere]">{subject.id}</span>
          <CopyId id={subject.id} />
        </span>
      ),
    });
  }

  return (
    <DetailPanel
      open
      title={detailTitle(row)}
      onClose={onClose}
      closeLabel={ALERTS.detail.closeLabel}
    >
      <KeyValueList items={items} />
      <div className="mt-4">
        <h3 className="m-0 mb-2 text-heading-xs text-fg-primary">{ALERTS.detail.todo}</h3>
        <Steps row={row} subject={subject} />
      </div>
    </DetailPanel>
  );
}
