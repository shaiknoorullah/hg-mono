/**
 * `/verify-email?token=` — the email confirmation link (canvas SI `Verify-*`; WP2 spec §4).
 *
 * The token is taken out of the address bar at boot (`@hg/ui-web/link-token`, `linkTokenBoot.ts`)
 * and only ever sent in the POST body. A malformed token is the expired state before anything is
 * sent. `verifyEmail` issues no session (#356), so a confirmed email goes on to sign in. An
 * expired link offers a new one by email, which lands on `/check-email` in its one-minute wait.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { isWellFormedToken, useLinkToken } from '@hg/ui-web/email-links';
import { client } from '../data/client';
import { Button, GlyphIcon, InlineAlert, Input, usePageAnnouncer } from '../ds';
import { attempt, looksLikeEmail, serverWait, type Attempt, type ServerWait } from './api';
import { COMMON, VERIFY } from './copy';
import { AuthCard, HeadingBlock, IconTile, TextLink, WaitLine } from './frame';
import type { CheckEmailEntry } from './CheckEmailScreen';

type Phase =
  | { kind: 'working' }
  | { kind: 'done' }
  | { kind: 'used' }
  | { kind: 'expired' }
  | { kind: 'error'; wait: ServerWait | null };

/**
 * One request per token at a time: React may mount the page twice (StrictMode, a fast
 * remount), and a second POST of the same token would come back "already used".
 */
const inFlight = new Map<string, Promise<Attempt<undefined>>>();

function verifyOnce(token: string): Promise<Attempt<undefined>> {
  let p = inFlight.get(token);
  if (!p) {
    p = (attempt(() => client.POST('/v1/auth/email/verify', { body: { token } })) as Promise<Attempt<undefined>>).finally(() =>
      inFlight.delete(token),
    );
    inFlight.set(token, p);
  }
  return p;
}

function phaseOf(res: Attempt<undefined>): Phase {
  if (res.ok) return { kind: 'done' };
  if (res.network || res.status >= 500) return { kind: 'error', wait: null };
  if (res.code === 'VERIFICATION_TOKEN_USED') return { kind: 'used' };
  if (res.code === 'RATE_LIMITED') return { kind: 'error', wait: serverWait(res.serverDate, res.retryAfter ?? 60) };
  // VERIFICATION_TOKEN_EXPIRED, an unknown token, or any other refusal: ask for a new link.
  return { kind: 'expired' };
}

export function VerifyEmailScreen() {
  const token = useLinkToken('/verify-email');
  const valid = isWellFormedToken(token);
  const [phase, setPhase] = useState<Phase>(valid ? { kind: 'working' } : { kind: 'expired' });
  const [attemptNo, setAttemptNo] = useState(0);

  useEffect(() => {
    if (!valid) return;
    let live = true;
    void verifyOnce(token).then((res) => {
      if (live) setPhase(phaseOf(res));
    });
    return () => {
      live = false;
    };
  }, [valid, token, attemptNo]);

  const retry = () => {
    if (!valid) return;
    inFlight.delete(token);
    setPhase({ kind: 'working' });
    setAttemptNo((n) => n + 1);
  };

  switch (phase.kind) {
    case 'working':
      return (
        <AuthCard testId="verify-working">
          <div className="flex flex-col gap-6">
            <HeadingBlock title={VERIFY.workingTitle} intro={VERIFY.workingBody} />
            <div className="mt-4 flex flex-col gap-3">
              <p role="status" className="m-0 text-label-lg text-fg-primary">
                {VERIFY.workingStatus}
              </p>
              <div className="h-2 w-full overflow-hidden rounded-full bg-line-decorative" aria-hidden="true">
                <div className="h-full w-2/5 animate-pulse rounded-full bg-fg-secondary" />
              </div>
            </div>
          </div>
        </AuthCard>
      );
    case 'done':
      return (
        <AuthCard testId="verify-done">
          <IconTile name="check" />
          <HeadingBlock title={VERIFY.doneTitle} intro={VERIFY.doneBody} />
          <SignInButton />
        </AuthCard>
      );
    case 'used':
      return (
        <AuthCard testId="verify-used">
          <IconTile name="check" />
          <HeadingBlock title={VERIFY.usedTitle} intro={VERIFY.usedBody} />
          <SignInButton />
        </AuthCard>
      );
    case 'error':
      return <VerifyError wait={phase.wait} onRetry={retry} onWaitOver={() => setPhase({ kind: 'error', wait: null })} />;
    case 'expired':
      return <ExpiredLink />;
  }
}

