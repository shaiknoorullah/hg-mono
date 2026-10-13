/**
 * WP4 the pickup leg and the trip flow shell (rider manifest R19–R22, R33).
 *
 * Registers the flow root `trip` (the gate and Home open it) and the pickup steps it routes to;
 * declares `tripDropoff` (WP5) and `tripEnded` (WP6), which fall back until those WPs register
 * them. Exports hooks and copy only, for the next trip WPs: no components (constitution §1).
 */
import { registerLayer, registerScreen } from '../nav/registry';
import { AtRestaurantScreen, ContactScreen, PickupStepScreen, SavedStepLayer, TripHost } from './TripScreens';

registerScreen('trip', { component: TripHost, back: 'none' });
registerScreen('tripPickup', { component: PickupStepScreen, back: 'none' });
registerScreen('tripAtRestaurant', { component: AtRestaurantScreen, back: 'none' });
registerScreen('tripContact', { component: ContactScreen, back: 'pop' });
// Order 5: above the screens, under the offer sheet (WP3) and What's new.
registerLayer({ key: 'trip-saved-step', order: 5, component: SavedStepLayer });

export {
  ENDED,
  TRIP_POLL_MS,
  classifyStepError,
  dial,
  effectiveState,
  openDirections,
  postNow,
  prepareStep,
  putAssignment,
  resetTripState,
  resyncAfterConflict,
  routeFor,
  sendStep,
  setTripNotice,
  useFollowTrip,
  useTripAssignment,
  useTripNotice,
} from './assignment';
export type {
  Assignment,
  AssignmentState,
  PreparedStep,
  StepFailure,
  TripAssignmentView,
  TripNotice,
  TripRoute,
  TripStepInput,
} from './assignment';
export {
  BUTTON,
  NOT_SENT,
  NO_CONNECTION,
  OUT_OF_DATE,
  SOMETHING_WRONG,
  STATE_WORDS,
  STEP_NAME,
  STEP_SUBTITLE,
  TRACKING,
  UPDATES_DELAYED,
  callName,
  goTo,
  orderSubtitle,
  queuedBody,
  queuedRow,
  spacedPhone,
  supportHelper,
} from './copy';
