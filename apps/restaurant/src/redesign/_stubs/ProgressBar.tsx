/**
 * TEMPORARY STUB for the proposed DS `ProgressBar` (ds-request(web): #191, shadcn Progress).
 * Delete when `@hg/ui-web/proposed` exports it.
 *
 * A 6 px track with a neutral fill (never green: solid green belongs to the halal colour roles
 * only). `value` is 0 to 100 and is announced through `role="progressbar"`; a value the server
 * computed is passed straight through, the client never works one out.
 */
export interface ProgressBarProps {
  /** Accessible name, e.g. "Setup progress" or "Uploading business-licence.pdf". */
  label: string;
  /** 0 to 100. */
  value: number;
  /** Text read out instead of the bare number, e.g. "Uploading, 64%". */
  valueText?: string;
  className?: string;
  testId?: string;
}

export function ProgressBar({ label, value, valueText, className = '', testId }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-valuetext={valueText}
      data-testid={testId}
      className={`h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken ${className}`}
    >
      <div className="h-full rounded-full bg-fg-primary" style={{ width: `${clamped}%` }} />
    </div>
  );
}
