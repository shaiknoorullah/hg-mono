/**
 * `/forgot-password` — Reset your password (canvas SI `Forgot-*`; WP2 spec §5).
 * `requestPasswordReset` answers 200 whatever the address, so "Sent" never says whether an
 * account exists. Retrying after a failure is safe: the same answer every time.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { client } from '../data/client';
import { Button, GlyphIcon, InlineAlert, Input } from '../ds';
import { attempt, looksLikeEmail, supportFrom, usePublicConfig } from './api';
import { FORGOT } from './copy';
import { AuthCard, BackToSignIn, HeadingBlock, SupportSentence } from './frame';

export function ForgotPasswordScreen() {
  const location = useLocation();
  const config = usePublicConfig();
  const support = supportFrom(config);
  const [email, setEmail] = useState(() => (location.state as { email?: string } | null)?.email ?? '');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(0);
  const [sentTo, setSentTo] = useState<string | null>(null);
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
      setFieldError(FORGOT.emailError);
      return;
    }
    setSending(true);
    const res = await attempt(() => client.POST('/v1/auth/password/forgot', { body: { email: to } }));
    setSending(false);
    if (res.ok) {
      setFailed(0);
      setSentTo(to);
      return;
    }
    if (!res.network && res.status === 422) {
      setFieldError(FORGOT.emailError);
      return;
    }
    setFailed((n) => n + 1);
  }

  if (sentTo) {
    return (
      <AuthCard testId="forgot-sent">
        <h1 className="m-0 text-heading-xl text-fg-primary">{FORGOT.sentTitle}</h1>
        <p className="m-0 text-body-md leading-normal text-fg-secondary">
          {FORGOT.sentBefore}
          <strong className="text-fg-primary">{sentTo}</strong>
          {FORGOT.sentAfter}
        </p>
        <p className="m-0 text-body-md leading-normal text-fg-secondary">{FORGOT.sentHelp}</p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Button variant="tertiary" size="md" onPress={() => setSentTo(null)}>
            {FORGOT.another}
          </Button>
          <BackToSignIn />
        </div>
      </AuthCard>
    );
  }

  return (
    <>
      <AuthCard testId="forgot-card">
        <form noValidate onSubmit={send} aria-busy={sending || undefined} className="flex flex-col gap-5" aria-label={FORGOT.title}>
          <HeadingBlock title={FORGOT.title} intro={FORGOT.intro} />
          {failed > 0 && !sending ? (
            <InlineAlert key={failed} tone="neutral" icon="warning" blocking title={FORGOT.errorTitle}>
              <span>{FORGOT.errorBody}</span>
            </InlineAlert>
          ) : null}
          <Input
            ref={emailRef}
            label={FORGOT.email}
            variant="email"
            autoComplete="username"
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
            {failed > 0 ? FORGOT.tryAgain : FORGOT.submit}
          </Button>
          <BackToSignIn />
        </form>
      </AuthCard>
      <SupportSentence support={support} />
    </>
  );
}
