/**
 * WP1 Sign-in and routing: R01 phone, R02 code (both under `signIn`), R03 opening (`splash`) and
 * the terminal routes (`terminal`: update, wrong-role, closed). WP0 declares all three routes.
 *
 * None of them can be left with Back: the gate renders them with no navigator underneath (the
 * code step handles Back itself, to the phone step).
 */
import { registerScreen } from '../nav/registry';
import { SignInScreen } from './SignInScreen';
import { SplashScreen } from './SplashScreen';
import { TerminalScreen } from './TerminalScreen';

registerScreen('signIn', { component: SignInScreen });
registerScreen('splash', { component: SplashScreen });
registerScreen('terminal', { component: TerminalScreen });
