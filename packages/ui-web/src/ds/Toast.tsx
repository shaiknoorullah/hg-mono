/**
 * Toast — a short confirmation or notice that never blocks a task (02-components.md §32; live
 * `index.d.ts`, `components/Toast/README.md`).
 *
 * - Variants neutral, success, warning, danger and info. **There is no halal toast**: the
 *   shield is drawn only by HalalBadge and HalalCertificationPanel. `success` is a tint with a
 *   success icon, never a green fill (invariant 10, lint L-4).
 * - `role="status"` (polite); `danger` is `role="alert"` (assertive).
 * - `duration` defaults to 5000 ms. **Danger toasts and toasts with an action are persistent.**
 *   The timer pauses while the pointer is over the toast or focus is inside it.
 * - The dismiss button is a real 44px target and renders only when `onDismiss` is set.
 * - Never the only carrier of an error that blocks a task; that belongs inline.
 *
 * `ToastProvider` + `useToast()` keep the API the `/proposed` barrel offered before this rebuild
 * (`show(options) → id`, `dismiss(id)`, at most three stacked), now rendering this `Toast`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type ReactNode,
} from 'react';

import { ToastAction, ToastViewport } from '../lib/ui/toast.js';
import { cn } from '../lib/utils.js';
import { Icon, IconButton, type DsIconName } from './index.js';

/** The five toast variants. No `halal`, and `success` is never a fill. */
export type ToastVariant = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/** Props of the live `Toast` (index.d.ts). */
export interface ToastProps {
  /** No `halal` variant — the shield is drawn only by HalalBadge / HalalCertificationPanel. */
  variant?: ToastVariant;
  title: string;
  description?: string;
  /** An action makes the toast persistent. */
  action?: { label: string; onAction: () => void };
  /** ms, default 5000. danger and action toasts are persistent. Pauses on hover and focus. */
  duration?: number;
  /** Called on dismiss and when the timer ends. A 44px dismiss button renders when set. */
  onDismiss?: () => void;
  icon?: DsIconName;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: CSSProperties;
}

/** Default auto-dismiss time for a non-persistent toast. */
export const TOAST_DEFAULT_DURATION = 5000;

const TONE: Record<ToastVariant, { box: string; icon: string; glyph: DsIconName }> = {
  neutral: { box: 'border-line-decorative bg-surface-raised text-fg-primary', icon: 'text-fg-secondary', glyph: 'info' },
  // Tint plus a success icon. No fill.
  success: {
    box: 'border-feedback-success-border/25 bg-feedback-success-tint text-feedback-success-tint-text',
    icon: 'text-feedback-success-icon',
    glyph: 'check',
  },
  warning: {
    box: 'border-feedback-warning-border/25 bg-feedback-warning-tint text-feedback-warning-tint-text',
    icon: 'text-feedback-warning-icon',
    glyph: 'warning',
  },
  danger: {
    box: 'border-feedback-danger-border/25 bg-feedback-danger-tint text-feedback-danger-tint-text',
    icon: 'text-feedback-danger-icon',
    glyph: 'error',
  },
  info: {
    box: 'border-feedback-info-border/25 bg-feedback-info-tint text-feedback-info-tint-text',
    icon: 'text-feedback-info-icon',
    glyph: 'info',
  },
};

/** Whether a toast stays until dismissed: danger, anything with an action, or duration 0/∞. */
export function isPersistentToast({ variant, action, duration }: Pick<ToastProps, 'variant' | 'action' | 'duration'>): boolean {
  return variant === 'danger' || Boolean(action) || duration === 0 || duration === Number.POSITIVE_INFINITY;
}