function SignInButton() {
  const navigate = useNavigate();
  return (
    <Button variant="primary" size="lg" fullWidth onPress={() => navigate('/login')}>
      {VERIFY.signIn}
    </Button>
  );
}

function VerifyError({ wait, onRetry, onWaitOver }: { wait: ServerWait | null; onRetry: () => void; onWaitOver: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { announce } = usePageAnnouncer();
  useEffect(() => ref.current?.focus(), []);
  const over = useCallback(() => {
    onWaitOver();
    announce(COMMON.waitOver, 'polite');
  }, [onWaitOver, announce]);
  return (
    <AuthCard testId="verify-error">
      <div ref={ref} role="alert" tabIndex={-1} className="hg-focus flex flex-col gap-5 rounded-[12px]">
        <IconTile name="warning" />
        <HeadingBlock title={VERIFY.errorTitle} intro={VERIFY.errorBody} />
      </div>
      <Button
        variant="primary"
        size="lg"
        fullWidth
        disabled={wait !== null}
        iconStart={<GlyphIcon name="refresh" size="md" />}
        onPress={onRetry}
        {...(wait ? { 'aria-describedby': 'wait-reason' } : {})}
      >
        {VERIFY.tryAgain}
      </Button>
      {wait ? <WaitLine wait={wait} onExpire={over} /> : null}
    </AuthCard>
  );
}

/** Verify-Expired / -ExpiredSending / -ExpiredError: ask for a new link by email. */
function ExpiredLink() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(0);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (fieldError) emailRef.current?.focus();
  }, [fieldError]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (sending) return;
    const to = email.trim();
    if (!looksLikeEmail(to)) {
      setFieldError(VERIFY.emailError);
      return;
    }
    setSending(true);
    const res = await attempt(() => client.POST('/v1/auth/email/resend', { body: { email: to } }));
    setSending(false);
    if (res.ok) {
      const entry: CheckEmailEntry = { email: to, start: 'cooldown', wait: serverWait(res.serverDate, 60) };
      navigate('/check-email', { state: entry });
      return;
    }
    if (!res.network && res.code === 'RATE_LIMITED') {
      const seconds = res.retryAfter ?? 60;
      const entry: CheckEmailEntry = { email: to, start: seconds > 60 ? 'daily' : 'cooldown', wait: serverWait(res.serverDate, seconds) };
      navigate('/check-email', { state: entry });
      return;
    }
    if (!res.network && res.status === 422) {
      setFieldError(VERIFY.emailError);
      return;
    }
    setFailed((n) => n + 1);
  }

  return (
    <AuthCard testId="verify-expired">
      <form noValidate onSubmit={send} aria-busy={sending || undefined} className="flex flex-col gap-5" aria-label={VERIFY.expiredTitle}>
        <IconTile name="clock" />
        <HeadingBlock title={VERIFY.expiredTitle} intro={VERIFY.expiredBody} />
        {failed > 0 && !sending ? (
          <InlineAlert key={failed} tone="danger" icon="error" blocking title={VERIFY.sendErrorTitle}>
            <span>{VERIFY.sendErrorBody}</span>
          </InlineAlert>
        ) : null}
        <Input
          ref={emailRef}
          label={VERIFY.email}
          variant="email"
          autoComplete="email"
          size="lg"
          value={email}
          readOnly={sending}
          onChange={(v) => {
            setEmail(v);
            if (fieldError) setFieldError(undefined);
          }}
          errorText={fieldError}
          required
        />
        <Button
          variant="primary"
          size="lg"
          fullWidth
          type="submit"
          loading={sending}
          iconStart={failed > 0 ? <GlyphIcon name="refresh" size="md" /> : undefined}
        >
          {failed > 0 ? VERIFY.tryAgain : VERIFY.send}
        </Button>
        {failed === 0 && !sending ? (
          <p className="m-0 text-body-md text-fg-secondary">
            {VERIFY.alreadyBefore}
            <TextLink to="/login">{VERIFY.signIn}</TextLink>
          </p>
        ) : null}
      </form>
    </AuthCard>
  );
}
