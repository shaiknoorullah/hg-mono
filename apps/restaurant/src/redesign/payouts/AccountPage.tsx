/**
 * Payouts, `/payouts` (canvas `PY` `Main`, `Payouts-*`): the payout account. What Stripe holds,
 * where payouts go, what Stripe still needs, and the one button that sends the owner to Stripe
 * to finish. Stripe owns the truth: this page reads `getConnectStatus`, reports it in plain
 * words and never decides eligibility itself. Orders never wait on payouts, and the page says so.
 *
 * `/payouts/return` and `/payouts/refresh` are where Stripe sends the owner back (the server
 * builds those links from its own configuration, so the page cannot choose them). The redirect is
 * not trusted: readiness is whatever `getConnectStatus` says, refreshed when
 * `connect.requirements_changed` arrives and every 30 seconds while Stripe is checking.
 */
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { eventOfType, useRealtimeChannel } from '@hg/ui-web/live';
import { idempotencyKey } from '@hg/api-client';
import { Badge, Button, DetailPanel, Icon, InlineAlert, KeyValueList, Skeleton } from '../ds';
import { useConsole } from '../data/console';
import { useServerResource } from '../data/useServerResource';
import { usePagePanelOpen } from '../shell/layout';
import { loadConnect, openStripe } from './api';
import { PayoutSupport } from './PayoutSupport';
import {
  accountCard,
  accountMode,
  bankLast4,
  neededCount,
  requirementGroups,
  restrictedKind,
  things,
  longDate,
  type ConnectStatus,
} from './model';

/** Where Stripe's own page opens. A seam so tests do not navigate the test browser. */
export const stripeNavigation = {
  go: (url: string) => window.location.assign(url),
};

type Problem = null | 'create' | 'link' | 'step-na' | 'expired';

const KEEP_TAKING_ORDERS = 'You can keep taking orders. What you earn is kept on record and paid out once Stripe has what it needs.';
const OPENS_STRIPE = "Opens Stripe. You come back here when you're done.";

