/**
 * Setup done, `/onboarding/done` (canvas ON `Onb-Done`, `-Expiring`, `-Expiring-Renew`): shown
 * only when the server says the current step is DONE. The seal is drawn from the profile's
 * halal data and nothing else: with no halal object there is no seal, and the line under it is
 * the body's name and the end date, never a sentence we wrote about the claim.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, HalalBadge } from '../ds';
import { useConsole } from '../data/console';
import { responseWindowWords } from '../auth/api';
import { useOnboarding } from './context';
import { RenewPanel } from './RenewPanel';
import { halalRailLine, latestDocs, longDate } from './model';
import { DONE } from './copy';

export function DoneScreen() {
  const ctx = useOnboarding();
  const { config } = useConsole();
  const navigate = useNavigate();
  const [renewing, setRenewing] = useState(false);
  const halal = ctx.profile.data?.halal;
  const certificate = latestDocs(ctx.docs.data ?? []).get('HALAL_CERTIFICATE');
  const line = halalRailLine(halal, { step: 'DONE', paused: false, certificate, renewedNotSent: false });
  const expiring = halal?.display_state === 'EXPIRING_SOON' && halal.certifying_body_name && halal.expires_on;

  return (
    <div className="mx-auto flex w-full max-w-[1096px] flex-col gap-4 p-4 xl:p-6" data-testid="done-screen">
      <header className="flex flex-col gap-1">
        <h1 className="m-0 text-heading-xl text-fg-primary">{DONE.title}</h1>
        <p className="m-0 max-w-[68ch] text-body-md text-fg-secondary">{DONE.intro(ctx.businessName)}</p>
      </header>
      <div className="flex flex-col gap-4 lg:flex-row">
        <section aria-labelledby="done-l" className="flex min-w-0 flex-1 flex-col gap-4 rounded-[12px] border border-line-decorative bg-surface-raised p-4">
          <h2 id="done-l" className="m-0 text-heading-sm text-fg-primary">
            {DONE.listing}
          </h2>
          {halal ? (
            <div className="flex flex-col gap-2">
              <HalalBadge state={halal.display_state} surface="detail" size="md" restaurantId={ctx.profile.data?.id} certifyingBodyName={halal.certifying_body_name} expiresOn={halal.expires_on} />
              {line ? <p className="m-0 text-body-sm text-fg-secondary">{line}</p> : null}
            </div>
          ) : null}
          {expiring ? (
            <div className="flex flex-col gap-2" data-testid="expiring-note">
              <p className="m-0 text-body-md text-fg-primary">{DONE.expiring(halal.certifying_body_name!, longDate(halal.expires_on))}</p>
              <p className="m-0 text-body-sm text-fg-secondary">{DONE.reminders}</p>
              <div>
                <Button variant="tertiary" size="md" aria-expanded={renewing} onPress={() => setRenewing((r) => !r)}>
                  {DONE.renewButton}
                </Button>
              </div>
            </div>
          ) : null}
          <h3 className="m-0 text-label-lg text-fg-primary">{DONE.beforeFirst}</h3>
          <ol className="m-0 flex flex-col gap-2 ps-5 text-body-md text-fg-primary">
            <li>{DONE.step1}</li>
            <li>{DONE.step2}</li>
            <li>{DONE.step3(responseWindowWords(config.data))}</li>
          </ol>
          <div className="flex flex-col gap-1">
            <div>
              <Button variant="primary" size="lg" onPress={() => navigate('/orders')}>
                {DONE.go}
              </Button>
            </div>
            <span className="text-body-sm text-fg-secondary">{DONE.goHint}</span>
          </div>
        </section>
        {renewing ? (
          <section id="renew-panel" className="min-w-0 flex-1 rounded-[12px] border border-line-decorative bg-surface-raised p-4">
            <RenewPanel context="live" />
          </section>
        ) : null}
      </div>
    </div>
  );
}
