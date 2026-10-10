/**
 * A redesigned route that has not merged yet shows the legacy screen for it (MASTER-PLAN §0.3),
 * so any WP can be dropped or reverted alone and the redesign build still works end to end.
 *
 * The legacy screen runs inside its own legacy stack (`../../nav`) and dashboard poller, started
 * at the matching legacy screen. Delete each mapping when the redesigned screen registers; the
 * whole file goes when every route is built.
 */
import * as React from 'react';

import { NavProvider, type StackEntry } from '../../nav';
import { DashboardProvider } from '../../dashboard';
import { Router } from '../../Router';
import { EmptyState } from '../ds';
import type { Entry } from './routes';

function legacyEntryFor(entry: Entry): StackEntry | null {
  switch (entry.name) {
    case 'home':
      return { name: 'home', params: undefined };
    case 'earnings':
      return { name: 'earnings', params: {} };
    case 'account':
    case 'suspended':
      return { name: 'profile', params: undefined };
    case 'trip':
      return entry.params.assignmentId
        ? { name: 'assignment', params: { assignmentId: entry.params.assignmentId } }
        : { name: 'home', params: undefined };
    case 'application':
      return { name: 'onboarding', params: undefined };
    default:
      return null;
  }
}

export function LegacyFallback({ entry }: { entry: Entry }): React.ReactElement {
  if (entry.name === 'signIn') {
    // Required lazily: App.tsx imports the redesign, so a top-level import would be a cycle.
    const { LoginGate } = require('../../../App') as { LoginGate: React.ComponentType };
    return <LoginGate />;
  }
  const initial = legacyEntryFor(entry);
  if (!initial) {
    return (
      <EmptyState
        title="This screen is still being rebuilt"
        description={`The redesigned "${entry.name}" screen has not merged yet.`}
      />
    );
  }
  return (
    <DashboardProvider>
      <NavProvider initial={initial}>
        <Router />
      </NavProvider>
    </DashboardProvider>
  );
}
