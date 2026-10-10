/**
 * Sending a change safely.
 *
 * Every POST/PUT the contract gives an `Idempotency-Key` reuses the same key on a retry after a
 * timeout, a 5xx or going offline, so pressing twice or retrying still makes one change. A new
 * key is minted only when the person changes what they are sending (`reset`). The outcome of a
 * timeout is unknown, and the screens say so.
 */
import { useCallback, useRef, useState } from 'react';
import { HgApiError, isApiError } from '@hg/api-client';

import { newIdempotencyKey } from '../../lib/idempotency';

export type MutationOutcome<T> =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sending' }
  | { readonly kind: 'done'; readonly data: T }
  /** A definite refusal (4xx): nothing changed. */
  | { readonly kind: 'refused'; readonly error: HgApiError }
  /** Timeout, 5xx or offline: the change may or may not have happened. Retry reuses the key. */
  | { readonly kind: 'unknown'; readonly error: unknown };

export interface Mutation<A, T> {
  readonly outcome: MutationOutcome<T>;
  readonly sending: boolean;
  /** Sends with the current key. */
  readonly send: (args: A) => Promise<MutationOutcome<T>>;
  /** Forgets the outcome and mints a new key: call when the input changes. */
  readonly reset: () => void;
  /** The key the next send will carry (for tests and for the "same request" copy). */
  readonly key: () => string;
}

/** True for an outcome the server definitely refused (4xx other than 408/429). */
export function isDefiniteRefusal(err: unknown): err is HgApiError {
  return isApiError(err) && err.status >= 400 && err.status < 500 && err.status !== 408;
}

export function useMutation<A, T>(run: (args: A, idempotencyKey: string) => Promise<T>): Mutation<A, T> {
  const keyRef = useRef<string>(newIdempotencyKey());
  const [outcome, setOutcome] = useState<MutationOutcome<T>>({ kind: 'idle' });
  const inFlight = useRef(false);

  const send = useCallback(
    async (args: A): Promise<MutationOutcome<T>> => {
      if (inFlight.current) return { kind: 'sending' };
      inFlight.current = true;
      setOutcome({ kind: 'sending' });
      let next: MutationOutcome<T>;
      try {
        next = { kind: 'done', data: await run(args, keyRef.current) };
        keyRef.current = newIdempotencyKey();
      } catch (err) {
        next = isDefiniteRefusal(err) ? { kind: 'refused', error: err } : { kind: 'unknown', error: err };
      } finally {
        inFlight.current = false;
      }
      setOutcome(next);
      return next;
    },
    [run],
  );

  const reset = useCallback(() => {
    keyRef.current = newIdempotencyKey();
    setOutcome({ kind: 'idle' });
  }, []);

  return { outcome, sending: outcome.kind === 'sending', send, reset, key: () => keyRef.current };
}
