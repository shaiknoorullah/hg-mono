/**
 * Banner + InlineAlert specimens (approval packet P1). There is no live preview for a proposed
 * composite, so these are checked against the canvas boards that draw it
 * (`restaurant/live-orders/Board-closed-offline`, `Board-cert-expired`, `menu-hours/EditorNew`).
 */

import { Banner, HalalBanner, InlineAlert } from './Banner.js';

/** The proposed component's name. */
export const component = 'Banner';

const noop = () => undefined;

/** Every tone, page placement. */
export function PageTones() {
  return (
    <div className="hg-specimen-col" style={{ width: 960 }}>
      <Banner placement="page" tone="danger" title="Not receiving new orders — reconnecting" action={{ label: 'Try again', onPress: noop }} />
      <Banner placement="page" tone="warning" title="You are paused until 7:30 pm" action={{ label: 'Resume now', onPress: noop }} />
      <Banner placement="page" tone="info" title="A new version is ready" action={{ label: 'Refresh', onPress: noop }} />
      <Banner placement="page" tone="neutral" title="Closed for Thanksgiving" />
      <HalalBanner placement="page" tone="slate" title="Your halal certificate expired on 3 Oct">
        Customers cannot see your store until a current certificate is verified.
      </HalalBanner>
    </div>
  );
}

/** Every tone, inline placement, with body text. */
export function InlineTones() {
  return (
    <div className="hg-specimen-col" style={{ width: 480 }}>
      <InlineAlert tone="danger" title="Could not save the item">
        The price was changed by someone else. Reload to see it.
      </InlineAlert>
      <InlineAlert tone="warning" title="Hours overlap">
        Monday 5:00 pm – 11:00 pm overlaps the earlier range.
      </InlineAlert>
      <InlineAlert tone="info" title="Changes go live when you save" />
      <InlineAlert tone="neutral">Tip: press A to accept the focused order.</InlineAlert>
      <HalalBanner tone="slate" title="We can't currently vouch for this restaurant">
        The certificate on file is not current.
      </HalalBanner>
    </div>
  );
}

/** Action loading, dismissible, and the prominent queue banner. */
export function States() {
  return (
    <div className="hg-specimen-col" style={{ width: 480 }}>
      <InlineAlert tone="info" title="You are offline" action={{ label: 'Retry', onPress: noop, loading: true }} />
      <InlineAlert tone="info" title="Menu synced" dismissible />
      <Banner tone="danger" emphasis="prominent" title="Not receiving new orders" description="Accept still works while reconnecting." />
    </div>
  );
}
