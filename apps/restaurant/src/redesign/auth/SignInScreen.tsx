/**
 * `/login` — Sign in (canvas SI `Main`, `SignIn-*`, `Tab-SignIn-1024`; WP2 spec §1).
 *
 * Email and password only: two-step sign-in is a later version, so `totp_code` is never sent and
 * an unexpected `MFA_REQUIRED` is the generic "try again in a moment" state. Every refusal is
 * branched on `error.code` (the backend answers a temporary lock with 429 where the contract
 * lists 423). After a 200 the server decides where the owner goes: `next_route` first
 * (`APP_UPDATE_REQUIRED`/unknown → update view, `SUSPENDED` → account-state card), then a safe
 * `return_to`, else `getRestaurantOnboardingStatus` (DONE → /orders, anything else →
 * /onboarding). The client never works out an onboarding step itself.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { Schema } from '@hg/api-client';
import { setSession } from '../../lib/api';
import { client, resetSignedOut } from '../data/client';
import { spokenDuration } from '../format/time';
import { Button, GlyphIcon, InlineAlert, Input, usePageAnnouncer } from '../ds';
import {
  attempt,
  HG_CLIENT,
  looksLikeEmail,
  rememberEmail,
  rememberedEmail,
  responseWindowWords,
  serverWait,
  supportFrom,
  usePublicConfig,
  type ServerWait,
  type SupportContact,
} from './api';
import { ACCOUNT_CARDS, COMMON, SIGN_IN, SUPPORT, UPDATE, type AccountCardKind } from './copy';
import { AccountStateCard, AuthCard, HeadingBlock, PhoneLink, SupportBlock, SupportSentence, TextLink, WaitLine } from './frame';
import { safeReturnTo } from './returnTo';
import type { CheckEmailEntry } from './CheckEmailScreen';

type Wait = ServerWait & { receivedAt: number };

type Problem =
  | { kind: 'invalid' }
  | { kind: 'unverified'; email: string }
  | { kind: 'too-many'; wait: Wait | null }
  | { kind: 'locked'; wait: Wait | null }
  | { kind: 'offline' }
  | { kind: 'busy'; wait: Wait | null };

type Outcome =
  | { kind: 'account'; card: AccountCardKind; email: string }
  | { kind: 'not-restaurant'; email: string }
  | { kind: 'update' };

/** How the sign-in page was reached after a session ended (the shell's "Sign in again"). */
type Arrival = 'expired' | 'reuse-detected' | null;

const KNOWN_NEXT_ROUTES: ReadonlySet<string> = new Set<Schema['NextRoute']>([
  'HOME',
  'PROFILE_CAPTURE',
  'ONBOARDING_PROFILE',
  'ONBOARDING_VEHICLE',
  'ONBOARDING_DOCUMENTS',
  'ONBOARDING_AWAITING_REVIEW',
  'ONBOARDING_REJECTED',
  'ONBOARDING_PAYOUT',
  'ONBOARDING_MENU',
  'ACTIVE_DELIVERY',
  'ORDER_TRACKING',
  'SUSPENDED',
]);

/** 403 / 423 account codes → the SI account-state card (contract enum; default NotActive). */
const ACCOUNT_CODES: Record<string, AccountCardKind> = {
  ACCOUNT_LOCKED: 'locked-permanent',
  ACCOUNT_SUSPENDED: 'suspended',
  ACCOUNT_BANNED: 'banned',
  ACCOUNT_NOT_ACTIVE: 'not-active',
  ACCOUNT_DEACTIVATED: 'deactivated',
};

/** `next_route: SUSPENDED` — the server sends it for SUSPENDED, BANNED and DELETED accounts. */
function cardForStatus(status: Schema['AccountStatus']): AccountCardKind {
  switch (status) {
    case 'SUSPENDED':
      return 'suspended';
    case 'BANNED':
      return 'banned';
    case 'DELETED':
      return 'deactivated';
    default:
      return 'not-active';
  }
}

function hasRestaurantGrant(principal: Schema['Principal']): boolean {
  return principal.roles.some((r) => r.role.startsWith('RESTAURANT_') && r.scope_type === 'RESTAURANT' && !!r.scope_id);
}

