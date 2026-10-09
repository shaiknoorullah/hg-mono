/** Every deadline in the system, derived from the SERVER clock (02-components.md §38, D-14). */
export interface CountdownProps {
  /** RFC-3339 deadline from the server. REQUIRED. */
  expiresAt: string;
  /** Server clock at response time. REQUIRED. Skew > 5 s -> runs on serverNow + monotonic time. */
  serverNow: string;
  /** Full length of the window in seconds (rider offer 30, restaurant response 180…). Drives thresholds, ring and bar. */
  windowSeconds: number;
  /** Fires exactly once, including when the deadline had already passed at mount (the caller re-fetches). */
  onExpire?: () => void;
  variant?: 'ring' | 'bar' | 'text';
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  /** Fraction of the window below which the state is urgent (default 0.25). */
  urgentThreshold?: number;
  /** Fraction below which it is critical, with a 1 Hz pulse (default 0.1). */
  criticalThreshold?: number;
  /** On the rider's dark field surface. */
  onDark?: boolean;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function Countdown(props: CountdownProps): JSX.Element | null;
