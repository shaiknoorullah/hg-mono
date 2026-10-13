/**
 * NavDrawer specimens (proposed), after `restaurant/live-orders/LiveBoard` (navSheet at 200%).
 * The open drawer is a modal sheet, so the specimen shows the trigger on the chrome bar;
 * the drawer itself is checked in the contract test.
 */

import { AppBar, SideNav } from '../ds/index.js';
import { NavDrawer } from './index.js';

/** The proposed component's name. */
export const component = 'NavDrawer';

/** "Open menu, 3 new orders" leading the chrome AppBar at 200% zoom. */
export function Trigger() {
  return (
    <div style={{ width: 640 }}>
      <AppBar
        tone="chrome"
        role="none"
        titleIsPageHeading={false}
        title="Live orders"
        leading={
          <NavDrawer triggerCount={3} triggerCountNoun="new orders">
            <SideNav
              groups={[{ key: 'main', items: [{ key: 'orders', label: 'Live orders', icon: 'orders', href: '#o', badge: 3, badgeNoun: 'new' }] }]}
              activeKey="orders"
              collapsible={false}
            />
          </NavDrawer>
        }
      />
    </div>
  );
}
