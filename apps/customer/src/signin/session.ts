/**
 * Where the customer is between "signed out" and "using the app".
 *
 * The token holder (`api/token.ts`) only knows signed in or out. A new customer is signed in
 * before they have a name, though, and the Sign-in canvas puts two steps between the code and
 * Home: "Your details" (profile capture, when `verifyOtp` says `next_route = PROFILE_CAPTURE` or
 * the profile has no first name) and, after saving, "Where should we deliver?" when there is no
 * default address. This store holds that phase, the route the app opens on, the one toast that
 * greets the customer, and the neutral note the sign-in screen shows after a sign-out.
 *
 * Clearing the token from anywhere (sign-out, a failed refresh) drops the phase back to
 * `signin`, so a protected screen can never outlive its session.
 */
import * as React from 'react';

import { isAuthed, subscribe as subscribeToken } from '../api/token';
import type { Route } from '../navigation/stack';

export type SessionPhase = 'signin' | 'profile' | 'app';

/** Why the sign-in screen is showing after a session ended (its neutral banner). */
export type SignedOutNote = 'signedOut' | 'notYou';

export interface Welcome {
  variant: 'neutral' | 'success';
  title: string;
  description?: string;
}

interface SessionState {
  phase: SessionPhase;
  /** The route the app opens on once `phase` is `app`. */
  landing: Route;
  welcome: Welcome | null;
  signedOut: SignedOutNote | null;
}

const INITIAL: SessionState = {
  phase: 'signin',
  landing: { name: 'discovery' },
  welcome: null,
  signedOut: null,
};

let state: SessionState = INITIAL;
const listeners = new Set<() => void>();

function set(next: Partial<SessionState>): void {
  state = { ...state, ...next };
  for (const fn of listeners) fn();
}

subscribeToken(() => {
  if (!isAuthed() && state.phase !== 'signin') {
    set({ phase: 'signin', landing: INITIAL.landing, welcome: null });
  }
});

export function getSession(): SessionState {
  return state;
}

export function subscribeSession(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSession(): SessionState {
  return React.useSyncExternalStore(subscribeSession, getSession, getSession);
}

/** Straight into the app after the code (`next_route` HOME or ORDER_TRACKING). */
export function enterApp(landing: Route, welcome: Welcome | null): void {
  set({ phase: 'app', landing, welcome, signedOut: null });
}

/** The code was right but the customer has no name yet: "Your details" comes first. */
export function enterProfileCapture(): void {
  set({ phase: 'profile', signedOut: null });
}

/**
 * Details saved. With no default address the address step comes next (shown only then); with
 * one, Home.
 */
export function finishProfileCapture(hasDefaultAddress: boolean): void {
  set({
    phase: 'app',
    landing: hasDefaultAddress ? { name: 'discovery' } : { name: 'welcomeAddress' },
    welcome: null,
  });
}

/** Remember why the sign-in screen is about to show; the token clear does the rest. */
export function noteSignedOut(note: SignedOutNote): void {
  set({ signedOut: note });
}

export function clearSignedOutNote(): void {
  if (state.signedOut) set({ signedOut: null });
}

/** One confirmation toast over whatever screen is open, e.g. "Address saved". */
export function showWelcome(welcome: Welcome): void {
  set({ welcome });
}

export function clearWelcome(): void {
  if (state.welcome) set({ welcome: null });
}

/** Tests only: back to a cold start. */
export function resetSessionForTests(): void {
  state = INITIAL;
  for (const fn of listeners) fn();
}
