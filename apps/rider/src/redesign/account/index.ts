/**
 * WP9 Payouts and account: the Account tab root (`account`, R44) and what it pushes (R45 Your
 * details, R50 Vehicle, the Documents list, R46 Terms and privacy → R05 legal document, R51
 * Delete account by request), the shared Payouts screen (`payouts`: R14 application step 5 and
 * R47 Account › Payouts, also the Earnings payout-account link R40) and Account paused
 * (`suspended`, R52). Sign out (R48) is a confirm on the Account screen.
 *
 * `application` is not registered here: WP7/WP8 own that flow and push `payouts` from it.
 */
import './routes';
import { registerScreen } from '../nav/registry';
import {
  AccountScreen,
  DeleteAccountScreen,
  DetailsScreen,
  DocumentsScreen,
  LegalDocumentScreen,
  TermsScreen,
  VehicleScreen,
} from './AccountScreen';
import { PayoutsScreen } from './PayoutsScreen';
import { SuspendedScreen } from './SuspendedScreen';

registerScreen('account', { component: AccountScreen });
registerScreen('accountDetails', { component: DetailsScreen });
registerScreen('accountVehicle', { component: VehicleScreen });
registerScreen('accountDocuments', { component: DocumentsScreen });
registerScreen('accountTerms', { component: TermsScreen });
registerScreen('legalDocument', { component: LegalDocumentScreen });
registerScreen('deleteAccount', { component: DeleteAccountScreen });
registerScreen('payouts', { component: PayoutsScreen });
registerScreen('suspended', { component: SuspendedScreen });