/** One toast. Inline on its own, or stacked by `ToastProvider`. */
export function Toast({
  variant = 'neutral',
  title,
  description,
  action,
  duration,
  onDismiss,
  icon,
  testId = 'Toast',
  style,
}: ToastProps) {
  const tone = TONE[variant] ?? TONE.neutral;
  const persistent = isPersistentToast({ variant, action, duration });
  const total = persistent ? null : (duration ?? TOAST_DEFAULT_DURATION);
  const [paused, setPaused] = useState({ hover: false, focus: false });
  const left = useRef(total);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const hasDismiss = Boolean(onDismiss);

  useEffect(() => {
    left.current = total;
  }, [total]);

  useEffect(() => {
    if (total === null || paused.hover || paused.focus || !hasDismiss || left.current === null) return undefined;
    const started = Date.now();
    const id = setTimeout(() => dismissRef.current?.(), left.current);
    return () => {
      clearTimeout(id);
      if (left.current !== null) left.current = Math.max(0, left.current - (Date.now() - started));
    };
  }, [paused.hover, paused.focus, total, hasDismiss]);

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setPaused((p) => ({ ...p, focus: false }));
    }
  };

  return (
    <div
      role={variant === 'danger' ? 'alert' : 'status'}
      aria-live={variant === 'danger' ? 'assertive' : 'polite'}
      aria-atomic="true"
      data-testid={testId}
      data-variant={variant}
      data-persistent={persistent || undefined}
      data-paused={paused.hover || paused.focus || undefined}
      onPointerEnter={() => setPaused((p) => ({ ...p, hover: true }))}
      onPointerLeave={() => setPaused((p) => ({ ...p, hover: false }))}
      onFocus={() => setPaused((p) => ({ ...p, focus: true }))}
      onBlur={onBlur}
      className={cn(
        'flex min-h-12 w-full items-start gap-3 rounded-md border py-2 ps-4 shadow-e3',
        hasDismiss ? 'pe-1' : 'pe-4',
        tone.box,
      )}
      style={style}
    >
      <span className={cn('shrink-0 pt-2.5', tone.icon)}>
        <Icon name={icon ?? tone.glyph} size="md" />
      </span>
      <div className="grid min-w-0 flex-1 gap-0.5 py-2.5">
        <span className="text-label-lg font-semibold">{title}</span>
        {description ? <span className="text-body-sm">{description}</span> : null}
      </div>
      {action ? <ToastAction onClick={action.onAction}>{action.label}</ToastAction> : null}
      {onDismiss ? (
        <IconButton icon="close" accessibilityLabel="Dismiss" variant="plain" size="md" onPress={() => onDismiss()} />
      ) : null}
    </div>
  );
}

/* ───── Provider and hook (the API the /proposed barrel already offered) ───── */

/** What `useToast().show()` takes: the live Toast props minus the wiring the provider owns. */
export interface ToastOptions {
  variant?: ToastVariant;
  title: string;
  description?: string;
  action?: { label: string; onAction: () => void };
  /** ms. `danger` and anything with an action are persistent. */
  duration?: number;
  onDismiss?: () => void;
  icon?: DsIconName;
}

/** The imperative toast API: raise one, or take one down by id. */
export interface ToastApi {
  show: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** At most this many toasts are stacked; the oldest goes first. */
export const TOAST_MAX_STACKED = 3;

/** The toast API from the nearest `ToastProvider`. Throws outside one. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}

let toastSeq = 0;

/** Props of `ToastProvider`. */
export interface ToastProviderProps {
  children?: ReactNode;
  /** The viewport landmark's name. Default "Notifications". */
  label?: string;
  /**
   * Which bottom corner the stack sits in (logical). Default `bottom-end`. The restaurant console
   * uses `bottom-start` so toasts land at the bottom left of the panes, never over the
   * DetailPanel or the new-order strip (#675).
   */
  placement?: 'bottom-end' | 'bottom-start';
  /**
   * `fixed` (default) pins the stack to the viewport; `contained` positions it inside the nearest
   * positioned ancestor, so a pane area can host it.
   */
  position?: 'fixed' | 'contained';
  /** Extra classes and inline style for the viewport, e.g. an inline-start offset past a side nav. */
  viewportClassName?: string;
  viewportStyle?: CSSProperties;
}

/** Wrap the app once; `useToast()` below it raises toasts into one labelled viewport. */
export function ToastProvider({
  children,
  label = 'Notifications',
  placement = 'bottom-end',
  position = 'fixed',
  viewportClassName,
  viewportStyle,
}: ToastProviderProps) {
  const [toasts, setToasts] = useState<Array<ToastOptions & { id: string }>>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((options: ToastOptions) => {
    toastSeq += 1;
    const id = `hg-toast-${toastSeq}`;
    setToasts((prev) => [...prev, { ...options, id }].slice(-TOAST_MAX_STACKED));
    return id;
  }, []);

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport
        aria-label={label}
        data-testid="hg-toast-viewport"
        data-placement={placement}
        placement={placement}
        contained={position === 'contained'}
        className={viewportClassName}
        style={viewportStyle}
      >
        {toasts.map(({ id, onDismiss, ...toast }) => (
          <Toast
            key={id}
            {...toast}
            testId="hg-toast"
            onDismiss={() => {
              onDismiss?.();
              dismiss(id);
            }}
          />
        ))}
      </ToastViewport>
    </ToastContext.Provider>
  );
}
