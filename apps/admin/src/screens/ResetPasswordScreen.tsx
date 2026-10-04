import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Icon, Input } from '@hg/ui-web';

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
import { setToken } from '../lib/token';
import { AuthCard, AuthHeading, BackToSignIn, ProblemBanner } from '../components/AuthFrame';

/**
 * `/reset-password`: "Forgot your password?" from the sign-in gate and, with `?token=…`, the
 * page the reset email links to (issue #329).
 *
 * The admin canvases have no reset board yet, so this follows the restaurant Sign-in
 * canvas's reset row (https://claude.ai/artifact/9AZ5YnbTdrfyFK1mUwYtCw: Forgot-Password to
 * Reset-Done) in the Staff canvas's frame, with the staff copy the invite boards use.
 */
type Step = 'request' | 'set' | 'invalid' | 'done';

export function ResetPasswordScreen() {
  const token = useLinkToken();
  const [step, setStep] = useState<Step>(token === null ? 'request' : isWellFormedToken(token) ? 'set' : 'invalid');

  if (step === 'set' && isWellFormedToken(token)) {
    return (
      <SetPasswordForm
        token={token}
        title="Set a new password"
        intro="Choose a new password for your HalalGoes staff account."
        note="Setting a new password signs you out on every device."
        submitLabel="Set new password"
        onInvalid={() => setStep('invalid')}
        onDone={() => setStep('done')}
      />
    );
  }

  if (step === 'invalid') {
    return (
      <AuthCard>
        <Icon name="clock" size={32} className="text-fg-secondary" />
        <AuthHeading title="This link doesn't work any more">
          Reset links work for 30 minutes and only once. Ask for a new one and use the newest email.
        </AuthHeading>
        <Button size="lg" fullWidth onPress={() => setStep('request')}>
          Email me a new link
        </Button>
        <BackToSignIn />
      </AuthCard>
    );
  }

  if (step === 'done') {
    return (
      <AuthCard>
        <Icon name="check" size={32} className="text-fg-secondary" />
        <AuthHeading title="Your new password is set">
          You're signed out on every device. Sign in with your work email, your new password and a code from your
          authenticator app.
        </AuthHeading>
        <Button size="lg" fullWidth href="/">
          Go to sign in
        </Button>
      </AuthCard>
    );
  }

  return <RequestLink />;
}

/** Forgot password: `requestPasswordReset`, the same answer whether or not the account exists. */
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
    return (
      <AuthCard>
        <AuthHeading title="Check your email">
          If <strong className="text-fg-primary">{sentTo}</strong> has a HalalGoes staff account, we've sent it a link
          to set a new password.
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
          Enter your work email. We'll send a link to set a new password.
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
          label="Work email"
          variant="email"
          autoComplete="username"
          required
          value={email}
          onChange={setEmail}
          readOnly={busy}
          errorText={problem === 'invalid-email' ? 'Enter your work email, like name@halalgoes.com.' : undefined}
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

/**
 * One password, sent with the link's token through `resetPassword`: the reset page's
 * "Set a new password" and the invite's "Step 1 of 2" (Accept 1/2 boards: set password,
 * too short, saving, breached, offline).
 */
export function SetPasswordForm({
  token,
  eyebrow,
  title,
  intro,
  note,
  submitLabel,
  onInvalid,
  onDone,
}: {
  token: string;
  eyebrow?: string;
  title: string;
  intro: ReactNode;
  note?: string;
  submitLabel: string;
  onInvalid: () => void;
  onDone: () => void;
}) {
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
      // Every session in the account is revoked, this tab's included.
      setToken(null);
      onDone();
      return;
    }
    switch (outcome.kind) {
      case 'breached':
        setFieldError(
          "This password has appeared in a data breach, so it isn't safe. Choose a different one of at least 12 characters.",
        );
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
        <AuthHeading eyebrow={eyebrow} title={title}>
          {intro}
        </AuthHeading>
        {unreachable ? (
          <ProblemBanner
            innerRef={bannerRef}
            title="We couldn't reach HalalGoes"
            description="What you typed is still here, and your link hasn't been used. Try again in a moment."
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
          helperText="At least 12 characters. We check it against passwords exposed in data breaches."
          errorText={fieldError ?? undefined}
        />
        {note ? <p className="m-0 text-body-sm leading-normal text-fg-secondary">{note}</p> : null}
        <Button
          type="submit"
          size="lg"
          fullWidth
          loading={busy}
          disabled={waiting}
          aria-describedby={waiting ? 'password-wait' : undefined}
        >
          {unreachable ? 'Try again' : submitLabel}
        </Button>
        {wait.until ? (
          <p id="password-wait" className="m-0 text-body-sm text-fg-secondary">
            You can try again at {formatClockTime(wait.until)}.
          </p>
        ) : null}
      </form>
    </AuthCard>
  );
}
