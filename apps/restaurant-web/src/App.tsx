/**
 * The restaurant operator app.
 *
 * The whole tree runs the `restaurant` theme in its compact operational register. The
 * theme attributes (`data-hg-theme="restaurant"`, `data-hg-density="compact"`) are applied
 * to a wrapper element rather than `<html>`: the density attribute is a bare attribute
 * selector of the same specificity as the `:root` block `tokens.css` emits after it, so on
 * the root element the later `:root` block wins and the density switch silently does
 * nothing. On a wrapper it matches and beats the inherited value. The colour scheme
 * (`data-theme`) is the one attribute that must go on `<html>`, because
 * `:root[data-theme="dark"]` is written against the root element.
 */
import { useEffect } from 'react';
import { ToastProvider, TooltipProvider, themeAttributes } from '@hg/ui-web';

import { OrderQueueScreen } from './screens/OrderQueueScreen';

const SCHEME = 'light' as const;
const THEME = 'restaurant' as const;

export function App() {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', SCHEME);
    root.style.colorScheme = SCHEME;
    return () => {
      root.removeAttribute('data-theme');
    };
  }, []);

  // `data-hg-theme` + `data-hg-density` on the subtree; scheme stays on <html> above.
  const attrs = themeAttributes(THEME);

  return (
    <div {...attrs} className="rx-shell">
      <main className="rx-main">
        <header className="mb-4">
          <h1 className="text-title-md text-fg-primary">Order queue</h1>
          <p className="text-body-sm text-fg-secondary">
            Live incoming orders, most urgent first.
          </p>
        </header>

        <OrderQueueScreen />
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
