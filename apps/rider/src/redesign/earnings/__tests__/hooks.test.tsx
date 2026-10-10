/**
 * The Earnings tab's two stateful helpers, pinned where a screen test cannot reach the timing:
 * the 429 wait restarts on every new 429, and an older page that was in flight when the first
 * page changed is dropped (never appended after the wrong cursor), with one fetch per tap.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { RiderError } from '../../data/errors';
import { RATE_LIMIT_WAIT_MS, useCooldown, usePagedList, type Page } from '../api';
import { zeroLine } from '../format';

const limited = (): RiderError => ({
  kind: 'api',
  code: 'RATE_LIMITED',
  status: 429,
  title: '',
  message: '',
  retryable: true,
  support: false,
  details: null,
});

describe('useCooldown', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('holds Try again for the wait, and again after a retry that is limited again', () => {
    const first = limited();
    const { result, rerender } = renderHook(({ e }: { e: RiderError | null }) => useCooldown(e), { initialProps: { e: first } });
    expect(result.current).toBe(true);
    act(() => jest.advanceTimersByTime(RATE_LIMIT_WAIT_MS));
    expect(result.current).toBe(false);
    rerender({ e: first });
    expect(result.current).toBe(false);
    rerender({ e: limited() });
    expect(result.current).toBe(true);
    rerender({ e: null });
    expect(result.current).toBe(false);
  });
});

describe('usePagedList', () => {
  const row = (id: string) => ({ id });
  type Row = ReturnType<typeof row>;

  it('one fetch per tap, and an older page that lands after the first page changed is dropped', async () => {
    let now = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => (now += 1));
    let resolveOlder: (p: Page<Row>) => void = () => undefined;
    let firstCalls = 0;
    const fetchPage = jest.fn((cursor?: string): Promise<Page<Row>> => {
      if (cursor) return new Promise((r) => (resolveOlder = r));
      firstCalls += 1;
      return Promise.resolve({ data: [row(`new-${firstCalls}`)], meta: { next_cursor: 'c2', has_more: true } });
    });
    const { result } = renderHook(() => usePagedList<Row>('hooks-test', fetchPage));
    await waitFor(() => expect(result.current.rows.map((r) => r.id)).toEqual(['new-1']));

    act(() => {
      void result.current.loadMore();
      void result.current.loadMore();
    });
    expect(fetchPage.mock.calls.filter(([c]) => c === 'c2')).toHaveLength(1);

    // The first page refetches (foreground, back online) while the older page is in flight.
    await act(async () => {
      await result.current.first.refetch();
    });
    await waitFor(() => expect(result.current.rows.map((r) => r.id)).toEqual(['new-2']));
    await act(async () => {
      resolveOlder({ data: [row('stale-older')], meta: { next_cursor: null, has_more: false } });
    });
    expect(result.current.rows.map((r) => r.id)).toEqual(['new-2']);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.loadingMore).toBe(false);
    jest.restoreAllMocks();
  });
});

describe('zeroLine', () => {
  it('names older periods by date without lowercasing day or month names', () => {
    expect(zeroLine('WEEK', -1)).toBe('No deliveries last week.');
    expect(zeroLine('MONTH', -3)).toMatch(/^No deliveries in [A-Z][a-z]+ \d{4}\.$/);
    expect(zeroLine('DAY', -5)).toMatch(/^No deliveries on [A-Z][a-z]+day \d+ [A-Z][a-z]+\.$/);
  });
});
