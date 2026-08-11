import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import * as RadixToast from '@radix-ui/react-toast';
import { AlertCircle, AlertTriangle, Check, Info, X } from 'lucide-react';
import { cx } from './utils/cx.js';
import { HG_FOCUS } from './utils/focus.js';

/**
 * Toast — 02-components.md §32.
 *
 * Variants: neutral · success · warning · danger · info. `success` is TINT plus
 * a success-coloured check — never a green fill (RULE H-1). There is no green
 * solid anywhere in this file.
 *
 * Radix supplies the two behaviours that are easy to get wrong and impossible
 * to retrofit: the timer PAUSES on hover and on screen-reader focus (an
 * auto-dismissing message that vanishes mid-read is inaccessible), and the
 * viewport is a real landmark that is reachable in the tab order.
 *
 * `danger` defaults to persistent; anything carrying an action is persistent.
 * A toast is never the sole carrier of an error that blocks a task — that
 * belongs inline.
 *
 * Max 3 stacked; the oldest collapses.
 */

export type ToastVariant = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface ToastOptions {
  variant?: ToastVariant;
  title: string;
  description?: string;
  action?: { label: string; onAction: () => void };
  /** ms. `danger` and anything with an action default to persistent. */
  duration?: number;
  onDismiss?: () => void;
}

interface ToastRecord extends ToastOptions {
  id: string;
}

const MAX_STACKED = 3;
const DEFAULT_DURATION = 5000;

const TONE: Record<ToastVariant, { classes: string; Icon: typeof Info }> = {
  neutral: { classes: 'border-line-decorative bg-surface-raised text-fg-primary', Icon: Info },
  success: {
    // Tint + coloured icon. No fill.
    classes: 'border-feedback-success-border bg-feedback-success-tint text-feedback-success-tint-text',
    Icon: Check,
  },
  warning: {
    classes: 'border-feedback-warning-border bg-feedback-warning-tint text-feedback-warning-tint-text',
    Icon: AlertTriangle,
  },
  danger: {
    classes: 'border-feedback-danger-border bg-feedback-danger-tint text-feedback-danger-tint-text',
    Icon: AlertCircle,
  },
  info: {
    classes: 'border-feedback-info-border bg-feedback-info-tint text-feedback-info-tint-text',
    Icon: Info,
  },
};

interface ToastApi {
  show: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((options: ToastOptions) => {
    const id = `hg-toast-${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [...prev, { ...options, id }].slice(-MAX_STACKED));
    return id;
  }, []);

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      <RadixToast.Provider swipeDirection="right">
        {children}
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onClose={() => dismiss(toast.id)} />
        ))}
        <RadixToast.Viewport
          data-testid="hg-toast-viewport"
          label="Notifications"
          className={cx(
            'fixed bottom-0 end-0 z-(--hg-z-toast) m-0 flex w-full max-w-96 list-none flex-col gap-2 p-4',
            // Safe-area aware, above any sticky footer.
            'pb-[max(var(--hg-space-4),env(safe-area-inset-bottom))]',
          )}
        />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onClose }: { toast: ToastRecord; onClose: () => void }) {
  const variant = toast.variant ?? 'neutral';
  const { classes, Icon } = TONE[variant];
  const persistent = variant === 'danger' || Boolean(toast.action);
  const duration = toast.duration ?? (persistent ? Number.POSITIVE_INFINITY : DEFAULT_DURATION);

  return (
    <RadixToast.Root
      duration={Number.isFinite(duration) ? duration : undefined}
      // danger is assertive, everything else polite (04-a11y §4.2: toasts
      // announce, they never take focus).
      type={variant === 'danger' ? 'foreground' : 'background'}
      onOpenChange={(open) => {
        if (!open) {
          toast.onDismiss?.();
          onClose();
        }
      }}
      data-testid="hg-toast"
      data-variant={variant}
      className={cx('flex items-start gap-3 rounded-md border p-4 shadow-e3', classes)}
    >
      <Icon aria-hidden="true" size={20} className="mt-0.5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <RadixToast.Title className="text-label-lg">{toast.title}</RadixToast.Title>
        {toast.description ? (
          <RadixToast.Description className="text-body-sm">
            {toast.description}
          </RadixToast.Description>
        ) : null}
        {toast.action ? (
          <RadixToast.Action
            altText={toast.action.label}
            onClick={toast.action.onAction}
            className={cx('mt-1 self-start rounded-sm text-label-md underline', HG_FOCUS)}
          >
            {toast.action.label}
          </RadixToast.Action>
        ) : null}
      </div>
      {/* Dismiss is a real 44 target (02-components.md §32). */}
      <RadixToast.Close
        aria-label="Dismiss"
        className={cx(
          'inline-flex size-11 shrink-0 items-center justify-center rounded-sm',
          'hover:bg-[var(--hg-state-hover-overlay)]',
          HG_FOCUS,
        )}
      >
        <X aria-hidden="true" size={20} />
      </RadixToast.Close>
    </RadixToast.Root>
  );
}
