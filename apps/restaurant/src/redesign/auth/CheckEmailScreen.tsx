/**
 * `/check-email` — Check your email (canvas SI `CheckEmail-*`; WP2 spec §3). Reached after
 * registering (201, no session) or from "Send a new link". `resendEmailVerification` answers 202
 * whether or not the account exists and allows one link a minute and five a day: the minute's
 * wait after a 202 starts at the response's `Date` (the 202 carries no Retry-After), and a 429's
 * wait is its own Retry-After (over a minute means the daily limit).
 */
import { useCallback, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { client } from '../data/client';
import { Button, GlyphIcon, InlineAlert, StateCard, StateCardIcon, TextLink, usePageAnnouncer, WaitLine } from '../ds';
import { agedWait, attempt, serverWait, supportFrom, usePublicConfig, type ServerWait } from './api';
import { CHECK_EMAIL, COMMON } from './copy';

export interface CheckEmailEntry {
  email: string;
  business_name?: string | null;
  start?: 'default' | 'cooldown' | 'daily' | 'offline';
  wait?: ServerWait;
}

type Phase = { kind: 'default' } | { kind: 'cooldown'; wait: ServerWait } | { kind: 'daily'; wait: ServerWait } | { kind: 'offline' };

const ENTRY_KEY = 'hg_restaurant_check_email_v1';

/** The address survives a reload of this tab (router state does not). */
function entryFrom(state: unknown): CheckEmailEntry | null {
  const fromState = state as CheckEmailEntry | null;
  if (fromState?.email) {
    try {
      sessionStorage.setItem(ENTRY_KEY, JSON.stringify({ email: fromState.email, business_name: fromState.business_name ?? null }));
    } catch {
      /* storage blocked: this visit only */
    }
    return fromState;
  }
  try {
    const raw = sessionStorage.getItem(ENTRY_KEY);
    return raw ? (JSON.parse(raw) as CheckEmailEntry) : null;
  } catch {
    return null;
  }
}

/**
 * The entry comes from router state, which the browser keeps in `history.state` across a reload:
 * its wait is aged by the time since it was received, so a reload after the minute is over opens
 * the Default state rather than a fresh 60-second wait ("A new link is on its way" again).
 */
function initialPhase(entry: CheckEmailEntry | null): Phase {
  if (entry?.start === 'offline') return { kind: 'offline' };
  const wait = agedWait(entry?.wait);
  if (wait && entry?.start === 'daily') return { kind: 'daily', wait };
  if (wait && entry?.start === 'cooldown') return { kind: 'cooldown', wait };
  return { kind: 'default' };
}

export function CheckEmailScreen() {
  const location = useLocation();
  const navigate = useNavigate();
  const [entry] = useState(() => entryFrom(location.state));
  const [phase, setPhase] = useState<Phase>(() => initialPhase(entry));
  const [sending, setSending] = useState(false);
  const [failures, setFailures] = useState(0);
  const { announce } = usePageAnnouncer();
  const config = usePublicConfig();
  const support = supportFrom(config);

  const waitOver = useCallback(() => {
    setPhase({ kind: 'default' });
    if (entry?.email) {
      navigate(`${location.pathname}${location.search}`, { replace: true, state: { email: entry.email, business_name: entry.business_name ?? null } });
    }
    announce(COMMON.waitOver, 'polite');
  }, [announce, entry, location.pathname, location.search, navigate]);

  const waiting = phase.kind === 'cooldown' || phase.kind === 'daily';

  /** The phase on screen, and in `history.state`, so a reload resumes it rather than an older one. */
  function show(next: Phase) {
    setPhase(next);
    if (!entry?.email) return;
    const kept: CheckEmailEntry = { email: entry.email, business_name: entry.business_name ?? null, start: next.kind };
    if (next.kind === 'cooldown' || next.kind === 'daily') kept.wait = next.wait;
    navigate(`${location.pathname}${location.search}`, { replace: true, state: kept });
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!entry?.email || sending || waiting) return;
    setSending(true);
    const res = await attempt(() => client.POST('/v1/auth/email/resend', { body: { email: entry.email } }));
    setSending(false);
    if (res.ok) {
      show({ kind: 'cooldown', wait: serverWait(res.serverDate, 60) });
      return;
    }
    if (!res.network && res.code === 'RATE_LIMITED') {
      const seconds = res.retryAfter ?? 60;
      show(seconds > 60 ? { kind: 'daily', wait: serverWait(res.serverDate, seconds) } : { kind: 'cooldown', wait: serverWait(res.serverDate, seconds) });
      return;
    }
    if (res.network || res.status >= 500) {
      show({ kind: 'offline' });
      setFailures((n) => n + 1);
      return;
    }
    show({ kind: 'default' });
  }

  return (
    <StateCard testId="check-email-card">
      <form noValidate onSubmit={send} aria-busy={sending || undefined} className="flex flex-col gap-5" aria-label={CHECK_EMAIL.title}>
        <StateCardIcon name="letter" />
        <h1 className="m-0 text-heading-xl text-fg-primary">{CHECK_EMAIL.title}</h1>
        <p className="m-0 text-body-md leading-normal text-fg-primary">
          {entry?.email ? (
            <>
              {CHECK_EMAIL.openBefore}
              <strong>{entry.email}</strong>
              {CHECK_EMAIL.openAfter(entry.business_name)}
            </>
          ) : (
            CHECK_EMAIL.noEmail
          )}
        </p>
        <p className="m-0 text-body-md text-fg-primary">
          {CHECK_EMAIL.wrongBefore}
          <TextLink to="/register">{CHECK_EMAIL.wrongLink}</TextLink>
        </p>
        <p className="m-0 text-body-md leading-normal text-fg-secondary">{CHECK_EMAIL.help}</p>

        {phase.kind === 'daily' ? (
          <InlineAlert tone="warning" icon="clock" title={CHECK_EMAIL.dailyTitle}>
            <span>{support === null ? CHECK_EMAIL.dailyBodyNoSupport : CHECK_EMAIL.dailyBody}</span>
          </InlineAlert>
        ) : null}
        {phase.kind === 'offline' ? (
          <InlineAlert key={failures} tone="neutral" icon="warning" blocking title={CHECK_EMAIL.offlineTitle}>
            <span>{CHECK_EMAIL.offlineBody}</span>
          </InlineAlert>
        ) : null}
        {phase.kind === 'cooldown' ? (
          <p role="status" className="m-0 text-body-md text-fg-primary">
            {CHECK_EMAIL.onItsWay}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-center gap-4">
          {entry?.email ? (
            <Button
              variant="tertiary"
              size="md"
              type="submit"
              loading={sending}
              disabled={waiting}
              iconStart={phase.kind === 'offline' ? <GlyphIcon name="refresh" size="md" /> : undefined}
              {...(waiting ? { 'aria-describedby': 'wait-reason' } : {})}
            >
              {CHECK_EMAIL.send}
            </Button>
          ) : null}
          <TextLink to="/login" variant="standalone">{COMMON.backToSignIn}</TextLink>
        </div>
        {phase.kind === 'cooldown' || phase.kind === 'daily' ? (
          <WaitLine
            wait={phase.wait}
            prefix={CHECK_EMAIL.sendAnotherPrefix}
            label={phase.kind === 'daily' ? CHECK_EMAIL.dailyLabel : COMMON.waitLabel}
            onExpire={waitOver}
          />
        ) : null}
      </form>
    </StateCard>
  );
}
