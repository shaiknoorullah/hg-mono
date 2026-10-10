/**
 * WP3 Offer: R17, the dispatch offer as a full-screen, non-dismissable layer over every screen
 * and the BottomNav (SH Offer* boards). No route: the layer decides for itself when it shows.
 */
import { registerLayer } from '../nav/registry';
import { OfferLayer } from './OfferLayer';

// Above the dashboard poller (0) and What's new (WP11): an offer covers everything.
registerLayer({ key: 'offer', order: 100, component: OfferLayer });

export { OfferLayer, OFFER_POLL_MS } from './OfferLayer';
