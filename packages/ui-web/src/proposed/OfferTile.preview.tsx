/**
 * Specimens for `OfferTile`, named after the "OfferTile states" row of the Live Orders canvas
 * board `Proposed-components` (the live design system has no preview page for it).
 */

import type { ReactNode } from 'react';

import { OFFER_OUTCOMES } from './new-orders-copy.js';
import { OfferTile, type OfferTileProps } from './OfferTile.js';

/** Grouped under one heading in the preview. */
export const component = 'OfferTile';

const start = Date.now();
const base = (secondsLeft: number, extra: Partial<OfferTileProps> = {}): OfferTileProps => ({
  id: 'a7k2',
  code: 'A7K2',
  expiresAt: start + secondsLeft * 1000,
  earnCents: 3769,
  customerName: 'Aisha K.',
  itemCount: 3,
  prepMinutes: 20,
  hasNote: true,
  ...extra,
});

const Frame = ({ caption, children }: { caption: string; children: ReactNode }) => (
  <div className="hg-specimen-col" style={{ width: 340 }}>
    <span>{caption}</span>
    {children}
  </div>
);

/** Waiting (2:12 left), keyboard focus (Selected), urgent, and open in the panel. */
export function Waiting() {
  return (
    <div className="hg-specimen-row hg-specimen-top">
      <Frame caption="Waiting, 2:12 left">
        <OfferTile {...base(132)} />
      </Frame>
      <Frame caption="Keyboard focus (Selected)">
        <OfferTile {...base(40)} selected />
      </Frame>
      <Frame caption="Urgent, under 10%">
        <OfferTile {...base(15)} />
      </Frame>
      <Frame caption="Open in the panel">
        <OfferTile {...base(120)} inPanel />
      </Frame>
    </div>
  );
}

/** Tablet decline icon, earnings loading, accepting and accept failed. */
export function Working() {
  return (
    <div className="hg-specimen-row hg-specimen-top">
      <Frame caption="Tablet: Decline as a close icon">
        <OfferTile {...base(110)} compactDecline />
      </Frame>
      <Frame caption="Earnings loading">
        <OfferTile
          {...base(178, { code: 'D2P6', earnCents: null, customerName: 'Yusra', itemCount: 1, hasNote: false })}
          statusLine={{ tone: 'neutral', icon: 'refresh', text: 'Loading the rest of this order…' }}
        />
      </Frame>
      <Frame caption="Accepting">
        <OfferTile
          {...base(118)}
          acceptLoading
          statusLine={{ tone: 'neutral', icon: 'refresh', text: 'Confirming with HalalGoes. Don’t tap again.' }}
        />
      </Frame>
      <Frame caption="Accept failed">
        <OfferTile
          {...base(96)}
          acceptLabel="Try accept again"
          statusLine={{ tone: 'danger', icon: 'error', text: 'Couldn’t confirm. Still waiting for you.' }}
        />
      </Frame>
      <Frame caption="Declining">
        <OfferTile {...base(84)} declining />
      </Frame>
    </div>
  );
}

/** The ended tiles: timed out, too late, withdrawn, and payment failed at accept. */
export function Ended() {
  return (
    <div className="hg-specimen-row hg-specimen-top">
      <Frame caption="Timed out">
        <OfferTile {...base(0)} outcome={OFFER_OUTCOMES.timedOut} />
      </Frame>
      <Frame caption="Too late to accept">
        <OfferTile {...base(0)} outcome={OFFER_OUTCOMES.tooLate} />
      </Frame>
      <Frame caption="Withdrawn">
        <OfferTile {...base(0)} outcome={OFFER_OUTCOMES.withdrawn} />
      </Frame>
      <Frame caption="Payment failed at accept">
        <OfferTile {...base(0)} outcome={OFFER_OUTCOMES.captureFailed} />
      </Frame>
    </div>
  );
}
