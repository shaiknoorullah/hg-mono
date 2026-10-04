import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Icon, Input } from '@hg/ui-web';
import { useAuth } from '../lib/auth';
import {
  PASSWORD_MIN,
  formatClockTime,
  isWellFormedToken,
  passwordTooLong,
  requestPasswordReset,
  resetPassword,
  useLinkToken,
  useRetryWindow,
} from '../lib/emailLinks';
import { AuthCard, AuthHeading, BackToSignIn, ProblemBanner } from '../components/AuthFrame';

/**
 * `/reset-password`: the "Forgot your password?" page and, with `?token=…`, the page the
 * reset email links to (issue #329).
 *
 * Boards: "Forgot your password" in the restaurant Sign-in canvas
 * (https://claude.ai/artifact/9AZ5YnbTdrfyFK1mUwYtCw): Forgot-Password, Forgot-Sending,
 * Forgot-Error, Forgot-Sent, Reset-Password, Reset-Saving, Reset-PasswordError,
 * Reset-LinkInvalid and Reset-Done. A 429 uses the wait from SignIn-TooMany.
 */
type Step = 'request' | 'set' | 'invalid' | 'done';

export function ResetPasswordPage() {
  const token = useLinkToken();
  const [step, setStep] = useState<Step>(token === null ? 'request' : isWellFormedToken(token) ? 'set' : 'invalid');

  if (step === 'set' && isWellFormedToken(token)) {
    return <SetPassword token={token} onInvalid={() => setStep('invalid')} onDone={() => setStep('done')} />;
  }
  if (step === 'invalid') return <LinkInvalid onNewLink={() => setStep('request')} />;
  if (step === 'done') return <Done />;
  return <RequestLink />;
}

/** Forgot-Password, Forgot-Sending, Forgot-Error and Forgot-Sent: `requestPasswordReset`. */
function RequestLink() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [problem, setProblem] = useState<'unreachable' | 'invalid-email' | null>(null);
  const wait = useRetryWindow();
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (problem === 'unreachable' || wait.until) bannerRef.current?.focus();
  }, [problem, wait.until]);

  async function send(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    setBusy(true);
    const outcome = await requestPasswordReset(email.trim());
    setBusy(false);
    if (outcome.ok) {
      setSentTo(email.trim());
      return;
    }
    if (outcome.kind === 'rate-limited') wait.start(outcome.retryAt);
    else setProblem(outcome.kind === 'invalid-email' ? 'invalid-email' : 'unreachable');
  }

  if (sentTo !== null) {
    // The same words whether or not the account exists: the API answers alike either way.
    return (
      <AuthCard>
        <AuthHeading title="Check your email">
          If <strong className="text-fg-primary">{sentTo}</strong> has a HalalGoes partner account, we've sent it a
          link to set a new password.
        </AuthHeading>
        <p className="m-0 text-body-md leading-normal text-fg-secondary">
          The link works for 30 minutes and only once. Can't find it? Check your spam folder, or ask for another.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <Button variant="tertiary" onPress={() => setSentTo(null)}>
            Send another link
          </Button>
          <BackToSignIn />
        </div>
      </AuthCard>
    );
  }

  const waiting = wait.until !== null;
  return (
    <AuthCard>
      <form onSubmit={send} className="flex flex-col gap-5" aria-busy={busy}>
        <AuthHeading title="Reset your password">
          Enter the email you registered with. We'll send a link to set a new password.
        </AuthHeading>
        {problem === 'unreachable' ? (
          <ProblemBanner
            innerRef={bannerRef}
            title="We couldn't send the link"
            description="This device seems to be offline, or HalalGoes didn't answer. Your email is kept. Try again."
          />
        ) : null}
        {waiting ? (
          <ProblemBanner
            innerRef={bannerRef}
            waiting
            title="Too many attempts from this device"
            description="Wait a moment, then try again. What you typed is kept."
          />
        ) : null}
        <Input
          label="Email"
          variant="email"
          autoComplete="username"
          required
          value={email}
          onChange={setEmail}
          readOnly={busy}
          errorText={problem === 'invalid-email' ? 'Enter the email you registered with, like name@restaurant.ca.' : undefined}
        />
        <Button
          type="submit"
          size="lg"
          fullWidth
          loading={busy}
          disabled={waiting}
          aria-describedby={waiting ? 'forgot-wait' : undefined}
        >
          {problem === 'unreachable' ? 'Try again' : 'Email me a reset link'}
        </Button>
        {wait.until ? (
          <p id="forgot-wait" className="m-0 text-body-sm text-fg-secondary">
            You can try again at {formatClockTime(wait.until)}.
          </p>
        ) : null}
        <BackToSignIn />
      </form>
    </AuthCard>
  );
}

