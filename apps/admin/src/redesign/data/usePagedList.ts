/**
 * A cursor-paged list that loads its first page on mount, reads further pages on demand, and
 * keeps what it has when a later page fails. The three non-happy states every list screen draws
 * are `load` ('loading' | 'error') and an empty `rows`; `loadMoreFailed` is the quiet fourth.
 *
 * `key` restarts the list (a changed filter): the first page is read again through `loading`, and
 * an answer to an older key is dropped.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface PageOf<Row> {
  rows: Row[];
  cursor: string | null;
  hasMore: boolean;
}

export type PagedLoad = 'loading' | 'ready' | 'error';

export function usePagedList<Row extends { id: string }>(key: string, fetchPage: (key: string, cursor: string | null) => Promise<PageOf<Row>>) {
  const [rows, setRows] = useState<Row[]>([]);
  const [next, setNext] = useState<{ cursor: string | null; hasMore: boolean }>({ cursor: null, hasMore: false });
  const [load, setLoad] = useState<PagedLoad>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++generation.current;
    setLoad('loading');
    setLoadMoreFailed(false);
    try {
      const first = await fetchPage(key, null);
      if (mine !== generation.current) return;
      setRows(first.rows);
      setNext({ cursor: first.cursor, hasMore: first.hasMore });
      setLoad('ready');
    } catch {
      if (mine === generation.current) setLoad('error');
    }
  }, [key, fetchPage]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const loadMore = useCallback(async () => {
    if (!next.cursor || loadingMore) return;
    const mine = generation.current;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const more = await fetchPage(key, next.cursor);
      if (mine !== generation.current) return;
      setRows((cur) => [...cur, ...more.rows.filter((r) => !cur.some((c) => c.id === r.id))]);
      setNext({ cursor: more.cursor, hasMore: more.hasMore });
    } catch {
      if (mine === generation.current) setLoadMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }, [key, fetchPage, next.cursor, loadingMore]);

  return { rows, setRows, load, hasMore: next.hasMore, loadingMore, loadMoreFailed, reload, loadMore };
}
