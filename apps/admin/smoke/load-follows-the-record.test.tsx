import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useLoad } from '../src/lib/load';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('useLoad', () => {
  it('loads again when the screen moves to another record', async () => {
    const fetchers = { a: async () => 'certificate A', b: async () => 'certificate B' };
    const { result, rerender } = renderHook(({ f }) => useLoad(f), { initialProps: { f: fetchers.a } });
    await waitFor(() => expect(result.current.data).toBe('certificate A'));

    rerender({ f: fetchers.b });
    await waitFor(() => expect(result.current.data).toBe('certificate B'));

    // reload() fetches the record now on screen, not the first one.
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data).toBe('certificate B'));
  });

  it('never lets a slower answer for the record it left overwrite the current one', async () => {
    const slowA = deferred<string>();
    const fetchA = () => slowA.promise;
    const fetchB = async () => 'certificate B';
    const { result, rerender } = renderHook(({ f }) => useLoad(f), { initialProps: { f: fetchA } });

    rerender({ f: fetchB });
    await waitFor(() => expect(result.current.data).toBe('certificate B'));

    await act(async () => {
      slowA.resolve('certificate A');
      await slowA.promise;
    });
    expect(result.current.data).toBe('certificate B');
  });
});
