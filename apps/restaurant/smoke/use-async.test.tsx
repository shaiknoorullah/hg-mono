import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { HgApiError } from '@hg/api-client';

import { useAsync } from '../src/lib/useAsync';

/**
 * `useAsync` is every screen's loading/error/ready source (AGENTS.md §6: every screen implements
 * empty, loading and error). Pins its four behaviours: a server error shows the server's own
 * message, anything else shows the connection message, `reload` refetches, and a result that
 * arrives after its request was superseded is dropped instead of overwriting a newer one.
 */

/** A promise the test settles by hand, to control which request finishes first. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useAsync', () => {
  afterEach(cleanup);

  it('starts loading, then holds the data', async () => {
    const { result } = renderHook(() => useAsync(() => Promise.resolve(['a', 'b'])));

    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.data).toEqual(['a', 'b']);
    expect(result.current.error).toBeNull();
  });

  it("shows the server's message for an API error and a connection message for anything else", async () => {
    const apiError = new HgApiError(409, { error: { code: 'STEP_NOT_AVAILABLE', message: 'Not approved yet.', request_id: 'r-1' } } as never);
    const api = renderHook(() => useAsync(() => Promise.reject(apiError)));
    await waitFor(() => expect(api.result.current.status).toBe('error'));
    expect(api.result.current.error).toBe('Not approved yet.');
    expect(api.result.current.data).toBeNull();

    const offline = renderHook(() => useAsync(() => Promise.reject(new TypeError('Failed to fetch'))));
    await waitFor(() => expect(offline.result.current.status).toBe('error'));
    expect(offline.result.current.error).toBe('Could not reach the server. Check your connection and try again.');
  });

  it('reload refetches and recovers from an error', async () => {
    let calls = 0;
    const { result } = renderHook(() =>
      useAsync(() => (++calls === 1 ? Promise.reject(new Error('down')) : Promise.resolve(calls))),
    );
    await waitFor(() => expect(result.current.status).toBe('error'));

    act(() => result.current.reload());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.data).toBe(2);
    expect(result.current.error).toBeNull();
  });

  it('drops a stale result once a newer request has started', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const queue = [first, second];
    const { result, rerender } = renderHook(({ id }) => useAsync(() => queue.shift()!.promise, [id]), {
      initialProps: { id: 1 },
    });

    // The deps change while the first request is in flight: the second one supersedes it.
    rerender({ id: 2 });
    await act(async () => {
      second.resolve('fresh');
      await second.promise;
    });
    expect(result.current.data).toBe('fresh');

    // The first request finishing late must not overwrite the newer result.
    await act(async () => {
      first.resolve('stale');
      await first.promise;
    });
    expect(result.current.data).toBe('fresh');
  });

  it('ignores a failure that lands after the component unmounted', async () => {
    const pending = deferred<string>();
    const { result, unmount } = renderHook(() => useAsync(() => pending.promise));
    unmount();

    await act(async () => {
      pending.reject(new Error('late'));
      await pending.promise.catch(() => undefined);
    });
    // Still the last state rendered before unmount: no update was applied to a dead component.
    expect(result.current.status).toBe('loading');
    expect(result.current.error).toBeNull();
  });
});
