/**
 * The application pane (`RV/AppBody`, `App-Inspect`, `App-ReadOnly`, `App-Support`, `App-Decided`,
 * `App-Rejected`, `App-ChangesRequested`, `App-Withdrawn`, `App-NoCertificate`): who holds it,
 * what stops approval, the three decisions, the halal certificate and the business profile.
 *
 * The halal strip is bound only to `profile.halal` for the badge: a missing value draws no badge.
 * "No halal certificate record" is a different case from a record with its document missing, and
 * neither draws a badge.
 */
import type { RefObject } from 'react';
import { useHref } from 'react-router-dom';

import { Badge, Button, Countdown, Icon, InlineAlert, KeyValueList, Skeleton } from '../../ds';
import { formatLongDate, formatTime } from '../../data/format';
import { CertificateStatusBadge, RestaurantHalalBadge } from '../shared/halal';
import { rollupText, summarise } from '../shared/checks';
import { formatLeft, type ClaimView } from '../shared/claim';
import { attemptLabel, STATE_LABEL, stateTone } from '../queue/model';
import { blockersTitle, statusLine, type Application, type BlockerLine, type DecisionGate, type Mode } from './model';
import type { DecisionKind } from './DecisionPanel';

interface Props {
  app: Application;
  mode: Mode;
  claim: ClaimView;
  gate: DecisionGate;
  blockers: readonly BlockerLine[];
  consoleHref: string | null;
  openPanel: DecisionKind | null;
  decisionRefs: Record<DecisionKind, RefObject<HTMLButtonElement | null>>;
  onOpenDecision: (kind: DecisionKind) => void;
  onTakeNext: () => void;
  taking: boolean;
  takeFailed: boolean;
}

/** "+1 416 ••• ••84": a phone number is never shown in full on a review page. */
export function maskPhone(e164: string | null | undefined): string | null {
  if (!e164) return null;
  const m = /^\+1(\d{3})\d{3}(\d{4})$/.exec(e164);
  if (m) return `+1 ${m[1]} ••• ••${m[2]!.slice(2)}`;
  return `${e164.slice(0, 4)} ••• ••${e164.slice(-2)}`;
}

function claimStrip(mode: Mode, claim: ClaimView, name: string): { icon: 'lock' | 'info' | 'clock' | 'check'; title: string; body: string; takeNext: boolean } | null {
  const ends = claim.kind === 'unclaimed' ? '' : formatTime(claim.expiresAt);
  switch (mode) {
    case 'claim-ended':
      return {
        icon: 'lock',
        title: `Your claim ended at ${ends}`,
        body: `${name} went back to the queue in its place. Deciding is off here. Take next gives you the oldest unclaimed application.`,
        takeNext: true,
      };
    case 'other-reviewer':
      return {
        icon: 'lock',
        title: `Another reviewer holds this until ${ends}`,
        body: 'After that it returns to the queue in its place, oldest first. Take next gives you the oldest unclaimed application, which may not be this one.',
        takeNext: false,
      };
    case 'inspect':
      return {
        icon: 'info',
        title: 'Not claimed · You are inspecting',
        body: 'Only Take next claims, oldest first. It may give you a different application.',
        takeNext: true,
      };
    case 'support':
      return { icon: 'lock', title: 'Read-only for support', body: 'Document status only. No viewer, no checks.', takeNext: false };
    case 'decided':
      return { icon: 'check', title: 'Decided', body: statusLine('decided') ?? '', takeNext: false };
    case 'changes-requested':
      return { icon: 'clock', title: 'Waiting on the restaurant', body: statusLine('changes-requested') ?? '', takeNext: false };
    case 'withdrawn':
      return { icon: 'info', title: 'Withdrawn', body: statusLine('withdrawn') ?? '', takeNext: false };
    default:
      return null;
  }
}

export function ApplicationPaneSkeleton() {
  return (
    <div className="p-4">
      <Skeleton variant="lines" count={6} label="Loading the application" />
    </div>
  );
}