/** A session the server issued that this app will not use: ended at once (best effort). */
function endUnusedSession(accessToken: string) {
  void client.POST('/v1/auth/logout', { headers: { Authorization: `Bearer ${accessToken}` } }).catch(() => undefined);
}

function withReceipt(wait: ServerWait | null): Wait | null {
  return wait ? { ...wait, receivedAt: Date.now() } : null;
}

function remainingMs(wait: Wait): number {
  return Date.parse(wait.expiresAt) - Date.parse(wait.serverNow) - (Date.now() - wait.receivedAt);
}

export function SignInScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const { announce } = usePageAnnouncer();
  const config = usePublicConfig();
  const support = supportFrom(config);

  const initialArrival = params.get('signed_out');
  const [arrival, setArrival] = useState<Arrival>(
    initialArrival === 'expired' || initialArrival === 'reuse-detected' ? initialArrival : null,
  );
  const [email, setEmail] = useState(() => (location.state as { email?: string } | null)?.email ?? (initialArrival ? rememberedEmail() : ''));
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [failures, setFailures] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [resending, setResending] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const waiting = (problem?.kind === 'too-many' || problem?.kind === 'locked' || problem?.kind === 'busy') && problem.wait !== null;

  const fail = (next: Problem) => {
    setProblem(next);
    setFailures((n) => n + 1);
  };

  const waitOver = useCallback(() => {
    setProblem((p) => (p && 'wait' in p ? { ...p, wait: null } : p));
    announce(COMMON.waitOver, 'polite');
  }, [announce]);

  useEffect(() => {
    if (fieldErrors.email) emailRef.current?.focus();
    else if (fieldErrors.password) passwordRef.current?.focus();
  }, [fieldErrors]);

  async function routeAfterSignIn() {
    const back = safeReturnTo(params.get('return_to'));
    if (back) {
      navigate(back, { replace: true });
      return;
    }
    const status = await attempt(() => client.GET('/v1/restaurant/onboarding/status'));
    // A failure here is the console's to show (it re-reads and offers Try again).
    if (status.ok && status.data.current_step !== 'DONE') navigate('/onboarding', { replace: true });
    else navigate('/orders', { replace: true });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (waiting && problem && 'wait' in problem && problem.wait) {
      // Locked: the button stays focusable; activating it says the wait again.
      announce(`${COMMON.waitPrefix}${spokenDuration(Math.max(0, remainingMs(problem.wait)))}.`, 'polite');
      return;
    }
    const trimmed = email.trim();
    const errors: { email?: string; password?: string } = {};
    if (!trimmed) errors.email = SIGN_IN.emailMissing;
    if (!password) errors.password = SIGN_IN.passwordMissing;
    setFieldErrors(errors);
    if (errors.email || errors.password) return;

    setBusy(true);
    const res = await attempt(() =>
      client.POST('/v1/auth/login', { params: { header: HG_CLIENT }, body: { email: trimmed, password } }),
    );
    setBusy(false);
    setArrival(null);

    if (res.ok) {
      const grant = res.data;
      const principal = grant.principal;
      if (principal.next_route === 'SUSPENDED') {
        endUnusedSession(grant.access_token);
        setOutcome({ kind: 'account', card: cardForStatus(principal.status), email: trimmed });
        return;
      }
      if (principal.next_route === 'APP_UPDATE_REQUIRED' || !KNOWN_NEXT_ROUTES.has(principal.next_route)) {
        endUnusedSession(grant.access_token);
        setOutcome({ kind: 'update' });
        return;
      }
      if (!hasRestaurantGrant(principal)) {
        // Nothing about other roles is shown; that session is ended here.
        endUnusedSession(grant.access_token);
        setOutcome({ kind: 'not-restaurant', email: trimmed });
        return;
      }
      setSession({ accessToken: grant.access_token, accountId: principal.account_id });
      resetSignedOut();
      rememberEmail(trimmed);
      await routeAfterSignIn();
      return;
    }
    if (res.network) {
      fail({ kind: 'offline' });
      return;
    }
    const wait = (fallback: number | null) => {
      const seconds = res.retryAfter ?? fallback;
      return seconds === null ? null : withReceipt(serverWait(res.serverDate, seconds));
    };
    switch (res.code) {
      case 'INVALID_CREDENTIALS': {
        const details = res.details as { email_verification_required?: boolean } | null;
        if (details && !Array.isArray(details) && details.email_verification_required === true) {
          fail({ kind: 'unverified', email: trimmed });
        } else {
          setPassword('');
          fail({ kind: 'invalid' });
        }
        return;
      }
      case 'RATE_LIMITED':
        fail({ kind: 'too-many', wait: wait(60) });
        return;
      case 'ACCOUNT_TEMPORARILY_LOCKED':
        setPassword('');
        fail({ kind: 'locked', wait: wait(null) });
        return;
      default:
        if (res.code in ACCOUNT_CODES) {
          setOutcome({ kind: 'account', card: ACCOUNT_CODES[res.code]!, email: trimmed });
          return;
        }
        // MFA_REQUIRED (no two-step at launch), TIMEOUT / 503, 5xx, any unknown code.
        fail({ kind: 'busy', wait: res.status === 503 ? wait(null) : null });
    }
  }

  async function sendNewLink(to: string) {
    if (resending) return;
    setResending(true);
    const res = await attempt(() => client.POST('/v1/auth/email/resend', { body: { email: to } }));
    setResending(false);
    let entry: CheckEmailEntry;
    if (res.ok) entry = { email: to, start: 'cooldown', wait: serverWait(res.serverDate, 60) };
    else if (res.network || res.status >= 500) entry = { email: to, start: 'offline' };
    else if (res.code === 'RATE_LIMITED') {
      const seconds = res.retryAfter ?? 60;
      entry = { email: to, start: seconds > 60 ? 'daily' : 'cooldown', wait: serverWait(res.serverDate, seconds) };
    } else entry = { email: to, start: 'default' };
    navigate('/check-email', { state: entry });
  }

  function startOver() {
    setOutcome(null);
    setProblem(null);
    setEmail('');
    setPassword('');
    setArrival(null);
  }

  if (outcome) return <OutcomeView outcome={outcome} support={support} onStartOver={startOver} />;

  const responseWindow = responseWindowWords(config.data);
  const alertKey = `${problem?.kind ?? arrival ?? 'none'}-${failures}`;

  const heading =
    !problem && arrival === 'expired' ? (
      <HeadingBlock title={SIGN_IN.expiredTitle} intro={SIGN_IN.expiredIntro} />
    ) : !problem && arrival === 'reuse-detected' ? (
      <HeadingBlock title={SIGN_IN.reuseTitle} intro={SIGN_IN.reuseIntro} />
    ) : (
      <HeadingBlock title={SIGN_IN.title} intro={SIGN_IN.intro} />
    );

  const banner = (() => {
    if (!problem) {
      if (arrival === 'expired')
        return (
          <InlineAlert key={alertKey} tone="warning" icon="clock" blocking title={SIGN_IN.expiredAlertTitle}>
            <span>{SIGN_IN.ordersAtRisk(responseWindow)}</span>
            <span>{SIGN_IN.acceptedSafe}</span>
          </InlineAlert>
        );
      if (arrival === 'reuse-detected')
        return (
          <InlineAlert key={alertKey} tone="warning" icon="lock" blocking title={SIGN_IN.reuseAlertTitle}>
            <span>{support ? SIGN_IN.reuseBody(support.display) : SIGN_IN.reuseBodyNoSupport}</span>
            <span>{SIGN_IN.ordersAtRisk(responseWindow)}</span>
          </InlineAlert>
        );
      return null;
    }
    switch (problem.kind) {
      case 'invalid':
        return (
          <InlineAlert key={alertKey} tone="danger" icon="error" blocking title={SIGN_IN.invalidTitle}>
            <span>{SIGN_IN.invalidBody}</span>
          </InlineAlert>
        );
      case 'unverified':
        return (
          <InlineAlert key={alertKey} tone="info" icon="info" title={SIGN_IN.unverifiedTitle}>
            <span>{SIGN_IN.unverifiedBody(problem.email)}</span>
          </InlineAlert>
        );
      case 'too-many':
        return (
          <InlineAlert key={alertKey} tone="warning" icon="clock" title={SIGN_IN.tooManyTitle}>
            <span>{SIGN_IN.tooManyBody}</span>
          </InlineAlert>
        );
      case 'locked':
        return (
          <InlineAlert key={alertKey} tone="warning" icon="lock" blocking title={SIGN_IN.lockedTitle}>
            <span>
              {support ? SIGN_IN.lockedBody : SIGN_IN.lockedBodyNoSupport}
              <TextLink to="/forgot-password" state={{ email }}>
                {COMMON.forgotLink}
              </TextLink>
              .
            </span>
          </InlineAlert>
        );
      case 'offline':
        return (
          <InlineAlert key={alertKey} tone="neutral" icon="warning" blocking title={SIGN_IN.offlineTitle}>
            <span>{SIGN_IN.offlineBody}</span>
          </InlineAlert>
        );
      case 'busy':
        return (
          <InlineAlert key={alertKey} tone="neutral" icon="warning" blocking title={SIGN_IN.busyTitle}>
            <span>{SIGN_IN.busyBody}</span>
          </InlineAlert>
        );
    }
  })();

  const kind = problem?.kind;
  const currentWait = problem && 'wait' in problem ? problem.wait : null;
  const fields = (
    <>
      <Input
        ref={emailRef}
        label={SIGN_IN.email}
        variant="email"
        autoComplete="username"
        size="lg"
        value={email}
        onChange={(v) => {
          setEmail(v);
          if (fieldErrors.email) setFieldErrors((f) => ({ ...f, email: undefined }));
        }}
        errorText={fieldErrors.email}
        required
      />
      <Input
        ref={passwordRef}
        label={SIGN_IN.password}
        variant="password"
        autoComplete="current-password"
        size="lg"
        value={password}
        onChange={(v) => {
          setPassword(v);
          if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined }));
        }}
        errorText={fieldErrors.password}
        required
      />
    </>
  );

  const forgotLine = (
    <p className="m-0 text-body-sm text-fg-secondary">
      {COMMON.forgotBefore}
      <TextLink to="/forgot-password" state={{ email: email.trim() }}>
        {COMMON.forgotLink}
      </TextLink>
      .
    </p>
  );

  const waitLine = currentWait ? <WaitLine wait={currentWait} onExpire={waitOver} /> : null;
  const submitProps = waiting ? { 'aria-describedby': 'wait-reason' } : {};
  const retryIcon = <GlyphIcon name="refresh" size="md" />;

  let body;
  if (kind === 'unverified') {
    body = (
      <>
        <Button
          variant="primary"
          size="lg"
          fullWidth
          type="button"
          loading={resending}
          onPress={() => void sendNewLink(problem!.kind === 'unverified' ? problem!.email : email.trim())}
        >
          {SIGN_IN.sendNewLink}
        </Button>
        {fields}
        <Button variant="secondary" size="lg" fullWidth type="submit" loading={busy}>
          {SIGN_IN.submit}
        </Button>
        {forgotLine}
      </>
    );
  } else if (kind === 'too-many') {
    body = (
      <>
        {fields}
        <Button variant="primary" size="lg" fullWidth type="submit" loading={busy} disabled={waiting} {...submitProps}>
          {SIGN_IN.tryAgain}
        </Button>
        {waitLine}
        {forgotLine}
      </>
    );
  } else if (kind === 'locked') {
    body = (
      <>
        {support ? (
          <Button variant="primary" size="lg" fullWidth href={`tel:${support.tel}`}>
            {SUPPORT.callButton}
          </Button>
        ) : null}
        {fields}
        {/* aria-disabled, not disabled: it stays focusable, and activating it says the wait again. */}
        <Button variant="secondary" size="lg" fullWidth type="submit" loading={busy} disabled={waiting} {...submitProps}>
          {SIGN_IN.submit}
        </Button>
        {waitLine}
      </>
    );
  } else if (kind === 'offline' || kind === 'busy') {
    body = (
      <>
        {fields}
        {forgotLine}
        <Button variant="primary" size="lg" fullWidth type="submit" loading={busy} disabled={waiting} iconStart={retryIcon} {...submitProps}>
          {SIGN_IN.tryAgain}
        </Button>
        {waitLine}
      </>
    );
  } else if (!problem && arrival === 'reuse-detected') {
    body = (
      <>
        {fields}
        {forgotLine}
        <Button variant="primary" size="lg" fullWidth type="submit" loading={busy}>
          {SIGN_IN.submit}
        </Button>
      </>
    );
  } else {
    body = (
      <>
        {fields}
        <Button variant="primary" size="lg" fullWidth type="submit" loading={busy}>
          {SIGN_IN.submit}
        </Button>
        {forgotLine}
      </>
    );
  }

  const registerLine = (
    <p className="m-0 text-center text-body-md text-fg-secondary">
      {COMMON.newBefore}
      <TextLink to="/register">{COMMON.registerLink}</TextLink>
    </p>
  );

  let footer = null;
  if (kind === 'invalid' || kind === 'unverified') footer = registerLine;
  else if (kind === 'too-many') footer = <SupportSentence support={support} />;
  else if (kind === 'locked')
    footer = support ? (
      <p className="m-0 text-center text-body-sm text-fg-secondary">
        {SUPPORT.lockedFooter}
        <PhoneLink support={support} />
        {support.hours ? `, ${support.hours}.` : '.'}
      </p>
    ) : null;
  else if (kind === 'offline' || kind === 'busy' || (!problem && arrival === 'expired')) footer = null;
  else if (!problem && arrival === 'reuse-detected') footer = <SupportSentence support={support} />;
  else
    footer = (
      <>
        {registerLine}
        {busy ? null : <SupportSentence support={support} />}
      </>
    );

  return (
    <>
      <AuthCard testId="sign-in-card">
        <form noValidate onSubmit={submit} aria-busy={busy || undefined} className="flex flex-col gap-5" aria-label={SIGN_IN.submit}>
          {heading}
          {banner}
          {body}
        </form>
      </AuthCard>
      {footer}
    </>
  );
}

