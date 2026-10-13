/**
 * The state behind the pages our emails link to (issue #329), shared by the restaurant app and
 * the admin console. Each app keeps its own screens and copy; these hooks hold what the screens
 * do alike: the captured token, a 429's wait, asking for a link by email, and setting a
 * password from a link.
 */
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';

import { PASSWORD_MIN, passwordTooLong, type LinkOutcome } from './calls.js';
import { linkTokenFor } from './linkToken.js';

/**
 * The token this page's email link carried, captured at boot (`linkToken.ts`). An email link
 * is a real path with a real query (`/reset-password?token=…`), so the capture reads
 * `window.location`, not the app's router.
 */
export function useLinkToken(path: string): string | null {
  const [token] = useState<string | null>(() => linkTokenFor(path));
  return token;
}

/** A 429's wait, from `useRetryWindow`. */
export interface RetryWindow {
  /** When the server allows another try; `null` when there is nothing to wait for. */
  until: Date | null;
  /** Starts a wait until `at`. */
  start: (at: Date) => void;
}

/**
 * A 429's wait: `until` is the time the server allows another try, and clears itself then,
 * so the disabled button comes back without a reload. The page names the time once (a
 * 12-hour clock time), rather than counting down every second.
 */
export function useRetryWindow(): RetryWindow {
  const [until, setUntil] = useState<Date | null>(null);
  useEffect(() => {
    if (!until) return;
    const timer = setTimeout(() => setUntil(null), Math.max(0, until.getTime() - Date.now()));
    return () => clearTimeout(timer);
  }, [until]);
  return { until, start: setUntil };
}

/** The state of a form that asks for a link by email, from `useRequestLinkForm`. */
export interface RequestLinkForm {
  email: string;
  setEmail: (email: string) => void;
  busy: boolean;
  /** The address a link was asked for; `null` until the request succeeds. */
  sentTo: string | null;
  /** Back to the form from "Check your email". */
  startOver: () => void;
  /** Why the last request failed, apart from a 429 (see `wait`). */
  problem: 'unreachable' | 'invalid-email' | null;
  wait: RetryWindow;
  /** A 429's wait is running: the send button is disabled. */
  waiting: boolean;
  /** The page's problem banner: focused when a problem or a wait appears. */
  bannerRef: RefObject<HTMLDivElement | null>;
  /** Sends the trimmed address through `request`; usable as a form's `onSubmit`. */
  send: (e?: FormEvent) => Promise<void>;
}

/**
 * A form that asks for a link by email: `requestPasswordReset` on the reset pages,
 * `resendEmailVerification` on the restaurant's expired-link page. Those calls answer the same
 * whether or not the account exists, so success always shows "Check your email".
 */
export function useRequestLinkForm(request: (email: string) => Promise<LinkOutcome>): RequestLinkForm {
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
    const outcome = await request(email.trim());
    setBusy(false);
    if (outcome.ok) {
      setSentTo(email.trim());
      return;
    }
    if (outcome.kind === 'rate-limited') wait.start(outcome.retryAt);
    else setProblem(outcome.kind === 'invalid-email' ? 'invalid-email' : 'unreachable');
  }

  return {
    email,
    setEmail,
    busy,
    sentTo,
    startOver: () => setSentTo(null),
    problem,
    wait,
    waiting: wait.until !== null,
    bannerRef,
    send,
  };
}

/** What `useSetPasswordForm` needs from the page. */
export interface SetPasswordFormOptions {
  /** The link's token, already checked with `isWellFormedToken`. */
  token: string;
  /** The app's `resetPassword` call. */
  reset: (token: string, newPassword: string) => Promise<LinkOutcome>;
  /** The field error for a password on the breached-password list, in the app's words. */
  breachedMessage: string;
  /** The link expired, was used or was never valid. */
  onInvalid: () => void;
  /** The password is set. No session follows: the person signs in again. */
  onDone: () => void;
}

/** The state of a set-password form, from `useSetPasswordForm`. */
export interface SetPasswordForm {
  password: string;
  /** Sets the password and clears a field error, so the error goes as the person types. */
  changePassword: (password: string) => void;
  busy: boolean;
  /** The password field's error, or `null`. */
  fieldError: string | null;
  /** HalalGoes could not be reached; what was typed is kept and the link is unused. */
  unreachable: boolean;
  wait: RetryWindow;
  /** A 429's wait is running: the submit button is disabled. */
  waiting: boolean;
  /** The password field: focused when a field error appears. */
  fieldRef: RefObject<HTMLInputElement | null>;
  /** The page's problem banner: focused when "unreachable" or a wait appears. */
  bannerRef: RefObject<HTMLDivElement | null>;
  /** Checks the length, then sends the password with the token; usable as `onSubmit`. */
  save: (e: FormEvent) => Promise<void>;
}

/**
 * One password, sent with the link's token through `resetPassword`. The length is checked
 * here first (12 characters to 256 bytes), so a short password never uses the link.
 */
export function useSetPasswordForm({
  token,
  reset,
  breachedMessage,
  onInvalid,
  onDone,
}: SetPasswordFormOptions): SetPasswordForm {
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
    const outcome = await reset(token, password);
    setBusy(false);
    if (outcome.ok) {
      onDone();
      return;
    }
    switch (outcome.kind) {
      case 'breached':
        setFieldError(breachedMessage);
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

  return {
    password,
    changePassword: (next) => {
      setPassword(next);
      if (fieldError) setFieldError(null);
    },
    busy,
    fieldError,
    unreachable,
    wait,
    waiting: wait.until !== null,
    fieldRef,
    bannerRef,
    save,
  };
}
