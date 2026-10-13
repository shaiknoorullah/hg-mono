/**
 * The console's one blocking dialog (manifest §1.1, §2.6 "Session ended / revoked"; boards
 * `ASS/SessionExpired`, `ASS/SessionRevoked`, `ASS/SessionSignInAgain`, `RV/Shell-Reauth`).
 *
 * A 401 on any signed-in call marks the session ended (`data/api.ts`); the page underneath stays
 * exactly where it was, behind this dialog. The person signs in again IN PLACE: work email and
 * password, and the authenticator code only when the server asks for it (owner decision D1:
 * two-step sign-in is opt-in for staff). On success the session restarts and the dialog closes
 * over the same page. If a different account signs in, the console goes to that role's landing
 * page instead, and the previous person's queue counts and unsent drafts are dropped, so nobody
 * sees the previous person's page or typing.
 *
 * The form checks itself before sending, with the sign-in page's words: an empty email or
 * password, or a code that is not six digits, marks the field and sends nothing. The dead token
 * was dropped when the session ended (`markSessionEnded`), so `login` goes out with no bearer.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button, InlineAlert, Input, Modal } from '../ds';
import { SIGN_IN, SIGN_IN_ALERTS } from '../auth/copy';
import { rememberSignIn } from '../auth/memory';
import { retryAtFrom } from '../auth/online';
import { api } from '../data/api';
import { clearAllDrafts } from '../data/drafts';
import { getSession, staffRoleOf, startSession, subscribeSession } from '../data/session';
import { resetQueueDepth } from '../realtime/queueDepth';
import { landingPath } from './nav';
import { finishSignOut } from './signOut';

/** Copy verbatim from `ASS/SessionExpired` and `ASS/SessionRevoked`. */
const COPY = {
  expired: {
    title: 'Your session ended',
    body: "Your session ended after 30 minutes without activity, or 12 hours after you signed in. Sign in again to carry on; you come back to this page. Anything you hadn't sent wasn't saved.",
    action: 'Sign in again',
  },
  revoked: {
    title: 'Your session was ended',
    body: "Your session was ended. This happens when you sign out on another device, or when a super admin changes, suspends or removes your access. Sign in again. If sign-in doesn't work, ask a super admin.",
    action: 'Go to sign in',
  },
} as const;

type Failure =
  | { kind: 'not-recognised'; withCode: boolean }
  | { kind: 'locked' }
  | { kind: 'rate-limited'; until: Date }
  | { kind: 'busy' }
  | { kind: 'failed' }
  | { kind: 'not-active' }
  | { kind: 'not-staff' }
  | { kind: 'offline' };

/** The sign-in page's own words (`../auth/copy`), so both places say the same thing. */
function failureCopy(f: Failure): { title: string; body: string } {
  switch (f.kind) {
    case 'not-recognised':
      return f.withCode ? SIGN_IN_ALERTS.credentialsWithCode : SIGN_IN_ALERTS.credentials;
    case 'locked':
      return SIGN_IN_ALERTS.locked;
    case 'rate-limited':
      return SIGN_IN_ALERTS.rateLimited(f.until);
    case 'busy':
      return SIGN_IN_ALERTS.busy;
    case 'failed':
      return SIGN_IN_ALERTS.failed;
    case 'not-active':
      return SIGN_IN_ALERTS.notActive;
    case 'not-staff':
      return SIGN_IN_ALERTS.wrongAccount;
    case 'offline':
      return SIGN_IN_ALERTS.offline;
  }
}

function errorCode(error: unknown): string | undefined {
  return (error as { error?: { code?: string } } | undefined)?.error?.code;
}