/** The non-form results of a sign-in: account-state cards, not-a-restaurant, update needed. */
function OutcomeView({
  outcome,
  support,
  onStartOver,
}: {
  outcome: Outcome;
  support: SupportContact | null | undefined;
  onStartOver: () => void;
}) {
  if (outcome.kind === 'update') {
    return (
      <AuthCard testId="update-card">
        <HeadingBlock title={UPDATE.title} intro={UPDATE.body} />
        <Button variant="primary" size="lg" fullWidth iconStart={<GlyphIcon name="refresh" size="md" />} onPress={() => window.location.reload()}>
          {UPDATE.refresh}
        </Button>
        {support ? <SupportBlock support={support} /> : null}
      </AuthCard>
    );
  }
  if (outcome.kind === 'not-restaurant') {
    return (
      <>
        <AccountStateCard
          icon="info"
          title={SIGN_IN.notRestaurantTitle}
          body={SIGN_IN.notRestaurantBody(outcome.email)}
          support={support}
          withSupport={false}
          testId="not-restaurant-card"
        >
          <Button variant="primary" size="lg" fullWidth onPress={onStartOver}>
            {SIGN_IN.differentEmail}
          </Button>
          <p className="m-0 text-center text-body-md">
            <TextLink to="/register">{COMMON.registerLink}</TextLink>
          </p>
        </AccountStateCard>
        <SupportSentence support={support} />
      </>
    );
  }
  const card = ACCOUNT_CARDS[outcome.card];
  const body = !support && card.bodyNoSupport ? card.bodyNoSupport(outcome.email) : card.body(outcome.email);
  return <AccountStateCard icon={card.icon} title={card.title} body={body} support={support} testId={`account-card-${outcome.card}`} />;
}
