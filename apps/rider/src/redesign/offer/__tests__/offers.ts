/**
 * Offer payloads for the WP3 tests, each derived from a real contract fixture.
 *
 * The #312 shapes (`dropoff` as an approximate area with a nullable `radius_m`) are copied
 * literally from #312's own fixtures `offer_pending` and `offer_pending_area_without_radius`:
 * fixture requests "lands with #312". Until #312 merges, `payload('offer_pending')` on main still
 * carries the old exact-point drop-off.
 */
import { payload } from '../../test/mockApi';
import type { DispatchOffer } from '../model';

type Literal = { status: number; body: unknown };

/** #312 `offer_pending`: 28 s left, area "Harbourfront, Toronto" with a 400 m circle. */
export function offerPending(over: Partial<DispatchOffer> = {}): DispatchOffer {
  return {
    ...payload<DispatchOffer>('offer_pending'),
    dropoff: { area: 'Harbourfront, Toronto', latitude: 43.6405, longitude: -79.3815, radius_m: 400 },
    ...over,
  };
}

/** #312 `offer_pending_area_without_radius`: no `radius_m`, so no circle. */
export function offerWithoutRadius(): DispatchOffer {
  return offerPending({
    offer_id: 'acaf1919-15ba-471a-ad9f-c1b6ed463ec7',
    dropoff: { area: 'Riverdale, Toronto', latitude: 43.6675, longitude: -79.35 },
  });
}

/** `{ data }` around an offer (or null), as `getCurrentOffer` answers. */
export function current(offer: DispatchOffer | null): Literal {
  return { status: 200, body: { data: offer } };
}

/** The `rider_dashboard_active` fixture, waiting for offers: no delivery, no offer unless given. */
export function dashboard(over: Record<string, unknown> = {}): Literal {
  return {
    status: 200,
    body: { data: { ...payload('rider_dashboard_active'), mode: 'ONLINE_IDLE', active_assignment: null, current_offer: null, ...over } },
  };
}

/** A 409 from the real `error_offer_already_taken` envelope with its code swapped (fixture request). */
export function conflict(code: string): Literal {
  const p = payload('error_offer_already_taken');
  p.error.code = code;
  p.error.message = code;
  return { status: 409, body: p };
}
