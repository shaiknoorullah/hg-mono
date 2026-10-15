/**
 * Your account (`ASS/Account`, `ASS/Account-States`): change your password, and sign out
 * everywhere. Every staff role, and only about yourself.
 *
 * Change password (`changePassword`): a wrong current password is a field error on that field, not
 * a signed-out session (the contract answers 422, never 401, so the shared client does not mistake
 * it for an expired session). A password found in a breach is a field error on the new one. A
 * success re-issues this session (the response is a new session grant) and every other device is
 * signed out. When nothing is known about the outcome (no answer, or a server error) the typed
 * passwords stay so Try again needs no retyping.
 *
 * Sign out everywhere (`logoutAll`): confirm in an in-page panel, then the panel stays open and busy
 * until the server answers. 204 or 401 (this session had already ended) both end here. No answer:
 * the copy never says it worked or failed, and doing it again is harmless.
 *
 * Not drawn, because the contract cannot express it: the person's own name and email (the session
 * carries the role only), and turning two-step sign-in on or off (the boards have no placement).
 */
import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Schema } from '@hg/api-client';

import { finishSignOut } from '../app/signOut';
import { retryAtFrom, useOnline } from '../auth/online';
import { api } from '../data/api';
import { formatTime } from '../data/format';
import { getSession, STAFF_ROLE_LABEL, staffRoleOf, startSession, subscribeSession } from '../data/session';
import { Button, DetailPanel, InlineAlert, Input, useToast } from '../ds';
import { ACCOUNT } from './copy';

type Fields = { current?: string; next?: string };
type Problem = { kind: 'fields' } | { kind: 'failed' } | { kind: 'busy' } | { kind: 'limited'; until: Date };
type SignOutState = 'closed' | 'confirm' | 'working' | 'unknown';

const MIN_LENGTH = 12;

function ChangePassword() {
  const online = useOnline();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [errors, setErrors] = useState<Fields>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const [sending, setSending] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const alertRef = useRef<HTMLDivElement | null>(null);
  const currentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (problem) alertRef.current?.focus();
  }, [problem]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (sending) return;
    const found: Fields = {};
    if (!current) found.current = ACCOUNT.password.missingCurrent;
    if (next.length < MIN_LENGTH) found.next = ACCOUNT.password.tooShort;
    else if (next === current) found.next = ACCOUNT.password.sameAsCurrent;
    if (found.current || found.next) {
      setErrors(found);
      setProblem({ kind: 'fields' });
      return;
    }
    setErrors({});
    setProblem(null);
    setSending(true);
    let result;
    try {
      result = await api.POST('/v1/auth/password/change', { body: { current_password: current, new_password: next } });
    } catch {
      setSending(false);
      setProblem({ kind: 'failed' });
      return;
    }
    setSending(false);
    const { data, error, response } = result;
    if (response.ok && data) {
      const grant: Schema['SessionGrant'] = data.data;
      // This session is re-issued; every other one is already revoked.
      startSession(grant.access_token, grant.principal);
      setCurrent('');
      setNext('');
      toast.show({ variant: 'success', title: ACCOUNT.password.savedTitle, description: ACCOUNT.password.savedBody });
      headingRef.current?.focus();
      return;
    }
    const code = (error as { error?: { code?: string } } | undefined)?.error?.code ?? '';
    if (response.status === 422) {
      if (code === 'INVALID_CREDENTIALS') setErrors({ current: ACCOUNT.password.wrongCurrent });
      else if (code === 'BREACHED_PASSWORD') setErrors({ next: ACCOUNT.password.breached });
      else setErrors({ next: ACCOUNT.password.tooShort });
      setProblem({ kind: 'fields' });
      return;
    }
    if (response.status === 429) return setProblem({ kind: 'limited', until: retryAtFrom(response) });
    if (response.status === 503) return setProblem({ kind: 'busy' });
    setProblem({ kind: 'failed' });
  }

  return (
    <section aria-labelledby="account-password-heading" className="flex max-w-[560px] flex-col gap-3">
      <h2 id="account-password-heading" ref={headingRef} tabIndex={-1} className="m-0 text-heading-sm text-fg-primary outline-none">
        {ACCOUNT.password.heading}
      </h2>
      {problem ? (
        <div ref={alertRef} tabIndex={-1} role="alert" className="outline-none">
          <InlineAlert
            tone="warning"
            title={problem.kind === 'fields' ? ACCOUNT.password.fixTitle : ACCOUNT.password.failedTitle}
          >
            {problem.kind === 'fields'
              ? ACCOUNT.password.fixBody
              : problem.kind === 'busy'
                ? ACCOUNT.password.busy
                : problem.kind === 'limited'
                  ? ACCOUNT.password.limited(formatTime(problem.until))
                  : ACCOUNT.password.failedBody}
          </InlineAlert>
        </div>
      ) : null}
      <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-3">
        <div ref={currentRef}>
          <Input
            label={ACCOUNT.password.current}
            variant="password"
            required
            autoComplete="current-password"
            value={current}
            readOnly={sending}
            errorText={errors.current ?? null}
            onValueChange={(v) => {
              setCurrent(v);
              if (errors.current) setErrors({ ...errors, current: undefined });
            }}
          />
        </div>
        <Input
          label={ACCOUNT.password.next}
          variant="password"
          required
          autoComplete="new-password"
          value={next}
          readOnly={sending}
          helperText={ACCOUNT.password.helper}
          errorText={errors.next ?? null}
          onValueChange={(v) => {
            setNext(v);
            if (errors.next) setErrors({ ...errors, next: undefined });
          }}
        />
        <p className="m-0 text-body-sm text-fg-secondary">{ACCOUNT.password.keepsHere}</p>
        <div>
          <Button type="submit" variant="primary" size="lg" loading={sending} disabled={!online}>
            {ACCOUNT.password.save}
          </Button>
        </div>
        <span role="status" className="sr-only">
          {sending ? ACCOUNT.password.saving : ''}
        </span>
      </form>
    </section>
  );
}

