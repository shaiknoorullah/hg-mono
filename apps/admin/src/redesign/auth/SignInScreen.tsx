/**
 * The sign-in gate (`RV/Main`, `RV/SignIn-Errors`, `RV/SignIn-Help`, `RV/Shell-SignedOut`,
 * `STF/SessionLostAuthenticator`), shown at any route while nobody is signed in.
 *
 * Owner decision D1 (PR #623): two-step sign-in is opt-in for staff. The form asks for the
 * work email and password only; the "Authentication code" field appears only after the server
 * answers `MFA_REQUIRED` (403, or 401), and only then is `totp_code` sent. Focus moves to the
 * code field, marked `aria-invalid`.
 *
 * Every other refusal is a blocking alert that takes focus and marks no field: 401 (details
 * not recognised), lockout (423, or 429 `ACCOUNT_TEMPORARILY_LOCKED`: never names the account
 * or an unlock time), 429 (names the time the server allows another try, 12-hour clock),
 * 503 (busy) and no answer at all. A principal with no staff role is refused here and no
 * session starts.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { Schema } from '@hg/api-client';

import { api } from '../data/api';
import { startSession, staffRoleOf } from '../data/session';
import { Button, Card, InlineAlert, Input, Wordmark } from '../ds';
import { HELP, LOST_AUTHENTICATOR, OPERATIONS, SIGNED_OUT, SIGN_IN, SIGN_IN_ALERTS } from './copy';
import { rememberedEmail, rememberSignIn, takeLostAuthenticatorRequest, wasSignedOutOnPurpose } from './memory';
import { retryAtFrom } from './online';

type Problem =
  | { kind: 'credentials' }
  | { kind: 'code-needed' }
  | { kind: 'locked' }
  | { kind: 'rate-limited'; until: Date }
  | { kind: 'busy' }
  | { kind: 'offline' }
  | { kind: 'failed' }
  | { kind: 'not-active' }
  | { kind: 'wrong-account' };

type View = 'form' | 'help' | 'lost';

interface FieldErrors {
  email?: string;
  password?: string;
  code?: string;
}

/** How long a lockout keeps the button unavailable when the server sends no `Retry-After`. */
const LOCK_FALLBACK_MS = 5 * 60_000;

