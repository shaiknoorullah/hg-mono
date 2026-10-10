/**
 * WP10 Earnings tab: R35 Earnings summary (tab root), R36 Earnings activity, R37 Earnings line,
 * R38 Payouts, R39 Payout. Boards: EA (rider earnings canvas).
 */
import './routes';

import { registerScreen } from '../nav/registry';
import { EarningsScreen, PayoutsScreen } from './EarningsScreen';
import { ActivityScreen, LineScreen, PayoutScreen } from './LedgerScreens';

registerScreen('earnings', { component: EarningsScreen });
registerScreen('earningsActivity', { component: ActivityScreen });
registerScreen('earningsLine', { component: LineScreen });
registerScreen('earningsPayouts', { component: PayoutsScreen });
registerScreen('earningsPayout', { component: PayoutScreen });
