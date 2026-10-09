/**
 * WP2 Home and shift: R15 Home (tab root `home`) and R16 the resume strip, plus the one
 * dashboard poller every redesigned screen reads through `useRiderDashboard()`.
 */
import { registerLayer, registerScreen, registerTabAccessory } from '../nav/registry';
import { DashboardPoller } from './dashboard';
import { HomeScreen } from './HomeScreen';
import { ResumeStrip } from './ResumeStrip';

registerScreen('home', { component: HomeScreen });
// Order 0: under the offer sheet and What's new; it renders nothing.
registerLayer({ key: 'rider-dashboard', order: 0, component: DashboardPoller });
registerTabAccessory({ key: 'resume-strip', order: 0, component: ResumeStrip });

export { useRiderDashboard, isOnlineMode, ONLINE_POLL_MS, OFFLINE_POLL_MS } from './dashboard';
export type { RiderDashboard, RiderDashboardView, AvailabilityNotice, PendingAvailability } from './dashboard';
