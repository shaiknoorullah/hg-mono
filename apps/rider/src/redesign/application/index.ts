/**
 * WP7 Application, part 1: the `application` flow host (R04 hub, R13 closed), R06 Your details
 * and R07 How you deliver. R05's document screen is WP9's `legalDocument`; documents, review and
 * fix documents (R08–R12) are WP8's and only declared here (routes.ts).
 *
 * The hub has no Back (it is the flow's root; the flow closes itself when the application is
 * done). The step screens Back to the screen under them.
 */
import './routes';
import { registerScreen } from '../nav/registry';
import { ApplicationScreen, DetailsScreen, VehicleScreen } from './ApplicationScreen';

/** Registers the WP7 screens. Called once below; tests call it again after `clearScreens()`. */
export function registerApplication(): void {
  registerScreen('application', { component: ApplicationScreen, back: 'none' });
  registerScreen('applicationDetails', { component: DetailsScreen });
  registerScreen('applicationVehicle', { component: VehicleScreen });
}

registerApplication();
