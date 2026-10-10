/**
 * TEMPORARY stub until @hg/ui-web/ds ships Spinner (ds-request issue TBD; tracked under #191).
 * Props follow the canvases' drawing. Draws through the legacy `@hg/ui-web` Spinner (which
 * swaps to a static bar under reduced motion). With a `label` it is a polite status; without
 * one it is decorative (the surrounding control carries the state, e.g. aria-busy).
 */
import { Spinner as LegacySpinner } from '@hg/ui-web';

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  /** Visible and announced text ("Loading more…"). Omit for a decorative spinner. */
  label?: string;
  inline?: boolean;
  className?: string;
  testId?: string;
}

export function Spinner({ size = 'md', label, inline, className, testId = 'Spinner' }: SpinnerProps): React.JSX.Element {
  return (
    <LegacySpinner
      size={size}
      {...(label ? { label } : { decorative: true })}
      {...(inline !== undefined ? { inline } : {})}
      {...(className ? { className } : {})}
      {...({ 'data-testid': testId } as object)}
    />
  );
}