export function AccountPage() {
  const { profile, core, timezone } = useConsole();
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const returning = location.pathname.endsWith('/payouts/return');
  const status = useServerResource(loadConnect);
  const [problem, setProblem] = useState<Problem>(location.pathname.endsWith('/payouts/refresh') ? 'expired' : null);
  const [busy, setBusy] = useState(false);
  const accountKey = useRef<string | null>(null);
  const panel = search.get('panel') === 'list' ? 'list' : search.get('panel') === 'support' ? 'support' : null;
  usePagePanelOpen(panel !== null);

  const restaurantId = core.data?.restaurantId ?? null;
  useRealtimeChannel(restaurantId ? `restaurant:${restaurantId}` : null, (signal) => {
    if (signal.kind === 'refetch' || eventOfType(signal, 'connect.requirements_changed')) void status.refresh();
  });

  const connect: ConnectStatus | null = status.data ?? null;
  const loaded = status.status === 'ready' || status.status === 'stale';
  const mode = accountMode(loaded ? connect : null);
  const restricted = restrictedKind(profile.data?.account_state);
  const notApproved = profile.data?.account_state === 'PENDING';

  // Stripe finishes on its own clock: while it is checking, look again every 30 seconds.
  useEffect(() => {
    if (mode !== 'checking') return;
    const id = window.setInterval(() => void status.refresh(), 30_000);
    return () => window.clearInterval(id);
  }, [mode, status]);

  const openPanel = (name: 'list' | 'support' | null) => {
    const q = new URLSearchParams(search);
    if (name) q.set('panel', name);
    else q.delete('panel');
    setSearch(q);
  };

  const start = async () => {
    setBusy(true);
    setProblem(null);
    accountKey.current = accountKey.current ?? idempotencyKey();
    const outcome = await openStripe(mode === 'none', accountKey.current, stripeNavigation.go);
    if (outcome.account) status.mutate(() => outcome.account!);
    if (outcome.problem) setProblem(outcome.problem);
    setBusy(false);
  };

  const card = accountCard(loaded ? connect : null, restricted);
  const groups = connect ? requirementGroups(connect, timezone) : [];
  const n = connect ? neededCount(connect) : 0;
  const past = connect?.requirements.past_due.length ?? 0;
  const deadline = connect?.requirements.deadline ? longDate(connect.requirements.deadline, timezone) : null;
  const finishDisabled = problem === 'step-na';

  const finishButton = (
    <Button variant="primary" size="md" loading={busy} disabled={finishDisabled} onPress={() => void start()}>
      Finish payout setup in Stripe
    </Button>
  );
  const listButton = (
    <Button variant="tertiary" size="md" onPress={() => openPanel('list')}>
      See Stripe's exact list
    </Button>
  );

  return (
    <div className="flex min-h-0 flex-1 gap-4" data-testid="payouts-account" data-mode={loaded ? mode : status.status}>
      <main className={`flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto pb-6${panel ? ' max-lg:hidden' : ''}`}>
        {restricted ? (
          <InlineAlert tone="neutral" title={restricted === 'banned' ? 'No payouts while this account is banned' : 'No payouts while your account is suspended'} testId="banner-restricted">
            <span>
              {restricted === 'banned'
                ? 'No payouts are created while this account is banned. Earnings already on record stay on record. Contact support about them.'
                : "No payouts are created while your account is suspended. Earnings keep adding up and are paid when it's reinstated."}
            </span>
            <div className="pt-1">
              <Button variant="tertiary" size="md" onPress={() => openPanel('support')}>
                Contact support
              </Button>
            </div>
          </InlineAlert>
        ) : null}

        {loaded && mode === 'none' ? (
          <InlineAlert tone="info" title="Set up payouts so HalalGoes can pay you" testId="banner-none">
            <span>Stripe holds your bank details and sends your payouts. It takes about 10 minutes and needs your bank account and photo ID.</span>
            {notApproved ? <strong className="text-label-lg">Payout setup opens once HalalGoes approves your documents.</strong> : null}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button variant="primary" size="md" loading={busy} disabled={notApproved || finishDisabled} onPress={() => void start()}>
                {busy ? 'Setting up with Stripe' : 'Set up payouts with Stripe'}
              </Button>
              <span className="text-body-sm text-fg-secondary">
                {notApproved ? "Your restaurant is still being checked. We'll let you know when you can set this up." : busy ? 'Creating your payout account. Stripe opens in a moment.' : OPENS_STRIPE}
              </span>
            </div>
          </InlineAlert>
        ) : null}

        {loaded && mode === 'due-soon' ? (
          <InlineAlert tone="warning" title={`Stripe needs ${things(n)} from you${deadline ? ` by ${deadline}` : ''}`} testId="banner-due-soon">
            <span>
              Payouts are on for now.{deadline ? ` If Stripe doesn’t have these by ${deadline}, it pauses payouts until they’re done.` : ''}
            </span>
            <strong className="text-label-lg">{KEEP_TAKING_ORDERS}</strong>
            <Actions finish={finishButton} list={listButton} opens={OPENS_STRIPE} />
          </InlineAlert>
        ) : null}

        {loaded && mode === 'held' ? (
          <InlineAlert tone="warning" title={returning ? `Stripe still needs ${things(n)} from you` : `Stripe needs ${things(n)} from you before it can pay you`} testId="banner-held">
            <span>
              {past > 0 ? `${past} past due. ` : ''}
              {deadline && n - past > 0 ? `${past > 0 ? 'The rest are' : 'They are'} needed by ${deadline}. ` : ''}
              Payouts are on hold until they’re done.
            </span>
            <strong className="text-label-lg">{KEEP_TAKING_ORDERS}</strong>
            {past > 0 ? <span>Why payouts are off: something Stripe asked for is past its due date.</span> : null}
            <Actions finish={finishButton} list={panel === 'list' ? null : listButton} opens={panel === 'list' || finishDisabled ? null : OPENS_STRIPE} />
          </InlineAlert>
        ) : null}

        {loaded && mode === 'checking' ? (
          <InlineAlert tone="info" icon="refresh" title="Checking with Stripe…" testId="banner-checking">
            <span>
              {returning ? 'Welcome back. ' : ''}Stripe tells HalalGoes when it has checked your details, and this page updates by itself. It usually takes a minute or two. You can leave this page; nothing is lost.
            </span>
          </InlineAlert>
        ) : null}

        {loaded && mode === 'on' && returning ? (
          <InlineAlert tone="info" icon="check" title="Payouts are on" testId="banner-on">
            <span>
              Stripe has what it needs. Earnings kept on record go out with your next payout{bankLast4(connect) ? `, into the bank account ending ${bankLast4(connect)}` : ''}.
            </span>
          </InlineAlert>
        ) : null}

        {problem === 'create' || problem === 'link' || problem === 'expired' ? (
          <InlineAlert tone={problem === 'expired' ? 'info' : 'danger'} blocking={problem !== 'expired'} title={problem === 'expired' ? 'That Stripe link expired' : problem === 'create' ? 'Couldn’t start payout setup' : 'Couldn’t open Stripe'} testId={`problem-${problem}`}>
            <span>
              {problem === 'expired' ? 'Stripe links last a few minutes. Open a new one to carry on where you left off.' : 'Check your connection and try again.'}
            </span>
            <div className="pt-1">
              <Button variant="primary" size="md" loading={busy} onPress={() => void start()}>
                {problem === 'expired' ? 'Open Stripe again' : 'Try again'}
              </Button>
            </div>
          </InlineAlert>
        ) : null}
        {problem === 'step-na' ? (
          <InlineAlert tone="warning" blocking title="Payout setup can’t be opened right now" testId="problem-step-na">
            <span>Contact HalalGoes support and we’ll sort it out.</span>
            <div className="pt-1">
              <Button variant="primary" size="md" onPress={() => openPanel('support')}>
                Contact support
              </Button>
            </div>
          </InlineAlert>
        ) : null}

        <div className={`grid grid-cols-1 gap-4${panel ? '' : ' md:grid-cols-2'}`}>
          <section aria-labelledby="acct-h" className="rounded-lg border border-line-decorative bg-surface-raised p-4 md:p-6" aria-busy={status.status === 'loading'}>
            <h2 id="acct-h" className="m-0 mb-3 text-heading-md">
              Payout account
            </h2>
            {status.status === 'loading' ? (
              <div className="flex flex-col gap-3" data-testid="account-loading" aria-hidden="true">
                <Skeleton variant="rect" width={140} height={28} />
                <Skeleton variant="rect" width="100%" height={20} />
                <Skeleton variant="rect" width="100%" height={20} />
                <Skeleton variant="rect" width="100%" height={20} />
              </div>
            ) : status.status === 'error' ? (
              <div role="alert" className="flex flex-col items-start gap-2" data-testid="account-error">
                <strong className="text-label-lg">Couldn't load your payout account</strong>
                <span className="text-body-md text-fg-secondary">Your payouts themselves are not affected, and orders keep coming in.</span>
                <Button variant="tertiary" size="md" onPress={status.reload}>
                  Try again
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {status.status === 'stale' ? (
                  <span role="status" className="text-body-sm text-fg-secondary" data-testid="account-stale">
                    This is the last answer we had. We couldn’t check just now.
                  </span>
                ) : null}
                <div className="flex flex-wrap items-center gap-3">
                  <Badge label={card.badge} variant={card.tone} icon={card.icon} size="md" />
                  <span className="text-body-md">{card.sentence}</span>
                </div>
                <KeyValueList rows={card.rows} testId="account-rows" />
              </div>
            )}
          </section>

          <section aria-labelledby="req-h" className="rounded-lg border border-line-decorative bg-surface-raised p-4 md:p-6" aria-busy={status.status === 'loading'}>
            <h2 id="req-h" className="m-0 mb-3 text-heading-md">
              What Stripe needs from you
            </h2>
            {status.status === 'loading' ? (
              <div className="flex flex-col gap-3" aria-hidden="true">
                <Skeleton variant="rect" width="100%" height={20} />
                <Skeleton variant="rect" width="100%" height={20} />
              </div>
            ) : status.status === 'error' ? (
              <Plain title="Shown once your payout account loads" sub="Nothing here changes your orders." />
            ) : mode === 'none' ? (
              <Plain title="Your bank account and photo ID" sub="Stripe asks for them when you set up payouts." />
            ) : groups.length === 0 ? (
              <Plain icon="check" title="Nothing right now" sub="If Stripe asks for anything, it shows here with the date it’s needed by." />
            ) : (
              <div className="flex flex-col gap-2">
                <dl className="m-0 flex flex-col" data-testid="req-counts">
                  {groups.map((g) => (
                    <div key={g.key} className="flex justify-between gap-4 border-t border-line-decorative py-3 first:border-t-0">
                      <dt className="text-body-md text-fg-secondary">{g.title}</dt>
                      <dd className="m-0 text-body-md font-medium">{g.items.length}</dd>
                    </div>
                  ))}
                </dl>
                <div>{listButton}</div>
              </div>
            )}
          </section>
        </div>

        <div className="flex flex-col items-start gap-2">
          <Button variant="tertiary" size="md" onPress={() => navigate('/payouts/history')}>
            See your payouts
          </Button>
          <p className="m-0 max-w-[720px] text-body-sm text-fg-secondary">
            Orders never wait on payouts. If Stripe later needs something from a working payout account, you keep taking orders, and what you earn is kept on record until it can be paid out.
          </p>
        </div>
      </main>

      {panel === 'list' && connect ? (
        <DetailPanel
          title="Stripe's exact list"
          label="Stripe's exact list"
          closeLabel="Close Stripe’s list"
          onClose={() => openPanel(null)}
          width="task"
          fullBelowLg
          testId="stripe-list-panel"
          footer={mode === 'on' || mode === 'checking' ? undefined : <div className="flex flex-col gap-2">{finishButton}</div>}
        >
          <div className="flex flex-col gap-4">
            <p className="m-0 text-body-md">Stripe explains each item when you open it. The Stripe reference under each one is for HalalGoes support.</p>
            {groups.map((g) => (
              <div key={g.key} className="flex flex-col gap-1">
                <h3 className="m-0 text-heading-sm">{g.title}</h3>
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {g.items.map((it) => (
                    <li key={it.code} className="flex flex-col">
                      <span className="text-body-md">{it.words}</span>
                      <span className="text-body-sm text-fg-secondary">
                        Stripe reference: <span lang="zxx" className="font-mono">{it.code}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </DetailPanel>
      ) : null}
      {panel === 'support' ? <PayoutSupport onClose={() => openPanel(null)} /> : null}
    </div>
  );
}

function Actions({ finish, list, opens }: { finish: React.ReactNode; list: React.ReactNode; opens: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-3 pt-1">
      {finish}
      {list}
      {opens ? <span className="text-body-sm text-fg-secondary">{opens}</span> : null}
    </div>
  );
}

function Plain({ title, sub, icon = 'info' }: { title: string; sub: string; icon?: 'check' | 'info' }) {
  return (
    <div className="flex items-start gap-3" data-testid="req-plain">
      {icon === 'check' ? <Icon name="check" size={20} /> : null}
      <span className="flex flex-col">
        <span className="text-body-md font-medium">{title}</span>
        <span className="text-body-sm text-fg-secondary">{sub}</span>
      </span>
    </div>
  );
}
