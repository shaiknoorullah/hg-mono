/**
 * EmptyState specimens (approval packet P4), checked against `restaurant/live-orders/Board-empty`
 * and `restaurant/onboarding/MenuMain`.
 */

import { Button } from '../ds/index.js';
import { EmptyState } from './EmptyState.js';

/** The proposed component's name. */
export const component = 'EmptyState';

const noop = () => undefined;

/** In a pane, with a next step. */
export function Region() {
  return (
    <div style={{ width: 480 }}>
      <EmptyState
        icon="orders"
        title="No orders yet"
        description="New orders appear here and ring until you answer them."
        action={<Button variant="primary">Check sound</Button>}
      />
    </div>
  );
}

/** Filtered to nothing, with Clear filters. */
export function Filtered() {
  return (
    <div style={{ width: 480 }}>
      <EmptyState variant="filtered" icon="search" title="No orders match these filters" description="Widen the dates or clear a filter." onClearFilters={noop} />
    </div>
  );
}

/** A drained queue (positive tone, still a tint). */
export function Drained() {
  return (
    <div style={{ width: 480 }}>
      <EmptyState tone="positive" icon="check" title="Verification queue is clear" description="Everything has been reviewed." meta="Last processed 2:14 pm" />
    </div>
  );
}
