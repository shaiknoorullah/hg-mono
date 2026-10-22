/**
 * Payout setup, `/onboarding/payout` (+ `/payout/return`, `/payout/refresh`; canvas ON
 * `Payout-*`). Stripe collects the business and bank details on its own site; this page creates
 * the connected account (once: the idempotency key is kept across retries), asks for a fresh
 * onboarding link each time, sends the owner there, and reports Stripe's status in plain words.
 * HalalGoes only ever sees the last four digits of the bank account. Stripe's requirement names
 * are shown verbatim but secondary.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { eventOfType, useRealtimeChannel } from '@hg/ui-web/live';
import { idempotencyKey } from '@hg/api-client';
import { Button, Disclosure, InlineAlert, KeyValueList, Skeleton, type KeyValueRow } from '../ds';
import { client } from '../data/client';
import { attempt } from '../auth/api';
import { useServerResource } from '../data/useServerResource';
import { useOnboarding } from './context';
import { BLOCKING_COPY, longDate } from './model';
import { listedRequirements, payoutMode, requirementWords, type ConnectStatus, type PayoutMode } from './payout';
import { PAYOUT } from './copy';

type Problem = null | 'create' | 'link' | 'status' | 'step-na' | 'link-expired';

export function PayoutScreen() {
  const ctx = useOnboarding();
  const location = useLocation();
  const navigate = useNavigate();
  const returning = location.pathname.endsWith('/payout/return');
  const refreshing = location.pathname.endsWith('/payout/refresh');

  const load = useCallback(async (): Promise<ConnectStatus | null> => {
    const res = await attempt(() => client.GET('/v1/connect/status', {}));
    if (res.ok) return res.data as ConnectStatus;
    if (!res.network && res.status === 404) return null;
    throw new Error('status');
  }, []);
  const status = useServerResource(load);
  const [problem, setProblem] = useState<Problem>(refreshing ? 'link-expired' : null);
  const [busy, setBusy] = useState(false);
  const [continueError, setContinueError] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(false);
  const accountKey = useRef<string | null>(null);

  useRealtimeChannel(`restaurant:${ctx.restaurantId}`, (signal) => {
    if (signal.kind === 'refetch' || eventOfType(signal, 'connect.requirements_changed')) void status.refresh();
  });
  // Stripe finishes on its own clock: while it is checking, look again every 30 seconds.
  const mode: PayoutMode = status.status === 'ready' || status.status === 'stale' ? payoutMode(status.data) : 'not-started';
  useEffect(() => {
    if (mode !== 'verifying') return;
    const id = window.setInterval(() => void status.refresh(), 30_000);
    return () => window.clearInterval(id);
  }, [mode, status]);

  // Back from Stripe with payouts on: say so for two seconds, then open the next step.
  const advanced = useRef(false);
  const goNext = useCallback(async () => {
    try {
      await ctx.refreshAll();
      setContinueError(false);
      navigate('/onboarding', { replace: true });
    } catch {
      setContinueError(true);
    }
  }, [ctx, navigate]);
  useEffect(() => {
    if (!returning || mode !== 'enabled' || advanced.current) return;
    advanced.current = true;
    setAutoAdvance(true);
    const t = window.setTimeout(() => void goNext(), 2000);
    return () => window.clearTimeout(t);
  }, [returning, mode, goNext]);

  const linkAndGo = async () => {
    const link = await attempt(() => client.POST('/v1/connect/onboarding-link', {}));
    if (!link.ok) {
      if (!link.network && link.status === 409) setProblem('step-na');
      else setProblem('link');
      return false;
    }
    window.location.assign((link.data as { url: string }).url);
    return true;
  };

  const startStripe = async () => {
    setBusy(true);
    setProblem(null);
    if (mode === 'not-started') {
      accountKey.current = accountKey.current ?? idempotencyKey();
      const created = await attempt(() => client.POST('/v1/connect/account', { params: { header: { 'Idempotency-Key': accountKey.current! } } }));
      if (!created.ok) {
        setBusy(false);
        setProblem(!created.network && created.status === 409 ? 'step-na' : 'create');
        return;
      }
      status.mutate(() => created.data as ConnectStatus);
    }
    await linkAndGo();
    setBusy(false);
  };

  const s = status.data;
  const needed = (() => {
    if (status.status === 'loading') return null;
    const code = { 'not-started': 'payout_not_started', due: 'payout_requirements_due', verifying: 'payout_verifying', disabled: 'payouts_disabled', enabled: '' }[mode];
    return code ? { code, text: BLOCKING_COPY[code]!, tone: mode === 'disabled' ? ('warning' as const) : ('info' as const) } : null;
  })();

  return (
    <div className="mx-auto flex w-full max-w-[1096px] flex-col gap-4 p-4 xl:p-6" data-testid="payout-screen">
      <header className="flex flex-col gap-1">
        <h1 className="m-0 text-heading-xl text-fg-primary">{PAYOUT.title}</h1>
        <p className="m-0 text-body-md text-fg-secondary">{PAYOUT.intro}</p>
      </header>
      {needed && !problem ? (
        <InlineAlert tone={needed.tone} title="What’s needed now" testId="needed-now">
          <span>{needed.text}</span>
        </InlineAlert>
      ) : null}
      {status.status === 'stale' ? (
        <InlineAlert tone="neutral" icon="refresh" title={PAYOUT.staleTitle} testId="live-paused">
          <span>{PAYOUT.staleBody}</span>
          <div className="pt-2">
            <Button variant="tertiary" size="md" onPress={() => void status.refresh()}>
              Check now
            </Button>
          </div>
        </InlineAlert>
      ) : null}

      <div className="flex flex-col gap-4 lg:flex-row">
        <section aria-labelledby="po-status-h" className="flex min-w-0 flex-1 flex-col gap-3 rounded-[12px] border border-line-decorative bg-surface-raised p-4">
          <h2 id="po-status-h" className="m-0 text-heading-sm text-fg-primary">
            Payout status
          </h2>
          {status.status === 'loading' ? (
            <div aria-hidden="true" className="flex flex-col gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : status.status === 'error' ? (
            <InlineAlert tone="danger" title={PAYOUT.statusErrorTitle} blocking testId="status-error">
              <span>{PAYOUT.statusErrorBody}</span>
              <div className="pt-2">
                <Button variant="primary" size="md" onPress={status.reload}>
                  Try again
                </Button>
              </div>
            </InlineAlert>
          ) : (
            <StatusBody mode={mode} s={s} />
          )}
          <p className="m-0 text-body-sm text-fg-secondary">{PAYOUT.privacy}</p>
        </section>

        <section aria-labelledby="po-next-h" className="flex min-w-0 flex-1 flex-col gap-3 rounded-[12px] border border-line-decorative bg-surface-raised p-4">
          <h2 id="po-next-h" className="m-0 text-heading-sm text-fg-primary">
            What to do
          </h2>
          {problem ? <ProblemBlock problem={problem} busy={busy} onTry={() => (problem === 'status' ? status.reload() : problem === 'step-na' ? void ctx.refreshAll() : void (problem === 'link-expired' ? linkAndGo() : startStripe()))} support={ctx.support} /> : null}
          {!problem && status.status === 'loading' ? <p role="status" className="m-0 text-body-md text-fg-secondary">{PAYOUT.checking}</p> : null}
          {!problem && status.status !== 'loading' && status.status !== 'error' ? (
            mode === 'enabled' ? (
              <div className="flex flex-col gap-3">
                <h3 className="m-0 text-heading-sm text-fg-primary">{PAYOUT.onTitle}</h3>
                {autoAdvance ? <p role="status" className="m-0 text-body-md text-fg-secondary">{PAYOUT.advancing}</p> : null}
                {continueError ? (
                  <InlineAlert tone="danger" title={PAYOUT.continueErrorTitle} blocking testId="continue-error">
                    <span>{PAYOUT.continueErrorBody}</span>
                  </InlineAlert>
                ) : null}
                <div>
                  <Button variant="primary" size="lg" onPress={() => void goNext()}>
                    {continueError ? 'Try again' : 'Continue'}
                  </Button>
                </div>
              </div>
            ) : mode === 'verifying' ? (
              <div className="flex flex-col gap-2">
                <h3 className="m-0 text-heading-sm text-fg-primary">{PAYOUT.verifyingTitle}</h3>
                <p className="m-0 text-body-md text-fg-secondary">{PAYOUT.verifyingBody}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <h3 className="m-0 text-heading-sm text-fg-primary">{mode === 'not-started' ? PAYOUT.connectTitle : mode === 'disabled' ? PAYOUT.offTitle : PAYOUT.dueTitle(listedRequirements(s!).length)}</h3>
                <p className="m-0 text-body-md text-fg-secondary">{mode === 'not-started' ? PAYOUT.connectBody : PAYOUT.dueBody}</p>
                <div>
                  <Button variant="primary" size="lg" loading={busy} onPress={() => void startStripe()}>
                    {mode === 'not-started' ? 'Set up payouts with Stripe' : 'Continue on Stripe'}
                  </Button>
                </div>
                <span className="text-body-sm text-fg-secondary">{busy && mode === 'not-started' ? PAYOUT.creating : PAYOUT.opensHere}</span>
              </div>
            )
          ) : null}
        </section>
      </div>
    </div>
  );
}

function StatusBody({ mode, s }: { mode: PayoutMode; s: ConnectStatus | null }) {
  if (mode === 'not-started' || !s) {
    return (
      <div className="flex flex-col gap-2">
        <KeyValueList rows={[{ key: 'sent', label: 'Details sent to Stripe', value: 'Not yet' }, { key: 'payouts', label: 'Payouts', value: PAYOUT.offUntil }]} />
        <p className="m-0 text-body-md text-fg-primary">{PAYOUT.docsApproved}</p>
      </div>
    );
  }
  const rows: KeyValueRow[] = [];
  if (mode === 'enabled') {
    rows.push({ key: 'payouts', label: 'Payouts', value: 'On' });
    if (s.bank_last4) rows.push({ key: 'bank', label: 'Bank account', value: `Ending ${s.bank_last4}` });
    if (s.payout_interval) rows.push({ key: 'interval', label: 'Payout schedule', value: s.payout_interval.charAt(0) + s.payout_interval.slice(1).toLowerCase() });
  } else {
    rows.push({ key: 'sent', label: 'Details sent to Stripe', value: s.details_submitted ? 'Yes' : 'Not yet' });
    rows.push({ key: 'payouts', label: 'Payouts', value: mode === 'disabled' ? 'Off' : PAYOUT.offUntil });
    if (s.requirements.deadline) rows.push({ key: 'deadline', label: 'Stripe’s deadline', value: longDate(s.requirements.deadline) });
  }
  const reqs = mode === 'enabled' ? [] : listedRequirements(s);
  const later = mode === 'enabled' ? s.requirements.eventually_due : [];
  return (
    <div className="flex flex-col gap-3">
      <h3 className="m-0 text-heading-sm text-fg-primary">{mode === 'enabled' ? PAYOUT.onTitle : mode === 'verifying' ? PAYOUT.verifyingTitle : PAYOUT.dueTitle(reqs.length)}</h3>
      <KeyValueList rows={rows} testId="payout-kv" />
      {reqs.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-label-lg text-fg-primary">What Stripe asked for</span>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {reqs.map((k) => (
              <li key={k} className="flex flex-wrap items-center gap-2 text-body-md text-fg-primary">
                {requirementWords(k)}
                <code className="rounded-[6px] bg-surface-sunken px-1.5 py-0.5 text-body-sm text-fg-secondary">{k}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {later.length > 0 ? (
        <Disclosure summary="Stripe may ask later">
          <p className="m-0">{PAYOUT.laterBody}</p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {later.map((k) => (
              <li key={k}>
                {requirementWords(k)} <code className="text-body-sm">{k}</code>
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}
    </div>
  );
}

function ProblemBlock({ problem, busy, onTry, support }: { problem: Exclude<Problem, null>; busy: boolean; onTry: () => void; support: ReturnType<typeof useOnboarding>['support'] }) {
  const p = PAYOUT.problems[problem];
  const phone = support ? ` ${PAYOUT.supportOn(support.display)}` : '';
  return (
    <div className="flex flex-col gap-3">
      <h3 className="m-0 text-heading-sm text-fg-primary">{p.heading}</h3>
      <InlineAlert tone={p.tone} blocking={p.tone === 'danger'} title={p.title} testId={`problem-${problem}`}>
        <span>
          {p.body}
          {problem === 'create' || problem === 'link' ? phone : ''}
        </span>
      </InlineAlert>
      <div>
        <Button variant="primary" size="lg" loading={busy} onPress={onTry}>
          {p.button}
        </Button>
      </div>
    </div>
  );
}
