/**
 * Console layout state shared by the shell and the pages in it: whether a page has its own
 * panel open (the rail collapses to icons whenever any panel is open, manifest §1.3), and the
 * in-page confirmation slot under the status bar (sign out, turn off orders, …).
 */
import { createContext, useContext, useEffect, type ReactNode } from 'react';

export interface ConsoleLayoutApi {
  setPagePanelOpen: (open: boolean) => void;
  /** Show an inline confirmation under the status bar; `null` clears it. */
  setConfirm: (node: ReactNode | null) => void;
}

export const ConsoleLayoutContext = createContext<ConsoleLayoutApi>({
  setPagePanelOpen: () => {},
  setConfirm: () => {},
});

export function useConsoleLayout(): ConsoleLayoutApi {
  return useContext(ConsoleLayoutContext);
}

/** A page calls this while its own DetailPanel is open. */
export function usePagePanelOpen(open: boolean): void {
  const { setPagePanelOpen } = useConsoleLayout();
  useEffect(() => {
    setPagePanelOpen(open);
    return () => setPagePanelOpen(false);
  }, [open, setPagePanelOpen]);
}
