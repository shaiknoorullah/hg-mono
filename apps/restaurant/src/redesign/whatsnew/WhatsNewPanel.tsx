/**
 * What's new in the shell panel (`?panel=whats-new`; settings boards `WhatsNew-AfterUpdate`,
 * `-OnOrders`, `-Interrupted`, `-Loading`, `-Error`; canvas note "Opens in the panel beside the
 * page after an update. It no longer waits for the order queue to empty").
 *
 * Opening it with the notes on screen marks them seen, so it does not open by itself again; the
 * list it shows is the one it opened with. "Got it", Close and Escape close it and focus goes back
 * to what opened it (the shell panel's own rule). A new order does not close it: the order goes to
 * the strip, and the offer panel opens only when the owner opens it.
 */
import { useState } from 'react';

import { Button, DetailPanel } from '../ds';
import type { ShellPanelProps } from '../shell/slots';
import { WHATS_NEW } from './copy';
import { NotesBody } from './NotesBody';
import { getWhatsNewState } from './store';
import { useMarkSeenWhenShown, useNotesView } from './useNotes';

export function WhatsNewPanel({ onClose }: ShellPanelProps) {
  // What this device had seen when the panel opened; marking it seen later does not change the list.
  const [baseline] = useState(() => getWhatsNewState().lastSeen);
  const view = useNotesView('since', baseline);
  useMarkSeenWhenShown(view.kind === 'list' || view.kind === 'upToDate');
  const upToDate = view.kind === 'upToDate';

  return (
    <DetailPanel
      title={upToDate ? WHATS_NEW.panelTitleUpToDate : WHATS_NEW.panelTitle}
      label="What's new"
      closeLabel={WHATS_NEW.close}
      onClose={onClose}
      testId="whats-new-panel"
      {...(view.kind === 'list' ? { footer: <Button variant="primary" size="md" onPress={onClose}>{WHATS_NEW.gotIt}</Button> } : {})}
    >
      <NotesBody view={view} />
    </DetailPanel>
  );
}
