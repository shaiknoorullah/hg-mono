import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Icon, Input, Spinner } from '@hg/ui-web';
import { useAuth } from '../lib/auth';
import {
  formatClockTime,
  isWellFormedToken,
  resendVerification,
  useLinkToken,
  useRetryWindow,
  verifyEmail,
} from '../lib/emailLinks';
import { AuthCard, AuthHeading, BackToSignIn, ProblemBanner } from '../components/AuthFrame';

/**
 * `/verify-email?token=…`, the link in the sign-up email (issue #329). It confirms the email
 * through `verifyEmail`, which also signs the owner in, then opens onboarding.
 *
 * Boards: "Check your email and verify link" in the restaurant Sign-in canvas
 * (https://claude.ai/artifact/9AZ5YnbTdrfyFK1mUwYtCw): Verify-Working, Verify-Expired,
 * Verify-ExpiredSending, Verify-ExpiredError, Verify-Used, Verify-Error and, after a new link
 * is sent, CheckEmail-Default and CheckEmail-Cooldown. The incomplete link (no or malformed
 * token) and a 429 on the confirmation itself have no board yet.
 */
type LinkState = 'checking' | 'unreachable' | 'rate-limited' | 'used' | 'expired' | 'incomplete';

export function VerifyEmailPage() {
  const token = useLinkToken();
  const navigate = useNavigate();
  const { adoptSession } = useAuth();
  const [state, setState] = useState<LinkState>(isWellFormedToken(token) ? 'checking' : 'incomplete');
  const wait = useRetryWindow();
  const started = useRef(false);

  async function confirm() {
    if (!isWellFormedToken(token)) return;
    setState('checking');
    const outcome = await verifyEmail(token);
    if (outcome.ok) {
      adoptSession(outcome.data);
      navigate('/onboarding', { replace: true });
      return;
    }
    if (outcome.kind === 'rate-limited') wait.start(outcome.retryAt);
    setState(
      outcome.kind === 'used' || outcome.kind === 'unreachable' || outcome.kind === 'rate-limited'
        ? outcome.kind
        : 'expired',
    );
  }

  useEffect(() => {
    // A token works once, and StrictMode runs effects twice in development.
    if (started.current) return;
    started.current = true;
    void confirm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === 'checking') {
    return (
      <AuthCard>
        <AuthHeading title="Confirming your email">
          This only takes a moment. You'll go straight to setting up your restaurant.
        </AuthHeading>
        <div role="status" className="flex items-center gap-3 text-body-md text-fg-secondary">
          <Spinner size="sm" decorative />
          Confirming your email…
        </div>
      </AuthCard>
    );
  }

  if (state === 'used') {
    return (
      <AuthCard>
        <Icon name="check" size={32} className="text-fg-secondary" />
        <AuthHeading title="This link has already been used">
          Your email is confirmed. Sign in to carry on setting up your restaurant.
        </AuthHeading>
        <Button size="lg" fullWidth onPress={() => navigate('/login')}>
          Sign in
        </Button>
      </AuthCard>
    );
  }

  if (state === 'unreachable' || state === 'rate-limited') {
    const waiting = wait.until !== null;
    return (
      <AuthCard>
        <AuthHeading title="We couldn't confirm your email">
          {state === 'unreachable'
            ? "We couldn't reach HalalGoes. Check your connection and try again. Your link still works."
            : 'Too many attempts from this device. Wait a moment, then try again. Your link still works.'}
        </AuthHeading>
        <Button
          size="lg"
          fullWidth
          disabled={waiting}
          aria-describedby={waiting ? 'verify-wait' : undefined}
          onPress={() => void confirm()}
        >
          Try again
        </Button>
        {wait.until ? (
          <p id="verify-wait" className="m-0 text-body-sm text-fg-secondary">
            You can try again at {formatClockTime(wait.until)}.
          </p>
        ) : null}
      </AuthCard>
    );
  }

  return <SendNewLink incomplete={state === 'incomplete'} />;
}

/** Verify-Expired and its sending, error and sent states: `resendEmailVerification`. */
function SendNewLink({ incomplete }: { incomplete: boolean }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [problem, setProblem] = useState<'unreachable' | 'invalid-email' | null>(null);
  const wait = useRetryWindow();
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (problem === 'unreachable' || wait.until) bannerRef.current?.focus();
  }, [problem, wait.until]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    setProblem(null);
    setBusy(true);
    const outcome = await resendVerification(email.trim());
    setBusy(false);
    if (outcome.ok) {
      setSentTo(email.trim());
      return;
    }
    if (outcome.kind === 'rate-limited') wait.start(outcome.retryAt);
    else setProblem(outcome.kind === 'invalid-email' ? 'invalid-email' : 'unreachable');
  }

  const waiting = wait.until !== null;
  const waitLine = wait.until ? (
    <p id="resend-wait" className="m-0 text-body-sm text-fg-secondary">
      You can send another at {formatClockTime(wait.until)}.
    </p>
  ) : null;
  const banner =
    problem === 'unreachable' ? (
      <ProblemBanner
        innerRef={bannerRef}
        title="We couldn't send a new link"
        description="Check your connection and try again. Nothing else changed."
      />
    ) : waiting ? (
      <ProblemBanner
        innerRef={bannerRef}
        waiting
        title="Too many attempts from this device"
        description="Wait a moment, then try again."
      />
    ) : null;

  if (sentTo !== null) {
    return (
      <AuthCard>
        <AuthHeading title="Check your email">
          If <strong className="text-fg-primary">{sentTo}</strong> is waiting to be confirmed, we've sent it a new
          link. Open it to continue setting up your restaurant.
        </AuthHeading>
        <p className="m-0 text-body-md leading-normal text-fg-secondary">
          The link works for 24 hours. Can't find it? Check your spam folder, or send a new link.
        </p>
        {banner}
        <div className="flex flex-wrap items-center gap-4">
          <Button
            variant="tertiary"
            loading={busy}
            disabled={waiting}
            aria-describedby={waiting ? 'resend-wait' : undefined}
            onPress={() => void send()}
          >
            {problem === 'unreachable' ? 'Try again' : 'Send a new link'}
          </Button>
          <BackToSignIn />
        </div>
        {waitLine}
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <form onSubmit={send} className="flex flex-col gap-5" aria-busy={busy}>
        <Icon name="clock" size={32} className="text-fg-secondary" />
        {incomplete ? (
          <AuthHeading title="This link doesn't work">
            It may be incomplete. Open it again from the email, or enter your email and we'll send a new one.
          </AuthHeading>
        ) : (
          <AuthHeading title="This link has expired">
            Confirmation links work for 24 hours. Enter your email and we'll send a new one.
          </AuthHeading>
        )}
        {banner}
        <Input
          label="Email"
          variant="email"
          autoComplete="email"
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
          aria-describedby={waiting ? 'resend-wait' : undefined}
        >
          {problem === 'unreachable' ? 'Try again' : 'Send a new link'}
        </Button>
        {waitLine}
        <p className="m-0 text-body-md text-fg-secondary">
          Already confirmed your email?{' '}
          <Link to="/login" className="font-semibold text-fg-link">
            Sign in
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