function SignInAgainForm({ onSignedIn }: { onSignedIn: (sameAccount: boolean) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeAsked, setCodeAsked] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [sending, setSending] = useState(false);
  const codeRef = useRef<HTMLInputElement | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  // The server asked for a code: the field appears and takes focus (once).
  useEffect(() => {
    if (codeAsked) codeRef.current?.focus();
  }, [codeAsked]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending) return;
    const trimmed = email.trim();
    const nextEmailError = trimmed ? null : SIGN_IN.emailMissing;
    const nextPasswordError = password ? null : SIGN_IN.passwordMissing;
    const nextCodeError = codeAsked && !/^\d{6}$/.test(code.trim()) ? SIGN_IN.codeError : null;
    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    setCodeError(nextCodeError);
    if (nextEmailError || nextPasswordError || nextCodeError) {
      setFailure(null);
      if (nextEmailError) emailRef.current?.focus();
      else if (nextPasswordError) passwordRef.current?.focus();
      else codeRef.current?.focus();
      return;
    }
    setSending(true);
    setFailure(null);
    const previous = getSession().principal;
    try {
      const { data, error, response } = await api.POST('/v1/auth/login', {
        params: { header: { 'X-HG-Client': 'admin-web' } },
        body: { email: trimmed, password, ...(codeAsked ? { totp_code: code.trim() } : {}) },
      });
      if (data) {
        const grant = data.data;
        if (!staffRoleOf(grant.principal)) {
          // Right credentials, wrong kind of account: revoke the session just issued (best effort).
          void api
            .POST('/v1/auth/logout', { headers: { Authorization: `Bearer ${grant.access_token}` } })
            .catch(() => undefined);
          setFailure({ kind: 'not-staff' });
          return;
        }
        rememberSignIn(trimmed);
        startSession(grant.access_token, grant.principal);
        onSignedIn(previous?.account_id === grant.principal.account_id);
        return;
      }
      const code_ = errorCode(error);
      const status = response.status;
      if (code_ === 'MFA_REQUIRED' && (status === 401 || status === 403) && !codeAsked) {
        setCodeAsked(true);
        setCodeError(SIGN_IN.codeError);
      } else if (status === 423 || code_ === 'ACCOUNT_LOCKED' || code_ === 'ACCOUNT_TEMPORARILY_LOCKED') {
        setFailure({ kind: 'locked' });
      } else if (status === 429) {
        setFailure({ kind: 'rate-limited', until: retryAtFrom(response) });
      } else if (status === 503) {
        setFailure({ kind: 'busy' });
      } else if (code_ === 'ACCOUNT_NOT_ACTIVE') {
        setFailure({ kind: 'not-active' });
      } else if (status === 401 || code_ === 'MFA_REQUIRED' || code_ === 'INVALID_CREDENTIALS') {
        setFailure({ kind: 'not-recognised', withCode: codeAsked });
      } else {
        setFailure({ kind: 'failed' });
      }
    } catch {
      setFailure({ kind: 'offline' });
    } finally {
      setSending(false);
    }
  }

  const copy = failure ? failureCopy(failure) : null;
  return (
    <form noValidate aria-label="Sign in again" onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      {copy ? (
        <InlineAlert tone="warning" blocking title={copy.title}>
          {copy.body}
        </InlineAlert>
      ) : null}
      <Input
        ref={emailRef}
        label={SIGN_IN.email}
        variant="email"
        name="email"
        autoComplete="username"
        required
        value={email}
        onValueChange={(v) => {
          setEmail(v);
          if (emailError) setEmailError(null);
        }}
        errorText={emailError}
      />
      <Input
        ref={passwordRef}
        label={SIGN_IN.password}
        variant="password"
        name="password"
        autoComplete="current-password"
        required
        value={password}
        onValueChange={(v) => {
          setPassword(v);
          if (passwordError) setPasswordError(null);
        }}
        errorText={passwordError}
      />
      {codeAsked ? (
        <Input
          ref={codeRef}
          label={SIGN_IN.code}
          variant="numeric"
          name="totp"
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={6}
          required
          value={code}
          onValueChange={(v) => {
            setCode(v);
            if (codeError && /^\d{6}$/.test(v.trim())) setCodeError(null);
          }}
          errorText={codeError}
        />
      ) : null}
      <Button type="submit" fullWidth loading={sending}>
        Continue
      </Button>
    </form>
  );
}

/** Raised by the shell whenever `data/session.ts` reports the session ended under the page. */
export function SessionEndedDialog() {
  const session = useSyncExternalStore(subscribeSession, getSession, getSession);
  const navigate = useNavigate();
  const [step, setStep] = useState<'notice' | 'form'>('notice');
  const ended = session.ended;

  useEffect(() => {
    if (ended === null) setStep('notice');
  }, [ended]);

  if (ended === null) return null;
  const copy = COPY[ended];

  return (
    <Modal
      open
      variant="dialog"
      dismissible={false}
      size="sm"
      title={copy.title}
      description={copy.body}
      testId="SessionEndedDialog"
      actions={
        step === 'notice' ? (
          <Button onPress={() => setStep('form')}>{copy.action}</Button>
        ) : (
          <Button
            variant="tertiary"
            onPress={() => {
              navigate('/', { replace: true });
              finishSignOut();
            }}
          >
            Sign out
          </Button>
        )
      }
    >
      {step === 'form' ? (
        <SignInAgainForm
          onSignedIn={(sameAccount) => {
            if (sameAccount) return;
            // Someone else: nothing of the previous person's stays in this tab.
            resetQueueDepth();
            clearAllDrafts();
            navigate(landingPath(staffRoleOf(getSession().principal)), { replace: true });
          }}
        />
      ) : null}
    </Modal>
  );
}
