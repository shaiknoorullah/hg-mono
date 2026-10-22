/**
 * The ends and blockers of setup (canvas ON `Withdrawn`, `App-NotApproved`, `Suspended-Setup`,
 * `Deactivated-Setup`, `Delisted-Setup`): a withdrawn application, a final "not approved", a
 * suspended or deactivated account, and a halal certificate that lapsed during setup.
 *
 * Tone: slate throughout and never red, including for a halal certificate that has ended ("we
 * can't currently vouch for it", not a verdict). Setup never mentions a listing: nothing is
 * listed yet. Withdraw and Reactivate are not offered because the contract has no operation for
 * either; the way back is partner support.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Button, GlyphIcon, HalalBadge, InlineAlert } from '../ds';
import { client } from '../data/client';
import { attempt } from '../auth/api';
import { useOnboarding } from './context';
import { RenewPanel } from './RenewPanel';
import { rejectionApplicationView } from './endsModel';
import { longDate } from './model';
import { ENDS } from './copy';

function SupportCard({ lead }: { lead?: string }) {
  const { support } = useOnboarding();
  if (support === undefined) return null;
  return (
    <section className="flex flex-col gap-1 rounded-[12px] bg-surface-sunken p-4" data-testid="support-card">
      <span className="text-label-md text-fg-secondary">{lead ?? ENDS.support}</span>
      {support ? (
        <>
          <Button variant="secondary" size="md" href={`tel:${support.tel}`}>
            {support.display}
          </Button>
          {support.hours ? <span className="text-body-sm text-fg-secondary">{support.hours}</span> : null}
        </>
      ) : (
        <span className="text-body-sm text-fg-secondary">{ENDS.supportUnavailable}</span>
      )}
    </section>
  );
}

export function Withdrawn() {
  const ctx = useOnboarding();
  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4 p-6" data-testid="withdrawn">
      <h1 className="m-0 text-heading-xl text-fg-primary">{ENDS.withdrawnTitle}</h1>
      <p className="m-0 text-body-md text-fg-secondary">{ENDS.withdrawnBody(ctx.businessName)}</p>
      <SupportCard />
    </div>
  );
}

export function NotApproved() {
  const ctx = useOnboarding();
  const rejection = ctx.status.rejection;
  const view = rejectionApplicationView(rejection?.reason_code);
  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4 p-6" data-testid="not-approved">
      <h1 className="m-0 text-heading-xl text-fg-primary">{ENDS.notApprovedTitle(ctx.businessName)}</h1>
      <p className="m-0 text-body-md text-fg-secondary">{ENDS.notApprovedLead}</p>
      <section className="flex flex-col gap-2 rounded-[12px] border border-line-strong bg-surface-sunken p-4" aria-labelledby="nr-h">
        <span className="text-label-md text-fg-secondary">{ENDS.reason}</span>
        <h2 id="nr-h" className="m-0 text-heading-sm text-fg-primary">
          {view.title(ctx.businessName)}
        </h2>
        {view.body(ctx.businessName) ? <p className="m-0 text-body-md text-fg-primary">{view.body(ctx.businessName)}</p> : null}
        {rejection?.note ? (
          <>
            <span className="text-label-md text-fg-secondary">{ENDS.note}</span>
            <blockquote className="m-0 border-s border-line-strong ps-3 text-body-md text-fg-primary" data-testid="reviewer-note">
              {rejection.note}
            </blockquote>
          </>
        ) : null}
      </section>
      <SupportCard lead={ENDS.questions} />
    </div>
  );
}

function Pane({ icon, banner, bannerBody, title, children, right }: { icon: ReactNode; banner: string; bannerBody: string; title: string; children: ReactNode; right: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[1096px] flex-col gap-4 p-4 xl:p-6" data-testid="account-state">
      <section role="region" aria-labelledby="acct-h" className="flex items-start gap-3 rounded-[12px] border border-line-strong bg-surface-sunken p-4">
        <span className="mt-0.5 text-fg-primary">{icon}</span>
        <div className="flex flex-col gap-1">
          <strong id="acct-h" className="text-label-lg text-fg-primary">
            {banner}
          </strong>
          <span className="text-body-md text-fg-primary">{bannerBody}</span>
        </div>
      </section>
      <h1 className="m-0 text-heading-xl text-fg-primary">{title}</h1>
      <div className="flex flex-col gap-4 lg:flex-row">
        <section aria-labelledby="ac-why-h" className="flex min-w-0 flex-1 flex-col gap-3 rounded-[12px] border border-line-decorative bg-surface-raised p-4">
          <h2 id="ac-why-h" className="m-0 text-heading-sm text-fg-primary">
            {ENDS.whatsHappening}
          </h2>
          {children}
        </section>
        <section className="min-w-0 flex-1 rounded-[12px] border border-line-decorative bg-surface-raised p-4">{right}</section>
      </div>
    </div>
  );
}

/** SUSPENDED or DEACTIVATED during setup. */
export function PausedAccount({ kind }: { kind: 'SUSPENDED' | 'DEACTIVATED' }) {
  const ctx = useOnboarding();
  const [reason, setReason] = useState<string | null>(null);
  useEffect(() => {
    if (kind !== 'SUSPENDED') return;
    let live = true;
    void attempt(() => client.GET('/v1/restaurant/availability', {})).then((r) => {
      if (live && r.ok) setReason(((r.data as { reason?: string | null }).reason ?? '').trim() || null);
    });
    return () => {
      live = false;
    };
  }, [kind]);
  const name = ctx.businessName;
  if (kind === 'SUSPENDED') {
    return (
      <Pane icon={<GlyphIcon name="lock" size="md" />} banner={ENDS.suspendedBanner(name)} bannerBody={reason ?? ENDS.suspendedFallback} title={ENDS.suspendedTitle} right={<SupportCard />}>
        <p className="m-0 text-body-md text-fg-primary">{ENDS.suspendedBody(name)}</p>
      </Pane>
    );
  }
  return (
    <Pane icon={<GlyphIcon name="info" size="md" />} banner={ENDS.deactivatedBanner(name)} bannerBody={ENDS.deactivatedBannerBody} title={ENDS.deactivatedTitle} right={<SupportCard />}>
      <p className="m-0 text-body-md text-fg-primary">{ENDS.deactivatedBody}</p>
    </Pane>
  );
}

