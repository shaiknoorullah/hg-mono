/**
 * Specimens for `NewOrdersStrip`, named after the Live Orders canvas boards (`Offer-one`,
 * `Offer-three`, `Offer-four-overflow`, `Board-empty`, `Board-paused`, `Board-loading`,
 * `Tablet-three-offers`); the live design system has no preview page for it.
 */

import type { ReactNode } from 'react';

import { NewOrdersStrip, type NewOrdersStripTile } from './NewOrdersStrip.js';

/** Grouped under one heading in the preview. */
export const component = 'NewOrdersStrip';

const start = Date.now();
const order = (code: string, secs: number, name: string, items: number, earn: number, prep: number, note = false): NewOrdersStripTile => ({
  id: code,
  code,
  expiresAt: start + secs * 1000,
  earnCents: earn,
  customerName: name,
  itemCount: items,
  prepMinutes: prep,
  hasNote: note,
});
const C8T4 = order('C8T4', 15, 'Fatima R.', 7, 5697, 25, true);
const B3M9 = order('B3M9', 40, 'Omar S.', 2, 2210, 15);
const A7K2 = order('A7K2', 132, 'Aisha K.', 3, 3769, 20, true);
const D2P6 = order('D2P6', 170, 'Yusra M.', 1, 1349, 10);

const Wide = ({ width = 1360, children }: { width?: number; children: ReactNode }) => <div style={{ width }}>{children}</div>;

/** `Offer-one`: one order waiting. */
export function OfferOne() {
  return (
    <Wide>
      <NewOrdersStrip tiles={[A7K2]} />
    </Wide>
  );
}

/** `Offer-three`: three orders, soonest deadline first. */
export function OfferThree() {
  return (
    <Wide>
      <NewOrdersStrip tiles={[C8T4, B3M9, A7K2]} />
    </Wide>
  );
}

/** `Offer-four-overflow`: a burst; the fourth waits behind "+1 more". */
export function OfferFourOverflow() {
  return (
    <Wide>
      <NewOrdersStrip tiles={[C8T4, B3M9, A7K2, D2P6]} />
    </Wide>
  );
}

/** `Board-empty`: nothing waiting. */
export function Empty() {
  return (
    <Wide>
      <NewOrdersStrip tiles={[]} />
    </Wide>
  );
}

/** `Board-paused`: paused, with Resume now in the empty card. */
export function Paused() {
  return (
    <Wide>
      <NewOrdersStrip
        tiles={[]}
        empty={{
          icon: 'clock',
          title: 'Paused until 7:10 pm',
          body: 'New orders resume at 7:10 pm. Orders in progress still need finishing.',
          action: { label: 'Resume now', onPress: () => undefined, variant: 'tertiary' },
        }}
      />
    </Wide>
  );
}

/** `Board-loading`: the waiting orders are loading. */
export function Loading() {
  return (
    <Wide>
      <NewOrdersStrip status="loading" />
    </Wide>
  );
}

/** The waiting orders failed to load. */
export function LoadError() {
  return (
    <Wide>
      <NewOrdersStrip status="error" error={{ onRetry: () => undefined }} />
    </Wide>
  );
}

/** An offer is open in the panel: the one-row strip. */
export function Compact() {
  return (
    <Wide>
      <NewOrdersStrip
        tiles={[B3M9, A7K2]}
        compact={{
          title: '2 new orders waiting',
          body: 'A7K2 is open in the panel. Also waiting: B3M9 (timer shown).',
          buttonLabel: 'Show all',
          buttonName: 'Show all 2 new orders',
          buttonVariant: 'tertiary',
          onPress: () => undefined,
          expiresAt: B3M9.expiresAt ?? null,
        }}
      />
    </Wide>
  );
}

/** `Tablet-three-offers`: no key hints, Decline as a close icon. */
export function TabletThreeOffers() {
  return (
    <Wide width={1000}>
      <NewOrdersStrip tiles={[C8T4, B3M9, A7K2]} isDesktop={false} />
    </Wide>
  );
}
