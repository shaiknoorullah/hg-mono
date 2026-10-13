/**
 * ErrorState specimens (approval packet P3), checked against
 * `restaurant/live-orders/Board-first-load-error`.
 */

import { ErrorState } from './ErrorState.js';

/** The proposed component's name. */
export const component = 'ErrorState';

const noop = () => undefined;

/** A region that failed to load, with Try again. */
export function Region() {
  return (
    <div style={{ width: 480 }}>
      <ErrorState focusOnMount={false} title="Orders did not load" description="Nothing has been lost. Try again." onRetry={noop} />
    </div>
  );
}

/** Retrying: the button keeps its label and shows busy. */
export function Retrying() {
  return (
    <div style={{ width: 480 }}>
      <ErrorState focusOnMount={false} errorCode="NETWORK_OFFLINE" onRetry={noop} retrying />
    </div>
  );
}

/** Inline, after a failed save. */
export function Inline() {
  return (
    <div style={{ width: 480 }}>
      <ErrorState focusOnMount={false} variant="inline" title="Could not save" description="The hours were not saved. Try again." onRetry={noop} />
    </div>
  );
}