function SignOutEverywhere() {
  const navigate = useNavigate();
  const online = useOnline();
  const opener = useRef<HTMLButtonElement | null>(null);
  const keepRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();
  const [state, setState] = useState<SignOutState>('closed');

  useEffect(() => {
    if (state === 'confirm') keepRef.current?.focus();
  }, [state]);

  async function confirm() {
    if (state === 'working') return;
    setState('working');
    try {
      const res = await api.POST('/v1/auth/logout-all');
      // 204: done. 401: this session had already ended, which is the same place.
      if (res.response.status === 204 || res.response.status === 401) {
        if (res.response.status === 204) {
          navigate('/', { replace: true });
          finishSignOut();
        }
        return;
      }
      setState('unknown');
    } catch {
      setState('unknown');
    }
  }

  const close = () => {
    setState('closed');
    opener.current?.focus();
  };

  return (
    <section aria-labelledby="account-signout-heading" className="flex max-w-[560px] flex-col gap-3">
      <h2 id="account-signout-heading" className="m-0 text-heading-sm text-fg-primary">
        {ACCOUNT.signOut.heading}
      </h2>
      <p className="m-0 text-body-md text-fg-secondary">{ACCOUNT.signOut.body}</p>
      <div>
        <button
          ref={opener}
          type="button"
          aria-expanded={state !== 'closed'}
          aria-controls={panelId}
          disabled={!online}
          onClick={() => setState('confirm')}
          className="hg-focus inline-flex min-h-11 items-center rounded-md border border-line-interactive bg-surface-raised px-4 text-label-lg font-semibold text-fg-primary disabled:opacity-60"
        >
          {ACCOUNT.signOut.open}
        </button>
      </div>
      <p className="m-0 text-body-sm text-fg-secondary">{ACCOUNT.signOut.later}</p>
      <div id={panelId}>
        {state !== 'closed' ? (
          <DetailPanel
            open
            title={ACCOUNT.signOut.panelTitle}
            busy={state === 'working'}
            onClose={state === 'working' ? undefined : close}
            closeLabel={ACCOUNT.signOut.close}
          >
            {state === 'unknown' ? (
              <div role="alert" className="mb-3">
                <InlineAlert tone="warning" title={ACCOUNT.signOut.unknownTitle}>
                  {ACCOUNT.signOut.unknownBody}
                </InlineAlert>
              </div>
            ) : (
              <p className="m-0 text-body-md text-fg-secondary">{ACCOUNT.signOut.panelBody}</p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {state === 'unknown' ? (
                <Button variant="tertiary" onPress={close}>
                  {ACCOUNT.signOut.close}
                </Button>
              ) : (
                <button
                  ref={keepRef}
                  type="button"
                  disabled={state === 'working'}
                  onClick={close}
                  className="hg-focus inline-flex min-h-11 items-center rounded-md px-4 text-label-lg font-semibold text-fg-primary disabled:opacity-60"
                >
                  {ACCOUNT.signOut.keep}
                </button>
              )}
              <Button variant="danger" destructive loading={state === 'working'} onPress={() => void confirm()}>
                {state === 'unknown' ? ACCOUNT.signOut.tryAgain : ACCOUNT.signOut.confirm}
              </Button>
            </div>
            <span role="status" className="sr-only">
              {state === 'working' ? ACCOUNT.signOut.working : ''}
            </span>
          </DetailPanel>
        ) : null}
      </div>
    </section>
  );
}

export default function AccountRoute() {
  const session = useSyncExternalStore(subscribeSession, getSession, getSession);
  const role = staffRoleOf(session.principal);
  const withCode = session.principal?.amr === 'pwd+totp';
  return (
    <section aria-label="Your account page" className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-6">
      <div className="flex max-w-[560px] flex-col gap-1">
        <p className="m-0 text-body-md text-fg-primary">
          {ACCOUNT.signedInAs} <strong className="font-bold">{role ? STAFF_ROLE_LABEL[role] : ''}</strong>
        </p>
        <p className="m-0 text-body-md text-fg-secondary">{ACCOUNT.sessionLength}</p>
        {withCode ? <p className="m-0 text-body-md text-fg-secondary">{ACCOUNT.lostAuthenticator}</p> : null}
      </div>
      <ChangePassword />
      <SignOutEverywhere />
    </section>
  );
}