/** The halal certificate ended while setup was still open: a setup blocker, account stays pending. */
export function LapsedCertificate() {
  const ctx = useOnboarding();
  const halal = ctx.profile.data?.halal;
  const body = halal?.certifying_body_name ?? null;
  const date = longDate(halal?.expires_on);
  const [renewing, setRenewing] = useState(false);
  return (
    <Pane
      icon={<GlyphIcon name="clock" size="md" />}
      banner={ENDS.lapsedBanner}
      bannerBody={ENDS.lapsedBannerBody(body, date)}
      title={ENDS.lapsedTitle}
      right={renewing ? <RenewPanel context="setup" /> : <SupportCard />}
    >
      <p className="m-0 text-body-md text-fg-primary">{ENDS.lapsedBody}</p>
      <div className="flex flex-col gap-2 border-t border-line-decorative pt-3">
        <strong className="text-label-lg text-fg-primary">{ENDS.lapsedBanner}</strong>
        <p className="m-0 text-body-md text-fg-primary">{`${body ? `${body}’s certificate` : 'Your certificate'}${date ? ` ended on ${date}` : ' has ended'}, so we can’t currently vouch for it.`}</p>
        {halal ? <HalalBadge state={halal.display_state} surface="operational" size="md" restaurantId={ctx.profile.data?.id} /> : null}
        {!renewing ? (
          <div>
            <Button variant="primary" size="lg" onPress={() => setRenewing(true)}>
              Upload renewed certificate
            </Button>
          </div>
        ) : null}
      </div>
      <InlineAlert tone="neutral" icon="clock" title="Nothing else is lost">
        <span>{ENDS.lapsedClear}</span>
      </InlineAlert>
    </Pane>
  );
}
