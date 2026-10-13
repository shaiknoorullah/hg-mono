/**
 * Icon specimens: every name in both weights, as the live components/Icon/preview.html draws
 * them (a dashed tile marks a name outside the core 14).
 */

import { Icon, ICON_MAP, ICON_NAMES } from './Icon.js';

/** The live design system's component name. */
export const component = 'Icon';

/** The whole grid, paired with the reference's full page. */
export function Full() {
  return (
    <div className="hg-specimen-grid">
      {ICON_NAMES.map((name) => (
        <div key={name} className={ICON_MAP[name].extension ? 'hg-specimen-tile hg-specimen-tile-dashed' : 'hg-specimen-tile'}>
          <div className="hg-specimen-row">
            <Icon name={name} size="lg" />
            <Icon name={name} size="lg" weight="bold" />
          </div>
          <span className="hg-specimen-caption">{name}</span>
        </div>
      ))}
    </div>
  );
}
