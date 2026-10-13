/**
 * `/reset-password` (`RV/SignIn-Forgot`, all four steps):
 *
 *   1. ask for a link (`requestPasswordReset`): default, sending, didn't send;
 *   2. sent: the same answer whether or not the account exists;
 *   3. with `?token=…` from the email: choose a new password (`resetPassword`): default,
 *      too short (checked here first, so a short password never spends the link), breached
 *      (422), saving, didn't save;
 *   4. link expired or already used (400 `TOKEN_CONSUMED`, one answer for both), and done.
 *
 * The token was taken out of the address bar at boot (`src/linkTokenBoot.ts`) and is read
 * here from memory once. Saving signs every session out and signs nobody in.
 */
import { useEffect, useRef, useState } from 'react';
import {
  emailLinkCalls,
  isWellFormedToken,
  useLinkToken,
  useRequestLinkForm,
  useSetPasswordForm,
} from '@hg/ui-web/email-links';

import { api } from '../data/api';
import { Button, Card, InlineAlert, Input, Wordmark } from '../ds';
import { OPERATIONS, RESET, SIGN_IN, tooManyRequests } from './copy';
import { LOST_AUTHENTICATOR_HREF } from './memory';

const calls = emailLinkCalls(api);

/** Enough to catch a typo before a request is spent; the server has the last word (422). */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Step = 'ask' | 'choose' | 'expired' | 'done';

export function ResetPasswordScreen() {
  const token = useLinkToken('/reset-password');
  const [step, setStep] = useState<Step>(() =>
    token === null ? 'ask' : isWellFormedToken(token) ? 'choose' : 'expired',
  );
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef(step);

  // A new step is a new page: its heading takes focus (not on first load).
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    headingRef.current?.focus();
  }, [step]);

  return (
    <main className="flex min-h-screen w-full flex-col items-center bg-surface-base px-4 py-10">
      <div className="flex w-full max-w-[440px] flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-2">
          <Wordmark height={32} />
          <p className="m-0 text-body-md text-fg-secondary">{OPERATIONS}</p>
        </div>
        <Card variant="elevated" padding="clamp(20px, 5vw, 32px)" className="w-full">
          {step === 'ask' ? <AskStep headingRef={headingRef} /> : null}
          {step === 'choose' && isWellFormedToken(token) ? (
            <ChooseStep
              token={token}
              headingRef={headingRef}
              onInvalid={() => setStep('expired')}
              onDone={() => setStep('done')}
            />
          ) : null}
          {step === 'expired' ? (
            <div className="flex flex-col gap-4">
              <h1 ref={headingRef} tabIndex={-1} className="sr-only">
                {RESET.expired.title}
              </h1>
              <InlineAlert tone="warning" title={RESET.expired.title}>
                {RESET.expired.body}
              </InlineAlert>
              <Button variant="secondary" size="lg" fullWidth onPress={() => setStep('ask')}>
                {RESET.askAgain}
              </Button>
            </div>
          ) : null}
          {step === 'done' ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2 rounded-md bg-surface-subtle p-4" role="status">
                <h1 ref={headingRef} tabIndex={-1} className="m-0 text-heading-sm text-fg-primary outline-none">
                  {RESET.doneTitle}
                </h1>
                <p className="m-0 text-body-md text-fg-primary">{RESET.doneBody}</p>
              </div>
              <Button size="lg" fullWidth href="/">
                {RESET.goToSignIn}
              </Button>
            </div>
          ) : null}
        </Card>
      </div>
    </main>
  );
}

