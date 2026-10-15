/**
 * The high-severity alert banner (`ASS/AlertBannerAnyPage`, `AlertBannerSupport`,
 * `AlertBannerMultiple`, `AlertBannerDismissed`): one banner for the newest alert, "3 high-severity
 * alerts, latest 9:41 am" when there are more, with "Open in live alerts" opening the newest.
 *
 * Only an alert that arrived live raises it. A reload replays the last days of alerts into the
 * list (so Live alerts is whole), but a replayed alert is history, not news, and would otherwise
 * greet every sign-in. Dismiss hides every alert counted; the banner returns for a new one.
 *
 * A support agent reads what it means for the customers they are helping first, and the raw
 * message second (round-2 decision). Only the payment-webhook kind has that sentence written; any
 * other kind shows the raw message alone.
 */
import type { SystemBannerData } from '../system/banners';
import { formatTime } from '../data/format';
import type { StaffRole } from '../data/session';
import { bannerAlerts, customerImpact, type AlertRow } from './model';
import { dismissAlertBanner, type AlertsState } from './store';

export function alertBanner(state: Pick<AlertsState, 'rows' | 'dismissed'>, role: StaffRole | null): SystemBannerData | null {
  const high = bannerAlerts(state.rows, state.dismissed);
  const newest: AlertRow | undefined = high[0];
  if (!newest) return null;
  const time = formatTime(newest.at);
  const support = role === 'SUPPORT_AGENT';
  const impact = support ? customerImpact(newest.code) : null;
  const message = newest.message ?? 'A high-severity alert was raised.';
  const many = high.length > 1;

  const title = many
    ? `${high.length} high-severity alerts, latest ${time}.`
    : impact
      ? `${impact.headline}, ${time}.`
      : `High-severity alert, ${time}.`;
  const description = impact ? `${impact.sentence} Alert: ${message}` : many ? `Latest: ${message}` : message;

  return {
    id: 'alert',
    tone: 'warning',
    title,
    description,
    announce: 'alert',
    action: { label: 'Open in live alerts', to: `/alerts/${newest.seq}` },
    onDismiss: () => {
      for (const r of high) dismissAlertBanner(r.seq);
    },
  };
}
