/**
 * WP11 History, documents and What's new: R41 Deliveries (`deliveries`, declared by WP10 and
 * opened from the Earnings History card), R42 One delivery (`delivery`), R49 Account documents
 * after approval (`accountDocument`, `accountReplace`; the list is WP9's `accountDocuments`) and
 * R43 What's new (the sheet layer, and the `whatsNew` page reopened from Account).
 */
import './routes';
import { registerLayer, registerScreen } from '../nav/registry';
import { DeliveriesScreen, DeliveryScreen } from './DeliveriesScreen';
import { AccountDocumentScreen, AccountReplaceScreen } from './DocumentScreens';
import { WhatsNewLayer, WhatsNewScreen } from './WhatsNew';

/** Registers the WP11 screens and the What's new layer. Called once below; tests call it again after `clearScreens()`. */
export function registerHistory(): void {
  registerScreen('deliveries', { component: DeliveriesScreen });
  registerScreen('delivery', { component: DeliveryScreen });
  registerScreen('accountDocument', { component: AccountDocumentScreen });
  registerScreen('accountReplace', { component: AccountReplaceScreen });
  registerScreen('whatsNew', { component: WhatsNewScreen });
  registerLayer({ key: 'whats-new', order: 40, component: WhatsNewLayer });
}

registerHistory();
