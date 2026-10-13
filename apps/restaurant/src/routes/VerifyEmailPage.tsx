import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Icon, Input, Spinner } from '@hg/ui-web';
import {
  formatClockTime,
  isWellFormedToken,
  useLinkToken,
  useRequestLinkForm,
  useRetryWindow,
} from '@hg/ui-web/email-links';
import { isSignedIn, useAuth } from '../lib/auth';
import { resendVerification, verifyEmail } from '../lib/emailLinks';
import { AuthCard, AuthHeading, BackToSignIn, ProblemBanner, SignedInPrompt } from '../components/AuthFrame';

/**
 * `/verify-email?token=…`, the link in the sign-up email (issue #329). It confirms the email
 * through `verifyEmail` and then sends the owner to the normal sign-in: opening a link never
 * signs anyone in, so the session the API still returns is dropped (#356). If someone is
 * already signed in on this device, it asks before using the token.
 *
 * Boards: "Check your email and verify link" in the restaurant Sign-in canvas
 * (https://claude.ai/artifact/9AZ5YnbTdrfyFK1mUwYtCw): Verify-Working, Verify-Expired,
 * Verify-ExpiredSending, Verify-ExpiredError, Verify-Used, Verify-Error and, after a new link
 * is sent, CheckEmail-Default and CheckEmail-Cooldown. "Email verified", "already signed in",
 * the incomplete link (no or malformed token) and a 429 on the confirmation itself have no
 * board yet.
 */
type LinkState =
  | 'signed-in'
  | 'checking'
  | 'verified'
  | 'unreachable'
  | 'rate-limited'
  | 'used'
  | 'expired'
  | 'incomplete';

export function VerifyEmailPage() {
  const token = useLinkToken('/verify-email');
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [state, setState] = useState<LinkState>(() =>
    !isWellFormedToken(token) ? 'incomplete' : isSignedIn() ? 'signed-in' : 'checking',
  );
  const [signingOut, setSigningOut] = useState(false);
  const wait = useRetryWindow();
  const started = useRef(false);

  async function confirm() {
    if (!isWellFormedToken(token)) return;
    setState('checking');
    const outcome = await verifyEmail(token);
    if (outcome.ok) {
      setState('verified');
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
    if (started.current || state !== 'checking') return;
    started.current = true;
    void confirm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === 'signed-in') {
    return (
      <SignedInPrompt
        busy={signingOut}
        onStay={() => navigate('/orders')}
        onSignOut={async () => {
          setSigningOut(true);
          await logout();
          setSigningOut(false);
          started.current = true;
          void confirm();
        }}
      />
    );
  }

  if (state === 'checking') {
    return (
      <AuthCard>
        <AuthHeading title="Confirming your email">This only takes a moment.</AuthHeading>
        <div role="status" className="flex items-center gap-3 text-body-md text-fg-secondary">
          <Spinner size="sm" decorative />
          Confirming your email…
        </div>
      </AuthCard>
    );
  }

  if (state === 'verified' || state === 'used') {
    return (
      <AuthCard>
        <Icon name="check" size={32} className="text-fg-secondary" />
        {state === 'verified' ? (
          <AuthHeading title="Email verified">Sign in to start setting up your restaurant.</AuthHeading>
        ) : (
          <AuthHeading title="This link has already been used">
            Your email is confirmed. Sign in to carry on setting up your restaurant.
          </AuthHeading>
        )}
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
  const { email, setEmail, busy, sentTo, problem, wait, waiting, bannerRef, send } =
    useRequestLinkForm(resendVerification);

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
