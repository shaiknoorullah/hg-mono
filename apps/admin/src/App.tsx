import { ToastProvider, TooltipProvider, themeAttributes } from '@hg/ui-web';

import { OnboardingQueueScreen } from './screens/OnboardingQueueScreen';

/**
 * The admin theme (`data-hg-theme="admin"`, comfortable density) is applied to a wrapper
 * subtree rather than to `<html>`: on the root element the token pipeline's own `:root`
 * block wins by source order and the density attribute silently no-ops. `themeAttributes`
 * from @hg/ui-web produces the exact attribute set for the admin register.
 */
export function App() {
  return (
    <div {...themeAttributes('admin')} className="adm-shell">
      <header className="adm-header">
        <span className="text-title-sm text-fg-primary">Halal Goes — Admin</span>
      </header>
      <main className="adm-main">
        <OnboardingQueueScreen />
      </main>
    </div>
  );
}

export function Root() {
  return (
    <TooltipProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </TooltipProvider>
  );
}
