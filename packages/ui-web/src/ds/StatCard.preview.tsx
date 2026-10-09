/**
 * StatCard specimens (approved; no live preview page yet): the rider Earnings and admin Orders
 * figures, with loading, error and empty.
 */

import { StatCard } from './StatCard.js';

/** The design-system component name. */
export const component = 'StatCard';

/** A count, a money figure and a duration. */
export function Figures() {
  return (
    <div className="hg-specimen-cards">
      <StatCard label="Trips" value="14" helper="This week" icon="bicycling" />
      <StatCard label="Gross earnings" cents={41870} helper="Before fees" icon="wallet" />
      <StatCard label="Online" value="6 h 20 min" />
    </div>
  );
}

/** Loading, error, nothing reported. */
export function States() {
  return (
    <div className="hg-specimen-cards">
      <StatCard label="Trips" loading />
      <StatCard label="Gross earnings" error="Couldn't load earnings" />
      <StatCard label="Per hour" />
    </div>
  );
}
