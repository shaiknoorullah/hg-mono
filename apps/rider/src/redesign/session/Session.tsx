/**
 * The signed-in session: `getRiderMe`, the gate decision from it, and what renders for it.
 *
 * - Signed out → `signIn` (with `reason: 'signed-out'` when the session ended without the
 *   rider asking).
 * - Loading `getRiderMe` → `splash` ("slow" after 10 s); a failure → `splash` error with retry.
 * - tabs / trip / application → the navigator and shell; trip and application open as the flow.
 * - suspended, terminal → their own screen, no navigator.
 *
 * `getRiderMe` is re-read on foreground and whenever a screen calls `refresh()` (an approval, a
 * delivery ending). A new decision that needs a flow opens it; returning to tabs is the flow's own
 * job (it closes itself), so a stale read never yanks a rider out of a step.
 */
import * as React from 'react';
import { unwrap } from '@hg/api-client';

import { isAuthed, subscribe } from '../../token';
import { rider } from '../data/client';
import { outbox } from '../data/outbox';
import { useApiQuery } from '../data/query';
import { Navigator, useNav } from '../nav/Navigator';
import { ScreenView, Shell } from '../nav/Shell';
import { decide, decideFromError, type GateDecision, type RiderMe } from './gate';
import { consumeVoluntarySignOut } from './signOut';

export interface SessionValue {
  me: RiderMe;
  decision: GateDecision;
  refresh: () => Promise<void>;
}

const SessionContext = React.createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const s = React.useContext(SessionContext);
  if (!s) throw new Error('useSession must be used inside a signed-in session');
  return s;
}

/** The session when one is open, else `null` (a screen rendered alone in a test, or by the gate). */
export function useOptionalSession(): SessionValue | null {
  return React.useContext(SessionContext);
}

export const SLOW_MS = 10_000;

export async function fetchRiderMe(): Promise<RiderMe> {
  const body = await unwrap(rider.GET('/v1/riders/me'));
  return (body as { data: RiderMe }).data;
}

function key(entry: { name: string }, params?: unknown): { key: string; name: never; params: never } {
  return { key: `gate-${entry.name}`, name: entry.name as never, params: params as never };
}

export function SessionGate(): React.ReactElement {
  const authed = React.useSyncExternalStore(subscribe, isAuthed, isAuthed);
  const [endedUnderRider, setEndedUnderRider] = React.useState(false);
  const wasAuthed = React.useRef(authed);

  React.useEffect(() => {
    if (wasAuthed.current && !authed) setEndedUnderRider(!consumeVoluntarySignOut());
    if (authed) {
      setEndedUnderRider(false);
      void outbox.drain(); // steps queued before a sign-out resume with the new session
    }
    wasAuthed.current = authed;
  }, [authed]);

  if (!authed) {
    return <ScreenView entry={key({ name: 'signIn' }, endedUnderRider ? { reason: 'signed-out' } : {})} />;
  }
  return <SignedIn />;
}

function SignedIn(): React.ReactElement {
  const me = useApiQuery('rider-me', fetchRiderMe);
  const [slow, setSlow] = React.useState(false);

  React.useEffect(() => {
    if (me.status !== 'loading') return;
    const id = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(id);
  }, [me.status]);

  const retry = React.useCallback(() => {
    setSlow(false);
    void me.refetch();
  }, [me]);

  if (me.status === 'loading') {
    return <ScreenView entry={key({ name: 'splash' }, { phase: slow ? 'slow' : 'loading', retry })} />;
  }
  if (me.status === 'error' || !me.data) {
    const answer = decideFromError(me.error);
    if (answer?.mode === 'terminal') return <ScreenView entry={key({ name: 'terminal' }, { kind: answer.kind })} />;
    return <ScreenView entry={key({ name: 'splash' }, { phase: 'error', retry })} />;
  }

  const decision = decide(me.data);
  const value: SessionValue = { me: me.data, decision, refresh: me.refetch };
  return (
    <SessionContext.Provider value={value}>
      <Routed decision={decision} />
    </SessionContext.Provider>
  );
}

function Routed({ decision }: { decision: GateDecision }): React.ReactElement {
  switch (decision.mode) {
    case 'suspended':
      return <ScreenView entry={key({ name: 'suspended' })} />;
    case 'terminal':
      return <ScreenView entry={key({ name: 'terminal' }, { kind: decision.kind })} />;
    default:
      return (
        <Navigator initialFlow={flowFor(decision)}>
          <FlowFollower decision={decision} />
          <Shell />
        </Navigator>
      );
  }
}

function flowFor(decision: GateDecision): { name: 'trip' | 'application'; params: unknown } | null {
  if (decision.mode === 'trip') return { name: 'trip', params: { assignmentId: decision.assignmentId } };
  if (decision.mode === 'application') return { name: 'application', params: { step: decision.step } };
  return null;
}

/** Opens the flow a later `getRiderMe` asks for, if it is not already the one showing. */
function FlowFollower({ decision }: { decision: GateDecision }): null {
  const nav = useNav();
  const want = flowFor(decision);
  const showing = nav.flow?.[0]?.name ?? null;
  React.useEffect(() => {
    if (want && showing !== want.name) nav.openFlow(want.name, want.params as never);
    // Only react to a change of decision, not to every navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [want?.name, decision.mode]);
  return null;
}