/** Steps 1 and 2: ask for a link, then "Check your email". */
function AskStep({ headingRef }: { headingRef: React.RefObject<HTMLHeadingElement | null> }) {
  const form = useRequestLinkForm(calls.requestPasswordReset);
  const [attempt, setAttempt] = useState(0);
  /** Checked here before anything is sent: empty, or not shaped like an email address. */
  const [shapeError, setShapeError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const sentHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (form.sentTo !== null) sentHeadingRef.current?.focus();
  }, [form.sentTo]);

  if (form.sentTo !== null) {
    return (
      <div className="flex flex-col gap-4">
        <h1 ref={sentHeadingRef} tabIndex={-1} className="m-0 text-heading-xl text-fg-primary outline-none">
          {RESET.sentTitle}
        </h1>
        <p className="m-0 text-body-md text-fg-primary">{RESET.sentBody(form.sentTo)}</p>
        <p className="m-0 text-body-sm text-fg-secondary">{RESET.sentHint}</p>
        <Button variant="tertiary" size="lg" fullWidth href="/">
          {RESET.back}
        </Button>
      </div>
    );
  }

  const wait = form.wait.until ? tooManyRequests(form.wait.until) : null;
  return (
    <form
      noValidate
      aria-busy={form.busy || undefined}
      onSubmit={(e) => {
        const trimmed = form.email.trim();
        const problem = !trimmed ? SIGN_IN.emailMissing : EMAIL_SHAPE.test(trimmed) ? null : RESET.invalidEmail;
        setShapeError(problem);
        if (problem) {
          e.preventDefault();
          emailRef.current?.focus();
          return;
        }
        setAttempt((n) => n + 1);
        void form.send(e);
      }}
      className="flex flex-col gap-5"
    >
      <h1 ref={headingRef} tabIndex={-1} className="m-0 text-heading-xl text-fg-primary outline-none">
        {RESET.askTitle}
      </h1>
      {form.problem === 'unreachable' ? (
        <InlineAlert key={`unreachable-${attempt}`} blocking tone="warning" title={RESET.notSent.title}>
          {RESET.notSent.body}
        </InlineAlert>
      ) : wait ? (
        <InlineAlert key={`wait-${attempt}`} blocking tone="warning" title={wait.title}>
          {wait.body}
        </InlineAlert>
      ) : (
        <p className="m-0 text-body-md text-fg-secondary">{RESET.askIntro}</p>
      )}
      <Input
        ref={emailRef}
        label={RESET.email}
        variant="email"
        autoComplete="username"
        required
        value={form.email}
        onValueChange={(v) => {
          form.setEmail(v);
          if (shapeError) setShapeError(null);
        }}
        readOnly={form.busy}
        errorText={shapeError ?? (form.problem === 'invalid-email' ? RESET.invalidEmail : null)}
      />
      <div className="flex flex-col gap-2">
        <Button type="submit" size="lg" fullWidth loading={form.busy} disabled={form.waiting}>
          {RESET.send}
        </Button>
        {form.busy ? <p className="m-0 text-body-sm text-fg-secondary">{RESET.sendingNote}</p> : null}
      </div>
      {form.busy ? null : (
        // A plain link, as drawn: it opens the sign-in page's lost-authenticator help.
        <a
          href={LOST_AUTHENTICATOR_HREF}
          className="inline-flex min-h-11 items-center self-start text-body-md text-fg-link underline"
        >
          {RESET.lostInstead}
        </a>
      )}
    </form>
  );
}

/** Step 3: choose a new password from the link. */
function ChooseStep({
  token,
  headingRef,
  onInvalid,
  onDone,
}: {
  token: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onInvalid: () => void;
  onDone: () => void;
}) {
  const form = useSetPasswordForm({
    token,
    reset: calls.resetPassword,
    breachedMessage: RESET.breached,
    onInvalid,
    onDone,
  });
  const [attempt, setAttempt] = useState(0);
  const wait = form.wait.until ? tooManyRequests(form.wait.until) : null;

  return (
    <form
      noValidate
      aria-busy={form.busy || undefined}
      onSubmit={(e) => {
        setAttempt((n) => n + 1);
        void form.save(e);
      }}
      className="flex flex-col gap-5"
    >
      <h1 ref={headingRef} tabIndex={-1} className="m-0 text-heading-xl text-fg-primary outline-none">
        {RESET.chooseTitle}
      </h1>
      {form.unreachable ? (
        <InlineAlert key={`unreachable-${attempt}`} blocking tone="warning" title={RESET.notSaved.title}>
          {RESET.notSaved.body}
        </InlineAlert>
      ) : wait ? (
        <InlineAlert key={`wait-${attempt}`} blocking tone="warning" title={wait.title}>
          {wait.body}
        </InlineAlert>
      ) : null}
      <Input
        ref={form.fieldRef}
        label={RESET.newPassword}
        variant="password"
        autoComplete="new-password"
        required
        value={form.password}
        onValueChange={form.changePassword}
        readOnly={form.busy}
        errorText={form.fieldError}
      />
      {form.busy || form.unreachable ? null : <p className="m-0 text-body-md text-fg-secondary">{RESET.chooseNote}</p>}
      <div className="flex flex-col gap-2">
        <Button type="submit" size="lg" fullWidth loading={form.busy} disabled={form.waiting}>
          {RESET.save}
        </Button>
        {form.busy ? <p className="m-0 text-body-sm text-fg-secondary">{RESET.savingNote}</p> : null}
      </div>
    </form>
  );
}
