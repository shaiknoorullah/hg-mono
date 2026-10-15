/**
 * The application pane (`DetailReview`, `DetailUnclaimed`, `DetailLockedByOther`, `DetailLockLost`,
 * `DetailPreSubmission`, `DetailRegistered`, `DetailPayoutPending`, `DetailActive`, `DetailUnder18`):
 * who holds it, what stops approval, the three decisions, the documents and the rider.
 *
 * - Blockers are the server's own lines, word for word.
 * - The age is the server's `computed_age_years`; the page never computes it. Under 18 turns
 *   Approve off for good ("no one can override this").
 * - The email is masked here; the board's reveal-with-a-reason flow has no API yet, so the full
 *   address is never shown.
 */
import { useRef, type RefObject } from 'react';
import { useHref } from 'react-router-dom';

import { Badge, Button, Countdown, Disclosure, Icon, InlineAlert, KeyValueList, Skeleton, useToast } from '../../ds';
import { DateCell } from '../../ds';
import { formatLongDate, formatTime } from '../../data/format';
import { formatLeft, minutesLeft, type ClaimView } from '../../verification/shared/claim';
import { attemptWord } from './wording';
import { STATE_LABEL, stateIcon, stateTone, vehicleLabel } from '../queue/model';
import {
  ageOf,
  blockersTitle,
  currentDocuments,
  documentIcon,
  documentLabel,
  documentTone,
  DOC_STATE_LABEL,
  isUnder18,
  readiness,
  statusLine,
  type Application,
  type DecisionGate,
  type Document,
  type Mode,
} from './model';
import { WORKSPACE } from './copy';
import type { DecisionKind } from './DecisionPanel';

interface Props {
  app: Application;
  mode: Mode;
  claim: ClaimView;
  gate: DecisionGate;
  /** The id of the document open in the viewer. */
  selectedId: string | null;
  onSelect: (id: string) => void;
  openPanel: DecisionKind | null;
  decisionRefs: Record<DecisionKind, RefObject<HTMLButtonElement | null>>;
  onOpenDecision: (kind: DecisionKind) => void;
  onTakeNext: () => void;
  taking: boolean;
  now: number;
}