/** Reset-Password, Reset-Saving and Reset-PasswordError: `resetPassword`. */
function SetPassword({ token, onInvalid, onDone }: { token: string; onInvalid: () => void; onDone: () => void }) {
  const { adoptSession } = useAuth();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const wait = useRetryWindow();
  const fieldRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (fieldError) fieldRef.current?.focus();
  }, [fieldError]);
  useEffect(() => {
    if (unreachable || wait.until) bannerRef.current?.focus();
  }, [unreachable, wait.until]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setUnreachable(false);
    const length = [...password].length;
    if (length < PASSWORD_MIN) {
      setFieldError(`Use at least ${PASSWORD_MIN} characters. This one has ${length}.`);
      return;
    }
    if (passwordTooLong(password)) {
      setFieldError('Use a shorter password: this one is over the 256-character limit.');
      return;
    }
    setFieldError(null);
    setBusy(true);
    const outcome = await resetPassword(token, password);
    setBusy(false);
    if (outcome.ok) {
      // Every session in the account is revoked, this device's included.
      adoptSession(null);
      onDone();
      return;
    }
    switch (outcome.kind) {
      case 'breached':
        setFieldError('This password appears in known data breaches. Choose a different one.');
        return;
      case 'invalid-password':
        setFieldError(`Use at least ${PASSWORD_MIN} characters.`);
        return;
      case 'rate-limited':
        wait.start(outcome.retryAt);
        return;
      case 'unreachable':
        setUnreachable(true);
        return;
      default:
        onInvalid();
    }
  }

  const waiting = wait.until !== null;
  return (
    <AuthCard>
      <form onSubmit={save} className="flex flex-col gap-5" aria-busy={busy}>
        <AuthHeading title="Set a new password">Choose a new password for your HalalGoes partner account.</AuthHeading>
        {unreachable ? (
          <ProblemBanner
            innerRef={bannerRef}
            title="We couldn't reach HalalGoes"
            description="Check this device's internet connection, then try again. What you typed is kept."
          />
        ) : null}
        {waiting ? (
          <ProblemBanner
            innerRef={bannerRef}
            waiting
            title="Too many attempts from this device"
            description="Wait a moment, then try again. What you typed is kept."
          />
        ) : null}
        <Input
          ref={fieldRef}
          label="New password"
          variant="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(v) => {
            setPassword(v);
            if (fieldError) setFieldError(null);
          }}
          readOnly={busy}
          helperText="At least 12 characters. Any characters are fine; we refuse passwords known from data breaches."
          errorText={fieldError ?? undefined}
        />
        <p className="m-0 text-body-sm leading-normal text-fg-secondary">
          Setting a new password signs you out on every device, including your order screen. Sign in there again
          afterwards so new orders keep reaching it.
        </p>
        <Button
          type="submit"
          size="lg"
          fullWidth
          loading={busy}
          disabled={waiting}
          aria-describedby={waiting ? 'reset-wait' : undefined}
        >
          {unreachable ? 'Try again' : 'Set new password'}
        </Button>
        {wait.until ? (
          <p id="reset-wait" className="m-0 text-body-sm text-fg-secondary">
            You can try again at {formatClockTime(wait.until)}.
          </p>
        ) : null}
      </form>
    </AuthCard>
  );
}

/**
 * Reset-LinkInvalid. `resetPassword` answers one generic `400 TOKEN_CONSUMED` for an expired,
 * used or unknown link, so one screen covers all three, as the board does.
 */
function LinkInvalid({ onNewLink }: { onNewLink: () => void }) {
  return (
    <AuthCard>
      <Icon name="clock" size={32} className="text-fg-secondary" />
      <AuthHeading title="This link doesn't work any more">
        Reset links work for 30 minutes and only once. Ask for a new one and use the newest email.
      </AuthHeading>
      <Button size="lg" fullWidth onPress={onNewLink}>
        Email me a new link
      </Button>
      <BackToSignIn />
    </AuthCard>
  );
}

/** Reset-Done. */
function Done() {
  const navigate = useNavigate();
  return (
    <AuthCard>
      <Icon name="check" size={32} className="text-fg-secondary" />
      <AuthHeading title="Your new password is set">
        You're signed out on every device, including your order screen. Sign in with your new password, then open the
        order screen again so new orders reach it.
      </AuthHeading>
      <Button size="lg" fullWidth onPress={() => navigate('/login')}>
        Sign in
      </Button>
    </AuthCard>
  );
}
