/**
 * The onboarding frame (restaurant onboarding, canvas ON `OnbTop` + `OnbSide`, boards `Onb-*`): a 64 px top bar
 * (brand, "Partner setup", the business name, an account menu with Sign out) and a collapsible
 * checklist rail beside the page. The rail shows what the server says: its `current_step`, its
 * `progress_percent` (never computed here) and the seal from `profile.halal` only. With no
 * `halal` object there is no badge at all, never a hopeful one.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Menu, Wordmark, Icon, IconButton, HalalBadge, ProgressBar, SetupChecklist } from '../ds';
import { useOnboarding } from './context';
import { STEP_LABEL, halalRailLine, latestDocs, railItems } from './model';
import { RAIL } from './copy';
import { rememberedEmail } from '../auth/api';

const RAIL_KEY = 'hg_restaurant_setup_rail_open_v1';

function readRail(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) !== '0';
  } catch {
    return true;
  }
}

function writeRail(open: boolean) {
  try {
    localStorage.setItem(RAIL_KEY, open ? '1' : '0');
  } catch {
    /* private window: the choice lasts this visit only */
  }
}

/**
 * The signed-in account's email is not in any read the app has: `/v1/auth/me` returns the role
 * grants and no email, the restaurant profile has no email field, and the staff list holds only
 * managers and staff, not the owner (https://github.com/shaiknoorullah/hg-mono/issues/1125).
 * What the app does know is the address that signed in on this device, which the sign-in screen
 * already keeps as a convenience (`rememberEmail`, written only after a restaurant sign-in
 * succeeds). It is read here and shown as the account menu's text; nothing new is stored. When
 * this device has no such address (a session that began elsewhere), the menu is the icon alone.
 */
export function SetupTopBar({ businessName, onSignOut }: { businessName: string; onSignOut: () => void }) {
  const [email] = useState(rememberedEmail);
  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-line-decorative bg-surface-base px-4 xl:px-7" data-testid="onboarding-top-bar">
      <a href="#main" className="hg-focus sr-only focus:not-sr-only focus:rounded-[12px] focus:bg-surface-raised focus:px-4 focus:py-2">
        Skip to main content
      </a>
      <Wordmark height={28} title="HalalGoes" />
      <span className="hidden border-s border-line-decorative ps-4 text-body-md text-fg-secondary sm:block">{RAIL.partnerSetup}</span>
      <span className="ms-auto min-w-0 truncate text-label-lg text-fg-primary" data-testid="business-name">
        {businessName}
      </span>
      <Menu
        label="Account"
        triggerLabel={email ? `Account menu, ${email}` : businessName ? `Account: ${businessName}` : 'Account'}
        trigger={
          email ? (
            <span className="inline-flex items-center gap-1.5">
              <span data-testid="account-email">{email}</span>
              <Icon name="back" size={16} className="-rotate-90" />
            </span>
          ) : (
            <Icon name="profile" size={22} />
          )
        }
        variant={email ? 'outline' : 'plain'}
        align="end"
        items={[{ key: 'signout', label: 'Sign out', onSelect: onSignOut }]}
        testId="account-menu"
      />
    </header>
  );
}