export function SignInScreen() {
  const uid = useId();
  const codeId = `${uid}-code`;
  const helpHeadingId = `${uid}-help`;

  const [view, setView] = useState<View>(() => (takeLostAuthenticatorRequest() ? 'lost' : 'form'));
  const [email, setEmail] = useState(() => rememberedEmail());
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [askCode, setAskCode] = useState(false);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [alertKey, setAlertKey] = useState(0);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [blockedUntil, setBlockedUntil] = useState<Date | null>(null);
  const [signedOutNotice, setSignedOutNotice] = useState(() => wasSignedOutOnPurpose());

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const helpOpenerRef = useRef<HTMLButtonElement>(null);
  const viewHeadingRef = useRef<HTMLHeadingElement>(null);
  /** Where focus goes when a help view closes. */
  const returnFocus = useRef<'help-link' | 'code' | null>(null);
  const focusCodeNext = useRef(false);

  // The unavailable button comes back by itself once the server's wait is over.
  useEffect(() => {
    if (!blockedUntil) return;
    const timer = setTimeout(() => setBlockedUntil(null), Math.max(0, blockedUntil.getTime() - Date.now()));
    return () => clearTimeout(timer);
  }, [blockedUntil]);

  // Code needed: focus the (first box of the) code field once it is on screen.
  useEffect(() => {
    if (!focusCodeNext.current || view !== 'form') return;
    focusCodeNext.current = false;
    document.getElementById(codeId)?.focus();
  });

  // Opening a help view focuses its heading; closing it returns focus to what opened it.
  useEffect(() => {
    if (view !== 'form') {
      viewHeadingRef.current?.focus();
      return;
    }
    const target = returnFocus.current;
    returnFocus.current = null;
    if (target === 'code') document.getElementById(codeId)?.focus();
    else if (target === 'help-link') helpOpenerRef.current?.focus();
  }, [view, codeId]);

  function fail(next: Problem) {
    setProblem(next);
    setAlertKey((k) => k + 1);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (sending || blockedUntil) return;
    setSignedOutNotice(false);

    const trimmed = email.trim();
    const nextErrors: FieldErrors = {};
    if (!trimmed) nextErrors.email = SIGN_IN.emailMissing;
    if (!password) nextErrors.password = SIGN_IN.passwordMissing;
    if (askCode && !/^\d{6}$/.test(code)) nextErrors.code = SIGN_IN.codeError;
    setErrors(nextErrors);
    if (nextErrors.email) {
      emailRef.current?.focus();
      return;
    }
    if (nextErrors.password) {
      passwordRef.current?.focus();
      return;
    }
    if (nextErrors.code) {
      document.getElementById(codeId)?.focus();
      return;
    }

    setProblem(null);
    setSending(true);
    const body: Schema['LoginInput'] = askCode ? { email: trimmed, password, totp_code: code } : { email: trimmed, password };
    let result: Awaited<ReturnType<typeof callLogin>>;
    try {
      result = await callLogin(body);
    } catch {
      setSending(false);
      // No answer at all (offline, DNS, dropped connection): nothing reached the server.
      fail({ kind: 'offline' });
      return;
    }
    setSending(false);

    const { data, error, response } = result;
    if (response.ok && data) {
      const grant = data.data;
      if (staffRoleOf(grant.principal) === null) {
        // Right credentials, wrong kind of account: no session here, and the one the server
        // just issued is revoked (best effort).
        void api
          .POST('/v1/auth/logout', { headers: { Authorization: `Bearer ${grant.access_token}` } })
          .catch(() => undefined);
        fail({ kind: 'wrong-account' });
        return;
      }
      rememberSignIn(trimmed);
      startSession(grant.access_token, grant.principal);
      return;
    }

    const errCode = (error as { error?: { code?: string } } | undefined)?.error?.code ?? '';
    const status = response.status;
    if (errCode === 'MFA_REQUIRED' && (status === 401 || status === 403)) {
      setAskCode(true);
      setProblem({ kind: 'code-needed' });
      setErrors({ code: SIGN_IN.codeError });
      focusCodeNext.current = true;
      return;
    }
    if (status === 423 || errCode === 'ACCOUNT_TEMPORARILY_LOCKED' || errCode === 'ACCOUNT_LOCKED') {
      setBlockedUntil(retryAtFrom(response, LOCK_FALLBACK_MS));
      fail({ kind: 'locked' });
      return;
    }
    if (status === 429) {
      const until = retryAtFrom(response);
      setBlockedUntil(until);
      fail({ kind: 'rate-limited', until });
      return;
    }
    if (status === 401) {
      fail({ kind: 'credentials' });
      return;
    }
    if (status === 403 && errCode === 'ACCOUNT_NOT_ACTIVE') {
      fail({ kind: 'not-active' });
      return;
    }
    if (status === 503) {
      fail({ kind: 'busy' });
      return;
    }
    fail({ kind: 'failed' });
  }

  function openHelp(next: Exclude<View, 'form'>, from: 'help-link' | 'code') {
    returnFocus.current = from;
    setView(next);
  }

  return (
    <main className="flex min-h-screen w-full flex-col items-center bg-surface-base px-4 py-10">
      <div className="flex w-full max-w-[440px] flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-2">
          <Wordmark height={32} />
          <p className="m-0 text-body-md text-fg-secondary">{OPERATIONS}</p>
        </div>

        <Card variant="elevated" padding="clamp(20px, 5vw, 32px)" className="w-full">
          {view === 'help' ? (
            <section aria-labelledby={helpHeadingId} className="flex flex-col gap-4">
              <h1 id={helpHeadingId} ref={viewHeadingRef} tabIndex={-1} className="m-0 text-heading-xl text-fg-primary outline-none">
                {HELP.title}
              </h1>
              <h2 className="m-0 text-heading-sm text-fg-primary">{HELP.forgotHeading}</h2>
              <p className="m-0 text-body-md text-fg-primary">{HELP.forgotBody}</p>
              <Button variant="secondary" size="lg" fullWidth href="/reset-password">
                {HELP.forgotAction}
              </Button>
              <div className="flex flex-col gap-2 rounded-md bg-surface-subtle p-4">
                <h2 className="m-0 text-heading-sm text-fg-primary">{HELP.lostHeading}</h2>
                <p className="m-0 text-body-md text-fg-primary">{HELP.lostBody}</p>
              </div>
              <p className="m-0 text-body-sm text-fg-secondary">{HELP.noRecovery}</p>
              <Button size="lg" fullWidth onPress={() => setView('form')}>
                {HELP.back}
              </Button>
            </section>
          ) : view === 'lost' ? (
            <section aria-labelledby={helpHeadingId} className="flex flex-col gap-4">
              <h1 id={helpHeadingId} ref={viewHeadingRef} tabIndex={-1} className="m-0 text-heading-xl text-fg-primary outline-none">
                {LOST_AUTHENTICATOR.title}
              </h1>
              <p className="m-0 text-body-md text-fg-primary">{LOST_AUTHENTICATOR.body}</p>
              <p className="m-0 text-body-md text-fg-primary">{LOST_AUTHENTICATOR.compromised}</p>
              <p className="m-0 text-body-md text-fg-primary">{LOST_AUTHENTICATOR.onCall}</p>
              <Button size="lg" fullWidth onPress={() => setView('form')}>
                {LOST_AUTHENTICATOR.back}
              </Button>
            </section>
          ) : (
            <form noValidate onSubmit={submit} aria-busy={sending || undefined} className="flex flex-col gap-5">
              {signedOutNotice ? (
                <InlineAlert tone="success-tint" title={SIGNED_OUT.title}>
                  {SIGNED_OUT.body}
                </InlineAlert>
              ) : null}
              <h1 className="m-0 text-heading-xl text-fg-primary">{SIGN_IN.title}</h1>
              {signedOutNotice ? null : <p className="m-0 text-body-md text-fg-secondary">{SIGN_IN.intro}</p>}

              {problem ? <ProblemAlert key={alertKey} problem={problem} askCode={askCode} /> : null}

              <Input
                ref={emailRef}
                label={SIGN_IN.email}
                variant="email"
                autoComplete="username"
                required
                value={email}
                onValueChange={(v) => {
                  setEmail(v);
                  if (errors.email) setErrors((x) => ({ ...x, email: undefined }));
                  // A lockout is per account: another email may try again.
                  if (problem?.kind === 'locked') {
                    setBlockedUntil(null);
                    setProblem(null);
                  }
                }}
                readOnly={sending}
                errorText={errors.email ?? null}
              />
              <Input
                ref={passwordRef}
                label={SIGN_IN.password}
                variant="password"
                autoComplete="current-password"
                required
                value={password}
                onValueChange={(v) => {
                  setPassword(v);
                  if (errors.password) setErrors((x) => ({ ...x, password: undefined }));
                }}
                readOnly={sending}
                errorText={errors.password ?? null}
              />
              {askCode ? (
                <div className="flex flex-col gap-2">
                  <Input
                    id={codeId}
                    label={SIGN_IN.code}
                    variant="otp"
                    required
                    value={code}
                    onValueChange={(v) => {
                      setCode(v);
                      if (errors.code && v.length === 6) setErrors((x) => ({ ...x, code: undefined }));
                    }}
                    readOnly={sending}
                    helperText={SIGN_IN.codeHelper}
                    errorText={errors.code ?? null}
                  />
                  <button
                    type="button"
                    onClick={() => openHelp('lost', 'code')}
                    className="min-h-11 self-start bg-transparent p-0 text-left text-body-md text-fg-link underline"
                  >
                    {SIGN_IN.lostAuthenticator}
                  </button>
                </div>
              ) : null}

              <Button
                type="submit"
                size="lg"
                fullWidth
                loading={sending}
                disabled={blockedUntil !== null}
                {...(blockedUntil !== null ? { accessibilityLabel: SIGN_IN.submitUnavailable } : {})}
              >
                {SIGN_IN.submit}
              </Button>

              <div className="flex flex-col gap-3 border-t border-line-decorative pt-4">
                <button
                  ref={helpOpenerRef}
                  type="button"
                  onClick={() => openHelp('help', 'help-link')}
                  className="min-h-11 self-start bg-transparent p-0 text-left text-body-md text-fg-link underline"
                >
                  {SIGN_IN.help}
                </button>
                <p className="m-0 text-body-md text-fg-secondary">{SIGN_IN.invite}</p>
                <p className="m-0 text-body-sm text-fg-secondary">{SIGN_IN.timeouts}</p>
              </div>
            </form>
          )}
        </Card>
      </div>
    </main>
  );
}

