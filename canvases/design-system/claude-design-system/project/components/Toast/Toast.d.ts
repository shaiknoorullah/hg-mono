/** Short, non-blocking message (02-components.md §32). */
export interface ToastProps {
  /** No `halal` variant — the shield is drawn only by HalalBadge / HalalCertificationPanel. */
  variant?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  title: string;
  description?: string;
  /** An action makes the toast persistent. */
  action?: { label: string; onAction: () => void };
  /** ms, default 5000. danger and action toasts are persistent. Pauses on hover and focus. */
  duration?: number;
  /** Called on dismiss and when the timer ends. A 44px dismiss button renders when set. */
  onDismiss?: () => void;
  icon?: import('../Icon/Icon').IconName | import('../Icon/Icon').IconExtensionName;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function Toast(props: ToastProps): JSX.Element;