export function ApplicationPane({ app, mode, claim, gate, blockers, consoleHref, openPanel, decisionRefs, onOpenDecision, onTakeNext, taking, takeFailed }: Props) {
  const support = mode === 'support';
  const profile = app.profile;
  const cert = app.halal_certificate ?? null;
  const halalRejected = cert?.status === 'REJECTED';
  const noCertificate = cert === null;
  const queueHref = useHref('/restaurants');
  const strip = claimStrip(mode, claim, app.display_name);
  const canAct = mode === 'claimed' || mode === 'inspect' || mode === 'other-reviewer' || mode === 'claim-ended';
  const rollup = cert ? summarise(cert.checks) : null;
  const addr = profile.address;

  const decisionTitle =
    mode === 'support' ? 'Decision readiness' : mode === 'withdrawn' ? 'Withdrawn' : mode === 'decided' || mode === 'changes-requested' ? 'Decision' : 'Decide on this application';

  const note = halalRejected
    ? 'Approve isn’t possible: the halal certificate was rejected. Request changes… opens with Halal certificate ticked under Documents to redo. You can untick it.'
    : mode === 'other-reviewer'
      ? 'Deciding is off while another reviewer holds this application.'
      : mode === 'claim-ended'
        ? `Deciding is off: your claim ended at ${claim.kind === 'unclaimed' ? '' : formatTime(claim.expiresAt)}. Nothing was changed.`
        : mode === 'inspect'
          ? 'Deciding needs a claim. Only Take next claims, oldest first, and it may give you a different application.'
          : gate.canApprove
            ? `Approving doesn’t make ${app.display_name} live: payouts and its menu, reviewed in Menu reviews, come next.`
            : 'Approve opens once nothing stops approval. Request changes and Reject are available now.';

  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-auto p-4" data-testid="ApplicationPane">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-heading-md text-fg-primary">{app.display_name}</h2>
          <Badge variant={stateTone(app.onboarding_state)} size="md">
            {STATE_LABEL[app.onboarding_state]}
          </Badge>
        </div>
        <p className="text-body-sm text-fg-secondary">
          {[
            `${app.city ?? ''}${app.province ? `, ${app.province}` : ''}`,
            `submitted ${formatLongDate(app.submitted_at)}, ${formatTime(app.submitted_at)}`,
            `${attemptLabel(app.submission_count)} submission`,
            mode === 'claimed' || mode === 'inspect' || mode === 'other-reviewer' || mode === 'claim-ended' ? `SLA due ${formatLongDate(app.sla_due_at)}, ${formatTime(app.sla_due_at)}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </header>

      {mode === 'claimed' && claim.kind === 'mine' ? (
        <div className="flex items-start gap-2 rounded-md border border-line-decorative bg-surface-subtle p-3" data-testid="ClaimStrip">
          <Icon name="lock" size="md" />
          <div>
            <p className="text-label-lg text-fg-primary">
              Claimed by you ·{' '}
              <Countdown variant="text" size="sm" expiresAt={claim.expiresAt} serverNow={new Date().toISOString()} windowSeconds={3600} criticalThreshold={0} label="left" />
            </p>
            <p className="text-body-sm text-fg-secondary">Your claim ends at {formatTime(claim.expiresAt)} and can’t be extended.</p>
          </div>
        </div>
      ) : strip ? (
        <div className="flex items-start gap-2 rounded-md border border-line-decorative bg-surface-subtle p-3" data-testid="ClaimStrip">
          <Icon name={strip.icon} size="md" />
          <div className="min-w-0 flex-1">
            <p className="text-label-lg text-fg-primary">{strip.title}</p>
            <p className="text-body-sm text-fg-secondary">{strip.body}</p>
            {claim.kind !== 'unclaimed' && mode === 'other-reviewer' ? <p className="text-body-sm text-fg-secondary">{formatLeft(claim.expiresAt)}</p> : null}
          </div>
          {strip.takeNext ? (
            <Button variant="primary" iconEnd="chevron-right" loading={taking} onPress={onTakeNext}>
              Take next
            </Button>
          ) : null}
        </div>
      ) : null}
      {takeFailed ? (
        <InlineAlert tone="warning" blocking title="Take next didn’t work">
          The server didn’t respond. Nothing was claimed. Try again.
        </InlineAlert>
      ) : null}

      <section aria-labelledby="decision-heading" className="flex flex-col gap-3">
        <h3 id="decision-heading" className="text-heading-sm text-fg-primary">
          {decisionTitle}
        </h3>

        {mode === 'decided' || mode === 'changes-requested' || mode === 'withdrawn' ? (
          <div className="flex flex-col gap-1" data-testid="DecisionRecord">
            <p className="text-body-md text-fg-primary">{statusLine(mode)}</p>
            {app.onboarding_state === 'PAYOUT_PENDING' ? (
              <p className="text-body-md text-fg-secondary">
                {app.display_name} is now Payout pending. It goes live once payouts are set up and its menu is approved in Menu reviews.
              </p>
            ) : null}
            {mode === 'changes-requested' ? <p className="text-body-md text-fg-secondary">Nothing to decide until the restaurant uploads a new version.</p> : null}
            <Button variant="tertiary" href={queueHref} className="mt-1 self-start">
              Back to applications
            </Button>
          </div>
        ) : (
          <>
            {blockers.length > 0 ? (
              <InlineAlert
                tone="neutral"
                title={blockersTitle(blockers.length)}
                items={blockers.map((b) => ({
                  id: b.id,
                  content: (
                    <>
                      {b.text}
                      {b.toVerification && consoleHref && !support ? (
                        <>
                          {' '}
                          <a className="text-link underline" href={consoleHref}>
                            Open verification
                          </a>
                        </>
                      ) : null}
                    </>
                  ),
                }))}
              />
            ) : mode === 'claimed' && !halalRejected ? (
              <InlineAlert tone="success-tint" title="Nothing stops approval">
                Every required document and the halal certificate are approved, and the address has map coordinates.
              </InlineAlert>
            ) : null}

            {halalRejected && mode === 'claimed' ? (
              <InlineAlert tone="neutral" icon="info" title={`${app.display_name}’s application still needs a decision`}>
                Ask for a new halal certificate with Request changes…, or reject the application.
                {claim.kind === 'mine' ? ` Your claim is still held until ${formatTime(claim.expiresAt)}.` : ''}
              </InlineAlert>
            ) : null}

            {!support && canAct ? (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="tertiary"
                    ref={decisionRefs.reject}
                    disabled={!gate.canDecide}
                    aria-expanded={openPanel === 'reject'}
                    onPress={() => onOpenDecision('reject')}
                  >
                    Reject…
                  </Button>
                  <Button
                    variant={halalRejected || noCertificate ? 'primary' : 'tertiary'}
                    ref={decisionRefs.changes}
                    disabled={!gate.canDecide}
                    aria-expanded={openPanel === 'changes'}
                    onPress={() => onOpenDecision('changes')}
                  >
                    Request changes…
                  </Button>
                  <Button
                    variant="primary"
                    ref={decisionRefs.approve}
                    disabled={!gate.canApprove}
                    aria-expanded={openPanel === 'approve'}
                    {...(!gate.canApprove && gate.approveWhy ? { accessibilityLabel: `Approve…, unavailable: ${gate.approveWhy}` } : {})}
                    onPress={() => onOpenDecision('approve')}
                  >
                    Approve…
                  </Button>
                </div>
                <p className="text-body-sm text-fg-secondary">{note}</p>
              </>
            ) : null}
          </>
        )}
      </section>

      {!support ? (
        <section aria-labelledby="halal-heading" className="flex flex-col gap-2 border-t border-line-decorative pt-3" data-testid="HalalStrip">
          <h3 id="halal-heading" className="text-heading-sm text-fg-primary">
            Halal certificate
          </h3>
          {noCertificate ? (
            <InlineAlert
              tone="neutral"
              title="No halal certificate record"
              action={
                canAct && gate.canDecide ? (
                  <Button variant="tertiary" onPress={() => onOpenDecision('changes')}>
                    Request changes…
                  </Button>
                ) : undefined
              }
            >
              The restaurant hasn’t uploaded a halal certificate, so there is nothing to verify and no badge. This is different from a record with its document missing.
            </InlineAlert>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body-md text-fg-secondary">Restaurant now:</span>
                <RestaurantHalalBadge halal={profile.halal} />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-body-md text-fg-primary">
                <CertificateStatusBadge status={cert.status} expiresOn={cert.expires_on} />
                <span className="text-fg-secondary">
                  {[cert.issuing_body?.name, cert.expires_on ? `expires ${formatLongDate(cert.expires_on)}` : null].filter(Boolean).join(' · ')}
                </span>
              </div>
              {rollup ? <p className="text-body-md text-fg-secondary">{rollupText(rollup)}</p> : null}
              {consoleHref ? (
                <Button variant="secondary" iconEnd="chevron-right" href={consoleHref} className="self-start">
                  {mode === 'claimed' ? 'Open verification' : cert.status === 'PENDING' ? 'View verification (read-only)' : 'View verification'}
                </Button>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      <section aria-labelledby="profile-heading" className="flex flex-col gap-2 border-t border-line-decorative pt-3">
        <h3 id="profile-heading" className="text-heading-sm text-fg-primary">
          Business profile
        </h3>
        {support ? (
          <>
            <KeyValueList
              dense
              items={[
                { label: 'Display name', value: app.display_name },
                { label: 'City', value: `${app.city ?? ''}${app.province ? `, ${app.province}` : ''}` },
                { label: 'State', value: STATE_LABEL[app.onboarding_state] },
              ]}
            />
            <p className="text-body-sm text-fg-secondary">
              Support agents see display name, city, onboarding state and each document’s status and rejection reason only.
            </p>
          </>
        ) : (
          <KeyValueList
            dense
            items={[
              { label: 'Display name', value: profile.display_name },
              { label: 'Legal name', value: profile.legal_name },
              { label: 'Owner', value: [profile.owner_first_name, profile.owner_last_name].filter(Boolean).join(' ') || null },
              { label: 'Phone', value: maskPhone(profile.phone_e164) },
              { label: 'GST/HST number', value: profile.gst_hst_number, mono: true },
              {
                label: 'Address',
                value: [addr.line1, addr.line2, `${addr.city} ${addr.province} ${addr.postal_code}`].filter(Boolean).join(', '),
              },
              { label: 'Delivery radius', value: profile.delivery_radius_m != null ? `${profile.delivery_radius_m / 1000} km` : null },
            ]}
          />
        )}
        {!support && app.address_pin_warning ? (
          <p className="flex items-start gap-2 text-body-sm text-fg-secondary">
            <Icon name="warning" size="sm" />
            {app.address_pin_warning}
          </p>
        ) : null}
      </section>
    </div>
  );
}

