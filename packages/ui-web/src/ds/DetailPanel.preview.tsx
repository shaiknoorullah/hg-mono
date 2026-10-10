/**
 * DetailPanel specimens, after `admin/refunds/OrderDetail` ("DetailPanel (in-page)") and
 * `restaurant/live-orders/LiveBoard` (Detail-loading, Detail-error, Detail-not-found).
 * No live preview exists yet (owner-approved, not in the live index).
 */

import type { ReactNode } from 'react';

import { EmptyState, ErrorState, Skeleton } from '../proposed/index.js';
import { Button, DetailPanel, IconButton } from './index.js';

/** Pairs with components/DetailPanel/preview.html once the design system publishes one. */
export const component = 'DetailPanel';

function Box({ children }: { children: ReactNode }) {
  return <div style={{ width: 440, height: 420, display: 'flex' }}>{children}</div>;
}

const rows = [
  ['Order', 'B3M9'],
  ['Placed', '6:41 pm'],
  ['Customer', 'Amina K.'],
  ['Total', '$42.18'],
];

/** Ready: a body that scrolls under a pinned footer. */
export function Ready() {
  return (
    <Box>
      <DetailPanel
        title="Order B3M9"
        subtitle="Preparing · accepted 6:43 pm"
        onClose={() => undefined}
        focusOnOpen={false}
        actions={<IconButton icon="map" accessibilityLabel="Show on the map" />}
        footer={
          <>
            <Button variant="tertiary">Adjust items</Button>
            <Button variant="primary">Mark ready</Button>
          </>
        }
      >
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px' }}>
          {rows.map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <dt style={{ color: 'var(--hg-text-secondary)' }}>{k}</dt>
              <dd style={{ margin: 0 }}>{v}</dd>
            </div>
          ))}
        </dl>
        {Array.from({ length: 8 }, (_, i) => (
          <p key={i} style={{ margin: 0 }}>
            Item line {i + 1}: Chicken shawarma plate × 1
          </p>
        ))}
      </DetailPanel>
    </Box>
  );
}

/** Loading: a status with skeleton lines; the header stays. */
export function Loading() {
  return (
    <Box>
      <DetailPanel
        title="Order B3M9"
        onClose={() => undefined}
        focusOnOpen={false}
        status="loading"
        loadingSlot={<Skeleton variant="text" lines={4} />}
      />
    </Box>
  );
}

/** Empty: nothing selected yet. */
export function Empty() {
  return (
    <Box>
      <DetailPanel
        title="Order details"
        focusOnOpen={false}
        status="empty"
        emptySlot={<EmptyState title="No order open" description="Choose an order from the list to see it here." />}
      />
    </Box>
  );
}

/** Error: the order failed to load; Try again reloads it. */
export function Error() {
  return (
    <Box>
      <DetailPanel
        title="Order B3M9"
        onClose={() => undefined}
        focusOnOpen={false}
        status="error"
        errorSlot={<ErrorState title="This order didn’t load" description="Check the connection, then try again." onRetry={() => undefined} />}
      />
    </Box>
  );
}

/** Busy, at the restaurant's `width="panel"` (380px, 460px from 1280px): Close and Escape wait. */
export function Busy() {
  return (
    <div style={{ height: 420, display: 'flex' }}>
      <DetailPanel
        title="Refund B3M9"
        width="panel"
        busy
        onClose={() => undefined}
        focusOnOpen={false}
        footer={
          <Button variant="primary" loading>
            Send refund
          </Button>
        }
      >
        <p style={{ margin: 0 }}>Refunding $42.18 to the card ending 4242.</p>
      </DetailPanel>
    </div>
  );
}
