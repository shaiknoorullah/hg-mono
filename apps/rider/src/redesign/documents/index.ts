/**
 * WP8 Application, part 2: R08 Documents (step 3), R09 document capture, R10 notifications ask,
 * R11 Review and R12 Fix documents. The three routes WP7 declared (`applicationDocuments`,
 * `applicationReview`, `applicationFix`) are registered here, with WP8's own (routes.ts).
 *
 * Review, Fix and the notifications ask have no Back: each replaces the screen before it, and
 * the server's `next_step` moves the rider on. Documents, capture and the edit steps Back to the
 * screen under them.
 */
import './routes';
import { registerScreen } from '../nav/registry';
import { CaptureScreen } from './CaptureScreen';
import { DocumentScreen, DocumentsScreen } from './DocumentsScreen';
import { FixDetailsScreen, FixPlateScreen, FixScreen } from './FixScreen';
import { NotifyScreen, ReviewScreen } from './ReviewScreen';

/** Registers the WP8 screens. Called once below; tests call it again after `clearScreens()`. */
export function registerDocuments(): void {
  registerScreen('applicationDocuments', { component: DocumentsScreen });
  registerScreen('applicationDocument', { component: DocumentScreen });
  registerScreen('applicationCapture', { component: CaptureScreen });
  registerScreen('applicationNotify', { component: NotifyScreen, back: 'none' });
  registerScreen('applicationReview', { component: ReviewScreen, back: 'none' });
  registerScreen('applicationFix', { component: FixScreen, back: 'none' });
  registerScreen('applicationFixDetails', { component: FixDetailsScreen });
  registerScreen('applicationFixPlate', { component: FixPlateScreen });
}

registerDocuments();
