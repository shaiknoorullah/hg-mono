/**
 * WP6 exceptions (rider manifest R30–R32): Something's wrong per leg, Can't deliver and the
 * return to the restaurant, and every way a trip ends that is not a delivery.
 *
 * Registers `tripException` (declared by WP5 in `../dropoff/routes.ts`; pops back to the step it
 * was opened from), `tripReturn` (UNDELIVERABLE, RETURNING) and `tripEnded` (declared by WP4: the
 * trip host routes RETURNED, CANCELLED_BY_PLATFORM, REASSIGNED and DELIVERED here). Trip steps
 * have no Back (`back: 'none'`).
 */
import '../dropoff/routes';

import { registerScreen } from '../nav/registry';
import { EndedScreen } from './EndedScreen';
import { ExceptionScreen } from './ExceptionScreen';
import { ReturnScreen } from './ReturnScreen';

registerScreen('tripException', { component: ExceptionScreen, back: 'pop' });
registerScreen('tripReturn', { component: ReturnScreen, back: 'none' });
registerScreen('tripEnded', { component: EndedScreen, back: 'none' });

export { resetExceptionState } from './state';