/** "f•••••@g••••.com": a full email address is never shown on a review page. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at < 1) return '•••••';
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${email[0]}•••••@${host[0] ?? ''}••••${tld}`;
}

function claimStrip(mode: Mode, claim: ClaimView): { icon: 'lock' | 'info' | 'clock'; title: string; body: string; takeNext: boolean } | null {
  const ends = claim.kind === 'unclaimed' ? '' : formatTime(claim.expiresAt);
  switch (mode) {
    case 'claim-ended':
      return { icon: 'lock', ...WORKSPACE.claimEnded(ends), takeNext: true };
    case 'other-reviewer':
      return { icon: 'lock', ...WORKSPACE.otherReviewer(ends), takeNext: false };
    case 'inspect':
      return { icon: 'info', ...WORKSPACE.unclaimed, takeNext: true };
    default:
      return null;
  }
}

export function ApplicationPaneSkeleton() {
  return (
    <div className="p-4">
      <Skeleton variant="lines" count={6} label={WORKSPACE.loading} />
    </div>
  );
}

export function ApplicationPane({ app, mode, claim, gate, selectedId, onSelect, openPanel, decisionRefs, onOpenDecision, onTakeNext, taking, now }: Props) {
  const toast = useToast();
  const queueHref = useHref('/riders');
  const strip = claimStrip(mode, claim);
  const docs = currentDocuments(app.documents);
  const ready = readiness(app);
  const age = ageOf(app);
  const under18 = isUnder18(app);
  const canAct = mode === 'claimed' || mode === 'inspect' || mode === 'other-reviewer' || mode === 'claim-ended';
  const record = statusLine(mode, app.onboarding_state);
  const profile = app.profile;
  const vehicle = app.vehicle ?? null;
  const copyRef = useRef<HTMLButtonElement | null>(null);

  async function copyId() {
    try {
      await navigator.clipboard.writeText(app.rider_account_id);
      toast.show({ variant: 'neutral', title: WORKSPACE.copied });
    } catch {
      /* clipboard blocked: the id stays selectable on the page */
    }
  }

  const note =
    mode === 'other-reviewer'
      ? 'Deciding is off while another reviewer holds this application.'
      : mode === 'claim-ended'
        ? `Deciding is off: your claim ended at ${claim.kind === 'unclaimed' ? '' : formatTime(claim.expiresAt)}. Nothing was changed.`
        : mode === 'inspect'
          ? 'Deciding needs a claim. Only Take next claims, oldest first, and it may give you a different application.'
          : gate.canApprove
            ? 'Approving moves the rider to Payout pending. They take deliveries once payouts are confirmed.'
            : under18
              ? 'Approve rider is off: riders must be 18 or older and no one can override this. Request changes… and Reject… are available.'
              : 'Approve rider opens once nothing stops approval. Request changes and Reject are available now.';

  const claimMins = claim.kind === 'mine' ? minutesLeft(claim.expiresAt, now) : null;

  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-auto p-4" data-testid="ApplicationPane">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-heading-md text-fg-primary">{app.display_name}</h2>
          <Badge variant={stateTone(app.onboarding_state)} size="md" icon={stateIcon(app.onboarding_state)}>
            {STATE_LABEL[app.onboarding_state]}
          </Badge>
        </div>
        <p className="text-body-sm text-fg-secondary">
          {[
            vehicleLabel(app.vehicle_type),
            `submitted ${formatLongDate(app.submitted_at)}, ${formatTime(app.submitted_at)}`,
            `${attemptWord(app.attempt_number)} attempt`,
            mode === 'claimed' || mode === 'inspect' || mode === 'other-reviewer' || mode === 'claim-ended' ? `target ${formatLongDate(app.sla_due_at)}, ${formatTime(app.sla_due_at)}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </header>

      {mode === 'claimed' && claim.kind === 'mine' ? (
        <div className="flex flex-col gap-2" data-testid="ClaimStrip">
          <div className="flex items-start gap-2 rounded-md border border-line-decorative bg-surface-subtle p-3">
            <Icon name="lock" size="md" />
            <div>
              <p className="text-label-lg text-fg-primary">
                Claimed by you ·{' '}
                <Countdown variant="text" size="sm" expiresAt={claim.expiresAt} serverNow={new Date(now).toISOString()} windowSeconds={3600} criticalThreshold={0} label="left" />
              </p>
              <p className="text-body-sm text-fg-secondary">Your claim ends at {formatTime(claim.expiresAt)} and can’t be extended.</p>
            </div>
          </div>
          {claimMins !== null && claimMins <= 10 ? (
            <InlineAlert tone="warning" title={WORKSPACE.claimEnding(claimMins).title}>
              {WORKSPACE.claimEnding(claimMins).body}
            </InlineAlert>
          ) : null}
        </div>
      ) : strip ? (
        <div className="flex items-start gap-2 rounded-md border border-line-decorative bg-surface-subtle p-3" data-testid="ClaimStrip">
          <Icon name={strip.icon} size="md" />
          <div className="min-w-0 flex-1">
            <p className="text-label-lg text-fg-primary">{strip.title}</p>
            <p className="text-body-sm text-fg-secondary">{strip.body}</p>
            {claim.kind !== 'unclaimed' && mode === 'other-reviewer' ? <p className="text-body-sm text-fg-secondary">{formatLeft(claim.expiresAt, now)}</p> : null}
          </div>
          {strip.takeNext ? (
            <Button variant="primary" iconEnd="chevron-right" loading={taking} onPress={onTakeNext}>
              {WORKSPACE.takeNext}
            </Button>
          ) : null}
        </div>
      ) : record ? (
        <div className="flex items-start gap-2 rounded-md border border-line-decorative bg-surface-subtle p-3" data-testid="ClaimStrip">
          <Icon name="info" size="md" />
          <div className="min-w-0 flex-1">
            <p className="text-label-lg text-fg-primary">{mode === 'not-in-review' ? 'Not in review' : mode === 'changes-requested' ? 'Waiting on the rider' : 'Decided'}</p>
            <p className="text-body-sm text-fg-secondary">{record}</p>
          </div>
          <Button variant="tertiary" href={queueHref}>
            {WORKSPACE.backToQueue}
          </Button>
        </div>
      ) : null}

      {canAct ? (
        <Disclosure title="Decision readiness" meta={mode === 'claimed' ? `${ready.approved} of ${ready.total} documents approved` : undefined} defaultOpen headingLevel={3}>
          <div className="flex flex-col gap-3 pt-2">
            {app.blockers.length > 0 ? (
              <InlineAlert tone="neutral" title={blockersTitle(app.blockers.length)} items={app.blockers.map((b, i) => ({ id: `b-${i}`, content: b }))} />
            ) : mode === 'claimed' && gate.canApprove ? (
              <InlineAlert tone="success-tint" title="Nothing stops approval">
                Every document is approved and the rider is 18 or older.
              </InlineAlert>
            ) : null}

            <p className={under18 ? 'flex items-start gap-2 text-body-md text-fg-primary' : 'flex items-start gap-2 text-body-md text-fg-secondary'}>
              <Icon name={under18 ? 'lock' : age === null ? 'info' : 'check'} size="sm" />
              <span>
                {age === null ? (
                  <>Age not computed: the server has no date of birth to compute it from.</>
                ) : under18 ? (
                  <>
                    <strong>Age {age}</strong>, computed by the server. Riders must be 18 or older; no one can override this.
                  </>
                ) : (
                  <>
                    <strong>Age {age}</strong>, computed by the server. Meets the 18 or older rule.
                  </>
                )}
              </span>
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <Button variant="tertiary" ref={decisionRefs.reject} disabled={!gate.canDecide} aria-expanded={openPanel === 'reject'} onPress={() => onOpenDecision('reject')}>
                Reject…
              </Button>
              <Button variant="tertiary" ref={decisionRefs.changes} disabled={!gate.canDecide} aria-expanded={openPanel === 'changes'} onPress={() => onOpenDecision('changes')}>
                Request changes…
              </Button>
              <Button
                variant="primary"
                ref={decisionRefs.approve}
                disabled={!gate.canApprove}
                aria-expanded={openPanel === 'approve'}
                {...(!gate.canApprove && gate.approveWhy ? { accessibilityLabel: `Approve rider…, unavailable: ${gate.approveWhy}` } : {})}
                onPress={() => onOpenDecision('approve')}
              >
                Approve rider…
              </Button>
            </div>
            <p className="text-body-sm text-fg-secondary">{note}</p>
          </div>
        </Disclosure>
      ) : null}

      <Disclosure title="Documents" meta={docs.length > 0 ? `${docs.filter((d) => d.state === 'APPROVED').length} of ${docs.length} approved` : 'No documents uploaded yet'} defaultOpen headingLevel={3}>
        <div className="pt-2">
          {docs.length === 0 ? (
            <p className="text-body-md text-fg-secondary">The viewer opens here once the rider uploads documents and submits them for review.</p>
          ) : (
            <ul className="flex flex-col overflow-hidden rounded-md border border-line-decorative bg-surface-raised" data-testid="DocumentsList">
              {docs.map((doc) => (
                <DocumentRow key={doc.id} doc={doc} selected={doc.id === selectedId} onSelect={onSelect} />
              ))}
            </ul>
          )}
        </div>
      </Disclosure>

      <Disclosure title="Rider" defaultOpen headingLevel={3}>
        <div className="flex flex-col gap-2 pt-2">
          <KeyValueList
            dense
            items={[
              { label: 'Name', value: [profile.first_name, profile.last_name].filter(Boolean).join(' ') || null },
              { label: 'Email', value: maskEmail(profile.email) },
              { label: 'Date of birth', value: profile.date_of_birth ? formatLongDate(profile.date_of_birth) : null },
              { label: 'Vehicle', value: vehicle ? [vehicleLabel(vehicle.vehicle_type), vehicle.make, vehicle.model, vehicle.year, vehicle.colour].filter(Boolean).join(' · ') : vehicleLabel(app.vehicle_type) },
              { label: 'Plate', value: vehicle?.licence_plate ?? (app.vehicle_type === 'BICYCLE' || app.vehicle_type === 'ON_FOOT' ? 'None: no plate for this vehicle' : null), mono: Boolean(vehicle?.licence_plate) },
              { label: 'Attempt', value: String(app.attempt_number ?? 1) },
              { label: 'Rider ID', value: app.rider_account_id, mono: true },
            ]}
          />
          <Button variant="tertiary" size="sm" ref={copyRef} className="self-start" onPress={() => void copyId()}>
            Copy rider ID
          </Button>
        </div>
      </Disclosure>
    </div>
  );
}

function DocumentRow({ doc, selected, onSelect }: { doc: Document; selected: boolean; onSelect: (id: string) => void }) {
  const label = documentLabel(doc);
  return (
    <li className={selected ? 'bg-surface-sunken' : undefined}>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`Open ${label}, version ${doc.version}, ${DOC_STATE_LABEL[doc.state]}`}
        onClick={() => onSelect(doc.id)}
        className="flex min-h-11 w-full cursor-pointer items-center px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <span className="flex w-full items-center justify-between gap-2 text-start">
          <span className="flex min-w-0 flex-col leading-tight">
            <span className={selected ? 'flex items-center gap-1 font-bold text-fg-primary' : 'flex items-center gap-1 font-semibold text-fg-primary'}>
              {selected ? <Icon name="chevron-right" size="sm" /> : null}
              {label}
              {selected ? <span className="sr-only"> (open in the viewer)</span> : null}
            </span>
            <span className="text-body-sm text-fg-secondary">
              v{doc.version} · <DateCell value={doc.valid_until} mode="date" emptyText="No expiry" />
            </span>
          </span>
          <Badge variant={documentTone(doc.state)} size="md" icon={documentIcon(doc.state)}>
            {DOC_STATE_LABEL[doc.state]}
          </Badge>
        </span>
      </button>
    </li>
  );
}
