import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { HgApiError, idempotencyKey, isApiError, type Schema } from '@hg/api-client';
import { api, getSession, setSession } from './api';
import { unwrapOrThrow } from './apiHelpers';

export type Principal = Schema['SessionGrant']['principal'];

/**
 * `X-HG-Client` (contract's `ClientHeader`) is a required per-request parameter on the
 * unauthenticated auth endpoints, distinct from the `X-Client-Surface` header the shared
 * client middleware sets from `clientSurface` — see `docs/decisions/README.md` for why
 * both exist. Every PUBLIC auth call in this file must pass it explicitly.
 */
const CLIENT_HEADER = { 'X-HG-Client': 'restaurant-web' as const };

interface AuthState {
  status: 'unknown' | 'signed-out' | 'signed-in';
  principal: Principal | null;
}

interface LoginResult {
  ok: boolean;
  mfaRequired?: boolean;
  error?: string;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string, totpCode?: string) => Promise<LoginResult>;
  register: (input: { email: string; password: string; businessName: string }) => Promise<LoginResult>;
  logout: () => Promise<void>;
  /**
   * Holds the session a public auth call issued (`verifyEmail`), or forgets the local one
   * after `resetPassword` has revoked every session server-side.
   */
  adoptSession: (grant: Schema['SessionGrant'] | null) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const existing = getSession();
  const [state, setState] = useState<AuthState>({
    status: existing ? 'signed-in' : 'signed-out',
    principal: null,
  });

  const login = useCallback(async (email: string, password: string, totpCode?: string): Promise<LoginResult> => {
    try {
      const data = await unwrapOrThrow(
        api.POST('/v1/auth/login', {
          params: { header: CLIENT_HEADER },
          body: { email, password, totp_code: totpCode ?? null },
        }),
      );
      setSession({ accessToken: data.access_token, accountId: data.principal.account_id });
      setState({ status: 'signed-in', principal: data.principal });
      return { ok: true };
    } catch (e) {
      if (isApiError(e)) {
        if (e.is('MFA_REQUIRED') || e.status === 403) return { ok: false, mfaRequired: true };
        return { ok: false, error: e.message };
      }
      return { ok: false, error: 'Could not reach the server. Check your connection and try again.' };
    }
  }, []);

  const register = useCallback(
    async (input: { email: string; password: string; businessName: string }): Promise<LoginResult> => {
      try {
        await unwrapOrThrow(
          api.POST('/v1/auth/register/restaurant', {
            params: { header: { 'Idempotency-Key': idempotencyKey(), ...CLIENT_HEADER } },
            body: {
              email: input.email,
              password: input.password,
              business_name: input.businessName,
              terms_version: '2026-01-01',
            },
          }),
        );
        return { ok: true };
      } catch (e) {
        if (isApiError(e)) return { ok: false, error: e.message };
        return { ok: false, error: 'Could not reach the server. Check your connection and try again.' };
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await api.POST('/v1/auth/logout', {});
    } catch {
      // best-effort — the session is cleared locally regardless.
    }
    setSession(null);
    setState({ status: 'signed-out', principal: null });
  }, []);

  const adoptSession = useCallback((grant: Schema['SessionGrant'] | null) => {
    if (!grant) {
      setSession(null);
      setState({ status: 'signed-out', principal: null });
      return;
    }
    setSession({ accessToken: grant.access_token, accountId: grant.principal.account_id });
    setState({ status: 'signed-in', principal: grant.principal });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, register, logout, adoptSession }),
    [state, login, register, logout, adoptSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export function isSignedIn(): boolean {
  return getSession() !== null;
}

export { HgApiError };