export function SetupRail() {
  const { status, profile, docs } = useOnboarding();
  const [open, setOpen] = useState(readRail);
  useEffect(() => writeRail(open), [open]);

  const account = profile.data?.account_state;
  const paused = account === 'SUSPENDED' || account === 'DEACTIVATED';
  const certificate = useMemo(() => latestDocs(docs.data ?? []).get('HALAL_CERTIFICATE'), [docs.data]);
  const halalExpiredInReview = status.current_step === 'AWAITING_REVIEW' && certificate?.state === 'EXPIRED';
  const items = railItems(status, { paused, halalExpiredInReview, hoursSet: status.current_step === 'DONE' });
  const halal = profile.data?.halal;
  const renewedNotSent = status.current_step === 'FIX_DOCUMENTS' && !!certificate && certificate.state !== 'REJECTED' && certificate.version > 1;
  const halalLine = halalRailLine(halal, { step: status.current_step, paused, certificate, renewedNotSent });
  const percent = status.progress_percent;
  const cycle = status.review_cycle ?? 0;

  if (!open) {
    return (
      <aside aria-label="Your setup, collapsed" className="flex w-14 shrink-0 flex-col border-e border-line-decorative bg-surface-base" data-testid="setup-rail-collapsed">
        <div className="flex flex-col items-center gap-1 py-2">
          <IconButton icon={<Icon name="menu" size={20} />} accessibilityLabel="Expand the setup checklist" aria-expanded={false} variant="plain" onPress={() => setOpen(true)} />
          <span className="text-label-md text-fg-secondary">{percent}%</span>
        </div>
        <SetupChecklist items={items} collapsed />
      </aside>
    );
  }

  return (
    <aside
      aria-label="Your setup"
      id="setup-rail"
      className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-b border-line-decorative bg-surface-base p-4 xl:w-72 xl:border-b-0 xl:border-e"
      data-testid="setup-rail"
    >
      <div className="flex items-center justify-between">
        <h2 className="m-0 text-heading-sm text-fg-primary">{RAIL.heading}</h2>
        <IconButton icon={<Icon name="back" size={20} />} accessibilityLabel="Collapse the setup checklist" aria-expanded={true} variant="plain" onPress={() => setOpen(false)} />
      </div>
      {paused ? (
        <p className="m-0 flex items-center gap-2 text-label-lg text-fg-primary" data-testid="rail-paused">
          {account === 'SUSPENDED' ? RAIL.pausedSuspended : RAIL.pausedDeactivated}
        </p>
      ) : (
        <p className="m-0 flex flex-col text-body-sm text-fg-secondary">
          <span>{RAIL.now}</span>
          <span className="text-label-lg text-fg-primary" data-testid="rail-current-step">
            {STEP_LABEL[status.current_step]}
          </span>
        </p>
      )}
      <div className="flex flex-col gap-1">
        <ProgressBar label="Setup progress" value={percent} valueText={`${percent}% complete`} />
        <span className="text-body-sm text-fg-secondary">{percent}% complete</span>
        {status.current_step === 'FIX_DOCUMENTS' ? <span className="text-body-sm text-fg-secondary">{RAIL.progressWentBack}</span> : null}
      </div>
      <SetupChecklist items={items} />
      {cycle >= 2 ? <p className="m-0 text-body-sm text-fg-secondary">{RAIL.reviewRound(cycle)}</p> : null}
      <section className="flex flex-col gap-2 border-t border-line-decorative pt-4" aria-labelledby="rail-halal-h">
        <h3 id="rail-halal-h" className="m-0 text-label-lg text-fg-primary">
          {RAIL.halalHeading}
        </h3>
        {halal ? (
          <>
            {/* The seal is drawn from the payload's own state; nothing renders for a state it does not know. */}
            <HalalBadge state={halal.display_state} surface="operational" size="md" restaurantId={profile.data?.id} />
            {halalLine ? <p className="m-0 text-body-sm text-fg-secondary" data-testid="rail-halal-line">{halalLine}</p> : null}
          </>
        ) : profile.status === 'ready' || profile.status === 'stale' ? (
          <p className="m-0 text-body-sm text-fg-secondary" data-testid="rail-no-halal">
            {RAIL.noHalal}
          </p>
        ) : null}
      </section>
    </aside>
  );
}

export function OnboardingFrame({ onSignOut, children }: { onSignOut: () => void; children: ReactNode }) {
  const { businessName } = useOnboarding();
  return (
    <div className="flex h-dvh flex-col bg-surface-sunken" data-testid="onboarding-frame">
      <SetupTopBar businessName={businessName} onSignOut={onSignOut} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto xl:flex-row xl:overflow-hidden">
        <SetupRail />
        <main id="main" tabIndex={-1} className="min-h-0 min-w-0 flex-1 xl:overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

