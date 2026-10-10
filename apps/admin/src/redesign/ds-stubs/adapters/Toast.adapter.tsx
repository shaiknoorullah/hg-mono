/**
 * ADAPTER: live design-system `Toast` -> `@hg/ui-web` `ToastProvider` / `useToast`.
 *
 * The legacy library raises toasts imperatively (wrap once in `ToastProvider`, then
 * `useToast().show(options)`), and its options are the live props (`variant`, `title`,
 * `description`, `action`, `duration`, `onDismiss`). The live declarative `<Toast>` is
 * provided here too: mounting it shows the toast once, unmounting dismisses it.
 */
import { useEffect, useRef } from 'react';
import { ToastProvider, useToast, type ToastOptions } from '@hg/ui-web';

import type { AnyIconName } from './Icon.adapter';

export { ToastProvider, useToast };
export type { ToastOptions };

export interface ToastProps extends ToastOptions {
  /** Accepted for parity; the legacy toast picks its icon from the variant. */
  icon?: AnyIconName;
  testId?: string;
}

export function Toast({ icon: _icon, testId: _testId, ...options }: ToastProps): null {
  const toast = useToast();
  const shown = useRef<string | null>(null);
  useEffect(() => {
    shown.current = toast.show(options);
    return () => {
      if (shown.current) toast.dismiss(shown.current);
    };
    // Shown once per mount: a re-render must not raise a second toast.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
