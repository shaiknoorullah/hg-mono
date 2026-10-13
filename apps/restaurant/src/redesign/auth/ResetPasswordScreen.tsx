/**
 * `/reset-password?token=` — Set a new password (canvas SI `Reset-*`; WP2 spec §6).
 *
 * The token is captured at boot and sent only in the POST body; a missing or malformed one is
 * "This link doesn't work any more" before anything is sent. At least 12 characters (and at most
 * 256 UTF-8 bytes), no composition rules, checked here first so a short password never spends the
 * link. `resetPassword` signs out every session and issues none: Done goes to sign in.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { isWellFormedToken, passwordTooLong, PASSWORD_MIN, useLinkToken } from '@hg/ui-web/email-links';
import { setSession } from '../../lib/api';
import { client } from '../data/client';
import { Button, GlyphIcon, InlineAlert, Input, StateCard, StateCardHeading, StateCardIcon, SupportSentence, TextLink, usePageAnnouncer, WaitLine } from '../ds';
import { attempt, serverWait, supportFrom, usePublicConfig, type ServerWait } from './api';
import { COMMON, RESET, SIGN_IN, SUPPORT } from './copy';

type Phase = 'form' | 'invalid' | 'done';
type Problem = { kind: 'unreachable' } | { kind: 'rate'; wait: ServerWait | null };

export function ResetPasswordScreen() {
  const token = useLinkToken('/reset-password');
  const valid = isWellFormedToken(token);
  const navigate = useNavigate();
  const config = usePublicConfig();
  const support = supportFrom(config);
  const { announce } = usePageAnnouncer();
  const [phase, setPhase] = useState<Phase>(valid ? 'form' : 'invalid');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [problem, setProblem] = useState<Problem | null>(null);
  const [failures, setFailures] = useState(0);
  const fieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (fieldError) fieldRef.current?.focus();
  }, [fieldError, failures]);

  const waiting = problem?.kind === 'rate' && problem.wait !== null;
  const waitOver = useCallback(() => {
    setProblem((p) => (p?.kind === 'rate' ? { kind: 'rate', wait: null } : p));
    announce(COMMON.waitOver, 'polite');
  }, [announce]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (saving || waiting || !valid) return;
    if ([...password].length < PASSWORD_MIN) {
      setFieldError(RESET.tooShort);
      setFailures((n) => n + 1);
      return;
    }
    if (passwordTooLong(password)) {
      setFieldError(RESET.tooLong);
      setFailures((n) => n + 1);
      return;
    }
    setFieldError(undefined);
    setProblem(null);
    setSaving(true);
    const res = await attempt(() => client.POST('/v1/auth/password/reset', { body: { token, new_password: password } }));
    setSaving(false);
    if (res.ok) {
      // Every session was revoked, this device's included.
      setSession(null);
      setPhase('done');
      return;
    }
    if (res.network || res.status >= 500) {
      setProblem({ kind: 'unreachable' });
      setFailures((n) => n + 1);
      return;
    }
    switch (res.code) {
      case 'BREACHED_PASSWORD':
        setFieldError(RESET.breached);
        setFailures((n) => n + 1);
        return;
      case 'VALIDATION_FAILED':
        setFieldError(RESET.tooShort);
        setFailures((n) => n + 1);
        return;
      case 'RATE_LIMITED':
        setProblem({ kind: 'rate', wait: serverWait(res.serverDate, res.retryAfter ?? 60) });
        setFailures((n) => n + 1);
        return;
      default:
        // TOKEN_CONSUMED (expired, used or unknown: one generic answer) and any other refusal.
        setPhase('invalid');
    }
  }

  if (phase === 'invalid') {
    return (
      <>
        <StateCard testId="reset-invalid">
          <StateCardIcon name="clock" />
          <StateCardHeading title={RESET.invalidTitle} intro={RESET.invalidBody} />
          <Button variant="primary" size="lg" fullWidth onPress={() => navigate('/forgot-password')}>
            {RESET.newLink}
          </Button>
          <TextLink to="/login" variant="standalone">{COMMON.backToSignIn}</TextLink>
        </StateCard>
        <SupportSentence contact={support} lead={SUPPORT.sentenceBefore} />
      </>
    );
  }

  if (phase === 'done') {
    return (
      <StateCard testId="reset-done">
        <StateCardIcon name="check" />
        <StateCardHeading title={RESET.doneTitle} intro={RESET.doneBody} />
        <Button variant="primary" size="lg" fullWidth onPress={() => navigate('/login')}>
          {RESET.signIn}
        </Button>
      </StateCard>
    );
  }

  return (
    <StateCard testId="reset-card">
      <form noValidate onSubmit={save} aria-busy={saving || undefined} className="flex flex-col gap-5" aria-label={RESET.title}>
        <StateCardHeading title={RESET.title} intro={RESET.intro} />
        {problem?.kind === 'unreachable' && !saving ? (
          <InlineAlert key={failures} tone="neutral" icon="warning" blocking title={RESET.errorTitle}>
            <span>{RESET.errorBody}</span>
          </InlineAlert>
        ) : null}
        {problem?.kind === 'rate' ? (
          <InlineAlert tone="warning" icon="clock" title={SIGN_IN.tooManyTitle}>
            <span>{SIGN_IN.tooManyBody}</span>
          </InlineAlert>
        ) : null}
        <Input
          ref={fieldRef}
          label={RESET.password}
          helperText={RESET.help}
          variant="password"
          autoComplete="new-password"
          size="lg"
          value={password}
          readOnly={saving}
          onChange={(v) => {
            setPassword(v);
            if (fieldError) setFieldError(undefined);
          }}
          errorText={fieldError}
          required
        />
        {saving ? null : <p className="m-0 text-body-md leading-normal text-fg-primary">{RESET.signsOut}</p>}
        <Button
          variant="primary"
          size="lg"
          fullWidth
          type="submit"
          loading={saving}
          disabled={waiting}
          iconStart={problem?.kind === 'unreachable' ? <GlyphIcon name="refresh" size="md" /> : undefined}
          {...(waiting ? { 'aria-describedby': 'wait-reason' } : {})}
        >
          {problem?.kind === 'unreachable' ? RESET.tryAgain : RESET.submit}
        </Button>
        {problem?.kind === 'rate' && problem.wait ? <WaitLine prefix={COMMON.waitPrefix} label={COMMON.waitLabel} wait={problem.wait} onExpire={waitOver} /> : null}
      </form>
    </StateCard>
  );
}
