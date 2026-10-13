/**
 * `/accept-invite?token=…`: the invitee sets a password (`STF/AcceptSetPassword` family),
 * STEP 1 ONLY. Owner decision D1 (PR #623) makes two-step sign-in opt-in, so there is no
 * second step, no step indicator and no promise of one; the authenticator is turned on later
 * under Your account.
 *
 * No operation looks an invitation up (G-AUTH-2), so nothing is prefilled (no email, role or
 * inviter) and "checking the link" collapses into the submit: the password goes to
 * `resetPassword` with the link's token, and a spent link (expired or used: one
 * `400 TOKEN_CONSUMED`) is only known then. States: link not recognised, set password, too
 * short (checked here), breached (422), saving, offline (what was typed is kept), server
 * didn't answer, expired or used, done -> Go to sign in. Reflows at 390 and 320.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { emailLinkCalls, isWellFormedToken, useLinkToken, useSetPasswordForm } from '@hg/ui-web/email-links';

import { api } from '../data/api';
import { Button, Card, InlineAlert, Input, Wordmark } from '../ds';
import { ACCEPT, tooManyRequests } from './copy';
import { useOnline } from './online';

const calls = emailLinkCalls(api);

type Step = 'invalid' | 'set' | 'spent' | 'done';

export function AcceptInviteScreen() {
  const token = useLinkToken('/accept-invite');
  const [step, setStep] = useState<Step>(() => (isWellFormedToken(token) ? 'set' : 'invalid'));
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef(step);

  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    headingRef.current?.focus();
  }, [step]);

  return (
    <main className="flex min-h-screen w-full min-w-0 flex-col items-center bg-surface-base px-4 py-10">
      <div className="flex w-full min-w-0 max-w-[520px] flex-col gap-6">
        <Wordmark height={32} />
        <Card variant="elevated" padding="clamp(20px, 5vw, 32px)" className="w-full min-w-0">
          {step === 'set' && isWellFormedToken(token) ? (
            <SetPassword
              token={token}
              headingRef={headingRef}
              onSpent={() => setStep('spent')}
              onDone={() => setStep('done')}
            />
          ) : null}
          {step === 'invalid' ? (
            <Message headingRef={headingRef} title={ACCEPT.invalidTitle} body={ACCEPT.invalidBody} />
          ) : null}
          {step === 'spent' ? (
            <Message headingRef={headingRef} title={ACCEPT.spentTitle} body={ACCEPT.spentBody} signIn />
          ) : null}
          {step === 'done' ? (
            <Message headingRef={headingRef} title={ACCEPT.doneTitle} body={ACCEPT.doneBody} signIn />
          ) : null}
        </Card>
      </div>
    </main>
  );
}

function Message({
  headingRef,
  title,
  body,
  signIn = false,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  title: string;
  body: string;
  signIn?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h1 ref={headingRef} tabIndex={-1} className="m-0 text-heading-xl break-words text-fg-primary outline-none">
        {title}
      </h1>
      <p className="m-0 text-body-md text-fg-primary">{body}</p>
      {signIn ? (
        // The one next step, primary on both spent and done pages (`STF/AcceptUsed`, `STF/AcceptDone`).
        <Button variant="primary" size="lg" fullWidth href="/">
          {ACCEPT.goToSignIn}
        </Button>
      ) : null}
    </div>
  );
}

function SetPassword({
  token,
  headingRef,
  onSpent,
  onDone,
}: {
  token: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onSpent: () => void;
  onDone: () => void;
}) {
  const online = useOnline();
  const form = useSetPasswordForm({
    token,
    reset: calls.resetPassword,
    breachedMessage: ACCEPT.breached,
    onInvalid: onSpent,
    onDone,
  });
  const [attempt, setAttempt] = useState(0);
  const wait = form.wait.until ? tooManyRequests(form.wait.until) : null;
  const offline = !online || (form.unreachable && typeof navigator !== 'undefined' && navigator.onLine === false);

  function submit(e: FormEvent) {
    if (!online) {
      e.preventDefault();
      return;
    }
    setAttempt((n) => n + 1);
    void form.save(e);
  }

  return (
    <form noValidate aria-busy={form.busy || undefined} onSubmit={submit} className="flex min-w-0 flex-col gap-5">
      <h1 ref={headingRef} tabIndex={-1} className="m-0 text-heading-xl break-words text-fg-primary outline-none">
        {ACCEPT.title}
      </h1>
      <p className="m-0 text-body-md text-fg-secondary">{ACCEPT.intro}</p>
      {offline ? (
        <InlineAlert tone="warning" title={ACCEPT.offline.title}>
          {ACCEPT.offline.body}
        </InlineAlert>
      ) : form.unreachable ? (
        <InlineAlert key={`unreachable-${attempt}`} blocking tone="warning" title={ACCEPT.noAnswer.title}>
          {ACCEPT.noAnswer.body}
        </InlineAlert>
      ) : wait ? (
        <InlineAlert key={`wait-${attempt}`} blocking tone="warning" title={wait.title}>
          {wait.body}
        </InlineAlert>
      ) : null}
      <Input
        ref={form.fieldRef}
        label={ACCEPT.newPassword}
        variant="password"
        autoComplete="new-password"
        required
        value={form.password}
        onValueChange={form.changePassword}
        readOnly={form.busy}
        helperText={ACCEPT.helper}
        errorText={form.fieldError}
      />
      <Button
        type="submit"
        size="lg"
        fullWidth
        loading={form.busy}
        disabled={!online || form.waiting}
        {...(!online ? { accessibilityLabel: ACCEPT.submitOffline } : {})}
      >
        {ACCEPT.submit}
      </Button>
    </form>
  );
}
