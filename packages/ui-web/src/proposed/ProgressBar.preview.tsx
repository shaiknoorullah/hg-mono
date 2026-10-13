/**
 * ProgressBar specimens (gap register "ProgressBar", #191), checked against the restaurant
 * onboarding upload boards.
 */

import { ProgressBar } from './ProgressBar.js';

/** The proposed component's name. */
export const component = 'ProgressBar';

/** Determinate tones, and indeterminate. */
export function Tones() {
  return (
    <div className="hg-specimen-col" style={{ width: 360 }}>
      <ProgressBar label="Uploading certificate" value={64} showValue />
      <ProgressBar label="3 of 5 documents" value={3} max={5} valueText="3 of 5" showValue tone="neutral" />
      <ProgressBar label="Syncing menu" value={30} tone="info" size="sm" />
      <ProgressBar label="Storage almost full" value={92} tone="warning" showValue />
      <ProgressBar label="Checking the file" value={null} />
    </div>
  );
}
