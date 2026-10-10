/**
 * Every redesigned rider route and its params.
 *
 * Work packages add their routes by declaration merging, in their own folder, so no WP edits
 * another's file:
 *
 *   declare module '../nav/routes' {
 *     interface RedesignRoutes { pickup: { assignmentId: string } }
 *   }
 *
 * WP0 owns the roots below: the three tab roots, the full-screen flow roots the gate opens, and
 * the screens the gate itself renders.
 */
import type { ApplicationStep, TerminalKind } from '../session/gate';

export interface RedesignRoutes {
  /** Tab roots (rider decision "Rider navigation": Home, Earnings, Account). */
  home: undefined;
  earnings: undefined;
  account: undefined;
  /** Flow roots the gate opens full screen, BottomNav hidden. */
  trip: { assignmentId: string | null };
  application: { step: ApplicationStep };
  /** Gate screens (no navigator underneath). */
  signIn: { reason?: 'signed-out' };
  splash: { phase: 'loading' | 'slow' | 'error'; retry: () => void };
  suspended: undefined;
  terminal: { kind: TerminalKind };
}

export type RouteName = keyof RedesignRoutes & string;

export type Entry = {
  [K in RouteName]: { key: string; name: K; params: RedesignRoutes[K] };
}[RouteName];

export type ParamsOf<K extends RouteName> = RedesignRoutes[K];

export type Tab = 'home' | 'earnings' | 'account';
export const TABS: readonly Tab[] = ['home', 'earnings', 'account'];