function callLogin(body: Schema['LoginInput']) {
  return api.POST('/v1/auth/login', {
    params: { header: { 'X-HG-Client': 'admin-web' } },
    body,
  });
}

/** The alert for the last refusal. Code-needed does not take focus: the code field does. */
function ProblemAlert({ problem, askCode }: { problem: Problem; askCode: boolean }) {
  switch (problem.kind) {
    case 'code-needed':
      return (
        // `RV/SignIn-Errors` draws code-needed as a danger alert (a sign-in error, not a halal state).
        <InlineAlert tone="danger" title={SIGN_IN_ALERTS.codeNeeded.title}>
          {SIGN_IN_ALERTS.codeNeeded.body}
        </InlineAlert>
      );
    case 'credentials': {
      const copy = askCode ? SIGN_IN_ALERTS.credentialsWithCode : SIGN_IN_ALERTS.credentials;
      return (
        <InlineAlert blocking tone="danger" title={copy.title}>
          {copy.body}
        </InlineAlert>
      );
    }
    case 'locked':
      return (
        <InlineAlert blocking tone="warning" title={SIGN_IN_ALERTS.locked.title}>
          {SIGN_IN_ALERTS.locked.body}
        </InlineAlert>
      );
    case 'rate-limited': {
      const copy = SIGN_IN_ALERTS.rateLimited(problem.until);
      return (
        <InlineAlert blocking tone="warning" title={copy.title}>
          {copy.body}
        </InlineAlert>
      );
    }
    case 'busy':
      return (
        <InlineAlert blocking tone="warning" title={SIGN_IN_ALERTS.busy.title}>
          {SIGN_IN_ALERTS.busy.body}
        </InlineAlert>
      );
    case 'offline':
      return (
        <InlineAlert blocking tone="warning" title={SIGN_IN_ALERTS.offline.title}>
          {SIGN_IN_ALERTS.offline.body}
        </InlineAlert>
      );
    case 'not-active':
      return (
        <InlineAlert blocking tone="neutral" title={SIGN_IN_ALERTS.notActive.title}>
          {SIGN_IN_ALERTS.notActive.body}
        </InlineAlert>
      );
    case 'wrong-account':
      return (
        <InlineAlert blocking tone="neutral" title={SIGN_IN_ALERTS.wrongAccount.title}>
          {SIGN_IN_ALERTS.wrongAccount.body}
        </InlineAlert>
      );
    case 'failed':
      return (
        <InlineAlert blocking tone="warning" title={SIGN_IN_ALERTS.failed.title}>
          {SIGN_IN_ALERTS.failed.body}
        </InlineAlert>
      );
  }
}
