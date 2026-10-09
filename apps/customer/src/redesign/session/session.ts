/**
 * Where the customer is between "signed out" and "using the app" (ported from #635
 * `signin/session.ts`, adapted to the redesign routes).
 *
 * The token holder (`src/api/token.ts`) only knows signed in or out. The Sign-in canvas puts steps
 * between the code and Home ("Your details", then the address step), and `verifyOtp.next_route`
 * decides the landing. This store holds that phase, the landing route, the one toast that greets
 * the customer ("Welcome back", "Address saved") and the note the signed-out screen shows.
 *
 * Clearing the token from anywhere (sign-out, a failed refresh) drops the phase back to `signin`,
 * so a protected screen never outlives its session. A token that appears while no sign-in screen
 * is driving the phase (the legacy sign-in fallback) enters the app on Home.
 */
import * as React from 'react';

import { isAuthed, subscribe as subscribeToken } from '../../api/token';
import type { Route, TabKey } from '../navigation/routes';

/**
 * `signin`: no session. `verifying`: a code is being checked and the sign-in screen will route
 * the result itself. `profile`: signed in without a name ("Your details"). `app`: tabs.
 */
export type SessionPhase = 'signin' | 'verifying' | 'profile' | 'app';

export type SignedOutNote = 'signedOut' | 'notYou';

export interface Welcome {
  variant: 'neutral' | 'success';
  title: string;
  description?: string;
}

export interface SessionState {
  phase: SessionPhase;
  landing: Route;
  /**
   * The tab whose stack the landing opens on, when not its own. Signing in with an order on the
   * way lands on tracking above Home, so Back goes to Home (`SI/SignedIn-tracking`).
   */
  landingTab: TabKey | null;
  welcome: Welcome | null;
  signedOut: SignedOutNote | null;
}

const HOME: Route = { name: 'home' };

function initial(): SessionState {
  return { phase: isAuthed() ? 'app' : 'signin', landing: HOME, landingTab: null, welcome: null, signedOut: null };
}

let state: SessionState = initial();
const listeners = new Set<() => void>();

function set(next: Partial<SessionState>): void {
  state = { ...state, ...next };
  for (const fn of listeners) fn();
}

subscribeToken(() => {
  if (!isAuthed()) {
    if (state.phase !== 'signin') set({ phase: 'signin', landing: HOME, landingTab: null, welcome: null });
  } else if (state.phase === 'signin') {
    set({ phase: 'app', landing: HOME, landingTab: null });
  }
});

export function getSession(): SessionState {
  return state;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSession(): SessionState {
  return React.useSyncExternalStore(subscribe, getSession, getSession);
}

/** Called just before `verifyOtp`: the sign-in screen routes the result, not the token listener. */
export function beginVerify(): void {
  set({ phase: 'verifying' });
}

/** The code was refused or the call failed: back to the sign-in flow, session untouched. */
export function cancelVerify(): void {
  if (state.phase === 'verifying') set({ phase: isAuthed() ? 'app' : 'signin' });
}

/** Into the tabs on `landing` (`next_route` HOME or ORDER_TRACKING). */
export function enterApp(landing: Route = HOME, welcome: Welcome | null = null, landingTab: TabKey | null = null): void {
  set({ phase: 'app', landing, landingTab, welcome, signedOut: null });
}

/** Signed in with no name yet: "Your details" first. */
export function enterProfileCapture(): void {
  set({ phase: 'profile', signedOut: null });
}

/** Details saved: the address step when there is no default address, else Home. */
export function finishProfileCapture(hasDefaultAddress: boolean): void {
  set({ phase: 'app', landing: hasDefaultAddress ? HOME : { name: 'addressStep' }, landingTab: null, welcome: null });
}

export function noteSignedOut(note: SignedOutNote): void {
  set({ signedOut: note });
}

export function clearSignedOutNote(): void {
  if (state.signedOut) set({ signedOut: null });
}

export function showWelcome(welcome: Welcome): void {
  set({ welcome });
}

export function clearWelcome(): void {
  if (state.welcome) set({ welcome: null });
}

/** Tests only: back to a cold start. */
export function resetSessionForTests(): void {
  state = initial();
  for (const fn of listeners) fn();
}
