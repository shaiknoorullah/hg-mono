import { describe, expect, it } from 'vitest';

import { FROZEN_NOW, order } from './support';
import { isFollowing, placesOf, riderOf, summarise, textOf } from '../workspace/liveMapModel';

const NOW = Date.parse(FROZEN_NOW);
const located = (over: Parameters<typeof order>[1] = {}) =>
  order('order_admin_view_picked_up', {
    restaurant_location: { latitude: 43.7262, longitude: -79.2701 },
    destination_location: { latitude: 43.7349, longitude: -79.2552 },
    rider_location: { latitude: 43.7296, longitude: -79.2648, heading_deg: 45, accuracy_m: 6, recorded_at: new Date(NOW - 17_000).toISOString(), is_coarse: false },
    ...over,
  });

describe('the live map pane reads the order as the server sent it', () => {
  it('draws no destination while the address is masked, even though the response carried coordinates', () => {
    const masked = placesOf(located({ pii_revealed: false }));
    expect(masked.map((p) => p.kind)).toEqual(['restaurant']);
    const revealed = placesOf(located({ pii_revealed: true }));
    expect(revealed.map((p) => p.kind)).toEqual(['restaurant', 'customer']);
    expect(textOf(located({ pii_revealed: false }), '').canReveal).toBe(true);
  });

  it('follows a rider while the order is on the way, and a dispute only while the rider still has it', () => {
    expect(isFollowing({ state: 'PICKED_UP', dispatch_state: 'CARRYING' })).toBe(true);
    expect(isFollowing({ state: 'DISPUTED', dispatch_state: 'CARRYING' })).toBe(true);
    expect(isFollowing({ state: 'DISPUTED', dispatch_state: 'COMPLETED' })).toBe(false);
    expect(isFollowing({ state: 'DELIVERED', dispatch_state: 'COMPLETED' })).toBe(false);
  });

  it('says a position is stale in words and on the pin, and never moves it', () => {
    const old = located({ rider_location: { latitude: 43.7296, longitude: -79.2648, recorded_at: new Date(NOW - 240_000).toISOString() } });
    const seen = riderOf(old, NOW, null);
    expect(seen.stale).toBe(true);
    expect(seen.sentence).toContain('this may not be where the rider is now');
    expect(seen.rider?.pinLabel).toMatch(/last known/);
    // The same fix a minute later is the same coordinates: nothing is projected forward.
    expect(riderOf(old, NOW + 60_000, null).rider?.fix).toEqual(seen.rider?.fix);
    expect(summarise(old, true).eta).toMatch(/may be out of date$/);
  });

  it('names the moment a paused connection froze the picture, and does not call it stale', () => {
    const seen = riderOf(located(), NOW, { link: 'offline', at: FROZEN_NOW });
    expect(seen.sentence).toMatch(/Shown as of .*when this computer went offline\. The rider may have moved since\./);
    expect(seen.rider?.pinLabel).toMatch(/, as of /);
  });

  it('with no rider, says so and draws no rider pin', () => {
    const seen = riderOf(order('order_admin_view_preparing'), NOW, null);
    expect(seen.rider).toBeNull();
    expect(seen.sentence).toMatch(/^None assigned/);
  });
});
