/**
 * A short-lived private link to a document scan (`createDocumentDownloadUrl`).
 *
 * Documents live in private storage, so the link expires within minutes: when it does the viewer
 * says so and offers a new one, and a link that never came shows a retry. Nothing is cached past
 * its own expiry, and nothing is requested for someone who may not view it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../../data/api';
import { unwrap } from '../../../lib/load';

export type DocumentUrlState =
  | { readonly status: 'idle' | 'loading' | 'failed' }
  | { readonly status: 'ready' | 'expired'; readonly url: string; readonly expiresAt: string };

export function useDocumentUrl(documentId: string | null, enabled: boolean): DocumentUrlState & { reload: () => void } {
  const [state, setState] = useState<DocumentUrlState>({ status: 'idle' });
  const ticket = useRef(0);

  const load = useCallback(async () => {
    if (!documentId || !enabled) {
      setState({ status: 'idle' });
      return;
    }
    const mine = ++ticket.current;
    setState({ status: 'loading' });
    try {
      const body = await unwrap(api.GET('/v1/documents/{documentId}/download-url', { params: { path: { documentId } } }));
      if (mine === ticket.current) setState({ status: 'ready', url: body.data.url, expiresAt: body.data.expires_at });
    } catch {
      if (mine === ticket.current) setState({ status: 'failed' });
    }
  }, [documentId, enabled]);

  useEffect(() => {
    void load();
    return () => {
      ticket.current += 1;
    };
  }, [load]);

  const expiresAt = state.status === 'ready' ? state.expiresAt : null;
  useEffect(() => {
    if (!expiresAt) return;
    const wait = Math.max(0, Date.parse(expiresAt) - Date.now());
    const timer = setTimeout(() => setState((s) => (s.status === 'ready' ? { ...s, status: 'expired' } : s)), wait);
    return () => clearTimeout(timer);
  }, [expiresAt]);

  return { ...state, reload: () => void load() };
}
