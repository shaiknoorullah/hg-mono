/**
 * SystemBannerSlot specimens (proposed, packet P8), after
 * `admin/alerts-sessions-system/SystemBannerStack`. Banners are the legacy Banner until W4
 * rebuilds it.
 */

import { Banner, SystemBannerSlot } from './index.js';

/** The proposed component's name. */
export const component = 'SystemBannerSlot';

const offline = {
  id: 'offline',
  severity: 'warning' as const,
  node: <Banner variant="warning" title="You’re offline." description="Changes are off until the connection returns." />,
};
const api = {
  id: 'api',
  severity: 'warning' as const,
  node: <Banner variant="warning" title="The API is not ready." description="Sign-in, orders and live updates may fail until it is." />,
};
const alert = {
  id: 'alert',
  severity: 'danger' as const,
  node: (
    <Banner
      variant="danger"
      title="High-severity alert, 9:41 am."
      description="Stripe webhook deliveries have failed for 5 minutes."
      dismissible
    />
  ),
};

/** One banner. */
export function One() {
  return (
    <div style={{ width: 1100 }}>
      <SystemBannerSlot banners={[offline]} />
    </div>
  );
}

/** Several, sorted by severity, capped at two with the rest counted. */
export function Several() {
  return (
    <div style={{ width: 1100 }}>
      <SystemBannerSlot banners={[offline, api, alert]} max={2} onShowAll={() => undefined} />
    </div>
  );
}
