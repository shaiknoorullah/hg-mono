/**
 * SectionNav specimens (proposed), after the restaurant Settings sections.
 */

import { SectionNav } from './index.js';

/** The proposed component's name. */
export const component = 'SectionNav';

/** Settings sections, Halal certificate current, one with a count. */
export function Settings() {
  return (
    <SectionNav
      label="Settings sections"
      activeKey="halal"
      items={[
        { key: 'profile', label: 'Restaurant profile', href: '#profile' },
        { key: 'halal', label: 'Halal certificate', href: '#halal', description: 'Expires 20 Oct' },
        { key: 'bank', label: 'Bank account', href: '#bank', count: 1, countNoun: 'to fix' },
        { key: 'notifications', label: 'Order alerts', href: '#alerts' },
      ]}
    />
  );
}
