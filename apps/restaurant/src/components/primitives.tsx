import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { IconLoader } from '../lib/icons';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';

export function Button({
  variant = 'primary',
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean }) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-[var(--r-sm)] px-4 h-11 text-[14.5px] font-bold transition-all duration-150 disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]';
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-[var(--primary)] text-white hover:bg-[var(--primary-2)] shadow-[var(--shadow-1)]',
    accent: 'bg-[var(--accent-600)] text-white hover:bg-[var(--accent-700)] shadow-[var(--shadow-1)]',
    secondary: 'bg-[var(--card)] text-[var(--ink)] border border-[var(--hair)] hover:border-[var(--ink3)]',
    ghost: 'bg-transparent text-[var(--ink2)] hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)]',
    danger: 'bg-[var(--danger-600)] text-white hover:brightness-95',
  };
  return (
    <button className={cx(base, variants[variant], className)} disabled={disabled || loading} {...rest}>
      {loading && <IconLoader size={16} />}
      {children}
    </button>
  );
}

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        'rounded-[var(--r)] border border-[var(--hair)] bg-[var(--card)] shadow-[var(--shadow-1)]',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Input({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        'h-11 w-full rounded-[var(--r-sm)] border border-[var(--hair)] bg-[var(--card)] px-3.5 text-[14.5px] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink3)] focus:border-[var(--primary)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_18%,transparent)]',
        className,
      )}
      {...rest}
    />
  );
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[12.5px] font-bold text-[var(--ink2)]">
      {children}
    </label>
  );
}

export function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <p className="mt-1.5 text-[12.5px] font-semibold text-[var(--danger-600)]">{children}</p>;
}

export function PageLoading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-[var(--ink2)]">
      <IconLoader size={26} />
      <p className="text-[13.5px] font-semibold">{label}</p>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-[var(--r)] border border-dashed border-[var(--hair)] px-6 py-16 text-center">
      {icon && <div className="text-[var(--ink3)]">{icon}</div>}
      <h3 className="text-[15px] font-extrabold text-[var(--ink)]">{title}</h3>
      {description && <p className="max-w-sm text-[13.5px] text-[var(--ink2)]">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-[var(--r)] border border-[var(--danger-50)] bg-[var(--danger-50)] px-6 py-16 text-center">
      <h3 className="text-[15px] font-extrabold text-[var(--danger-700)]">{title}</h3>
      {description && <p className="max-w-sm text-[13.5px] text-[var(--danger-700)]">{description}</p>}
      {onRetry && (
        <Button variant="danger" onClick={onRetry} className="mt-1">
          Try again
        </Button>
      )}
    </div>
  );
}

export function Chip({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'warning' | 'danger' | 'halal' | 'expired';
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] text-[var(--ink2)]',
    accent: 'bg-[var(--accent-50)] text-[var(--accent-700)]',
    warning: 'bg-[var(--warning-50)] text-[var(--warning-700)]',
    danger: 'bg-[var(--danger-50)] text-[var(--danger-700)]',
    halal: 'bg-[var(--halal-tint)] text-[var(--halal-tint-text)]',
    expired: 'bg-[var(--halal-expired-tint)] text-[var(--halal-expired-text)]',
  };
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-[var(--r-pill)] px-2.5 py-1 text-[11.5px] font-bold',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}
