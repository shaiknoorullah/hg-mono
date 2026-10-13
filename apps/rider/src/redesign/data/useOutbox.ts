import * as React from 'react';

import { outbox, type OutboxEntry } from './outbox';

const snapshot = () => outbox.snapshot();
const subscribe = (fn: () => void) => outbox.subscribe(fn);

/** Steps waiting to reach the server (all, or one assignment's). Re-renders on change. */
export function useOutbox(assignmentId?: string): readonly OutboxEntry[] {
  const all = React.useSyncExternalStore(subscribe, snapshot, snapshot);
  return React.useMemo(
    () => (assignmentId ? all.filter((e) => e.assignmentId === assignmentId) : all),
    [all, assignmentId],
  );
}
