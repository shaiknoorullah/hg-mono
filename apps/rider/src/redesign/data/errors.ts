/**
 * Error → what the rider reads. Branches on `error.code` from the contract, never on the
 * message (rider spec §0.1). Screens that own a board-specific state (wrong code, offer taken,
 * blocking reasons) handle that code themselves first; this is the shared fallback and the
 * classifier every screen's error branch starts from.
 *
 * Copy follows the rider boards' voice: say what happened, then what to do, no blame. Field
 * errors are not halal states, so `danger` is allowed for them; nothing here colours a halal
 * state.
 */
import { HgApiError, HgTransportError, type ErrorCode } from '@hg/api-client';

export type ErrorKind =
  /** The request never reached us: no signal, airplane mode, DNS. */
  | 'offline'
  /** The session is over (refresh failed, revoked). The gate shows sign-in. */
  | 'signed-out'
  /** We answered with a code. */
  | 'api'
  /** A bug or a body we could not read. */
  | 'unknown';

export interface RiderError {
  kind: ErrorKind;
  /** The contract code, when there is one. */
  code: ErrorCode | string | null;
  status: number | null;
  title: string;
  message: string;
  /** Whether "Try again" is honest. A 409 that will 409 again does not offer it. */
  retryable: boolean;
  /** Point the rider at support instead of a button that cannot help. */
  support: boolean;
  /** `details` from the envelope, untyped: each screen reads the keys its board needs. */
  details: unknown;
}

interface Copy {
  title: string;
  message: string;
  retryable: boolean;
  support?: boolean;
}

export const OFFLINE: Copy = {
  title: 'No connection',
  message: "We can't reach HalalGoes. Check your signal. Nothing you did is lost.",
  retryable: true,
};

export const GENERIC: Copy = {
  title: 'Something went wrong on our side',
  message: "It's not something you did. Try again in a moment.",
  retryable: true,
  support: true,
};

/** Shared copy for codes any rider screen can meet. Screen-specific states live with the screen. */
export const RIDER_ERROR_COPY: Partial<Record<ErrorCode, Copy>> = {
  TIMEOUT: { title: 'That took too long', message: 'Nothing was changed. Try again.', retryable: true },
  INTERNAL_ERROR: GENERIC,
  RATE_LIMITED: {
    title: 'Too many tries',
    message: 'Wait a minute, then try again.',
    retryable: true,
  },
  RATE_LIMITER_UNAVAILABLE: GENERIC,
  FORBIDDEN: {
    title: "You can't do that from this account",
    message: 'If you think this is wrong, call support.',
    retryable: false,
    support: true,
  },
  PERMISSION_DENIED: {
    title: "You can't do that from this account",
    message: 'If you think this is wrong, call support.',
    retryable: false,
    support: true,
  },
  NOT_FOUND: {
    title: "We can't find that",
    message: 'It may have been moved or closed. Go back and try again.',
    retryable: false,
  },
  ACCOUNT_SUSPENDED: {
    title: 'Your account is paused',
    message: 'You can finish a delivery you already have. Call support to find out more.',
    retryable: false,
    support: true,
  },
  ACCOUNT_DEACTIVATED: {
    title: 'This rider account is closed',
    message: 'Call support if you think this is wrong.',
    retryable: false,
    support: true,
  },
  ACCOUNT_NOT_ACTIVE: {
    title: 'This rider account is closed',
    message: 'Call support if you think this is wrong.',
    retryable: false,
    support: true,
  },
  ACCOUNT_BANNED: {
    title: 'This rider account is closed',
    message: 'Call support if you think this is wrong.',
    retryable: false,
    support: true,
  },
  ILLEGAL_TRANSITION: {
    title: 'This delivery has moved on',
    message: "We've refreshed it. Check the step on screen.",
    retryable: false,
  },
  INVALID_TRANSITION: {
    title: 'This delivery has moved on',
    message: "We've refreshed it. Check the step on screen.",
    retryable: false,
  },
  IDEMPOTENCY_IN_PROGRESS: {
    title: 'Still sending',
    message: 'We are still working on your last tap. Wait a moment.',
    retryable: true,
  },
  STEP_NOT_AVAILABLE: {
    title: "This step isn't open yet",
    message: 'Go back and finish the step before it.',
    retryable: false,
  },
};

const SIGNED_OUT_CODES = new Set<string>([
  'AUTHENTICATION_REQUIRED',
  'SESSION_REVOKED',
  'SESSION_EXPIRED',
  'REFRESH_REUSE_DETECTED',
]);

function fromCopy(kind: ErrorKind, code: string | null, status: number | null, copy: Copy, details: unknown): RiderError {
  return {
    kind,
    code,
    status,
    title: copy.title,
    message: copy.message,
    retryable: copy.retryable,
    support: copy.support ?? false,
    details,
  };
}

/** Anything a request can throw → a `RiderError`. */
export function toRiderError(e: unknown): RiderError {
  if (e instanceof HgTransportError || e instanceof TypeError) {
    return fromCopy('offline', null, null, OFFLINE, undefined);
  }
  if (e instanceof HgApiError) {
    const code = String(e.code);
    if (e.status === 401 || SIGNED_OUT_CODES.has(code)) {
      return fromCopy('signed-out', code, e.status, { ...GENERIC, title: 'Signed out', message: 'Sign in again to carry on.', retryable: false }, e.details);
    }
    const copy = RIDER_ERROR_COPY[code as ErrorCode] ?? (e.status >= 500 ? GENERIC : { ...GENERIC, retryable: false });
    return fromCopy('api', code, e.status, copy, e.details);
  }
  return fromCopy('unknown', null, null, GENERIC, undefined);
}

/** The contract code of a thrown API error, or `null`. */
export function codeOf(e: unknown): string | null {
  return e instanceof HgApiError ? String(e.code) : null;
}
