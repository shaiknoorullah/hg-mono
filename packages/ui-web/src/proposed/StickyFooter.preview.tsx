/**
 * StickyFooter / ActionBar specimens (proposed, packet P12), after
 * `restaurant/menu-hours/HoursView` (the save bar under the weekly hours).
 */

import { Button } from '../ds/index.js';
import { StickyFooter } from './index.js';

/** The proposed component's name. */
export const component = 'StickyFooter';

/** At rest, and with content scrolled under it (elevated). */
export function AtRestAndElevated() {
  return (
    <div className="hg-specimen-col" style={{ width: 640 }}>
      <StickyFooter label="Hours actions">
        <Button variant="tertiary">Discard changes</Button>
        <Button variant="primary">Save hours</Button>
      </StickyFooter>
      <StickyFooter label="Hours actions" elevated align="between">
        <span style={{ color: 'var(--hg-text-secondary)' }}>2 days changed</span>
        <Button variant="primary">Save hours</Button>
      </StickyFooter>
    </div>
  );
}
