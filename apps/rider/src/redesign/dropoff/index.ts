/**
 * WP5 the drop-off leg and proof of delivery (rider manifest R23–R29): steps 3 and 4, the
 * handover, the proof for `required_pod_method`, and Delivered with its earnings line.
 *
 * Registers `tripDropoff` (WP4's trip host routes PICKED_UP and later here), `tripHandover`,
 * `tripProof` and `tripDelivered`. Trip steps have no Back (`back: 'none'`); the proof screens
 * draw their own "Back to handover" while nothing is sending. "Something's wrong" opens
 * `tripException` (WP6).
 */
import './routes';

import { registerScreen } from '../nav/registry';
import { DropoffScreen, HandoverScreen } from './DropoffScreens';
import { DeliveredScreen, ProofScreen } from './ProofScreens';

registerScreen('tripDropoff', { component: DropoffScreen, back: 'none' });
registerScreen('tripHandover', { component: HandoverScreen, back: 'none' });
registerScreen('tripProof', { component: ProofScreen, back: 'none' });
registerScreen('tripDelivered', { component: DeliveredScreen, back: 'none' });

export { resetDropoffState } from './proof';
export type { HandoverMethod, PodMethod, TripLeg } from './routes';
