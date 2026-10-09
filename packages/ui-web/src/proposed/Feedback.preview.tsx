/**
 * Specimens for the W1 proposed parts (Skeleton, Spinner, Separator, Tooltip). The live design
 * system has no preview page for them; the canvases draw them as "Proposed component"
 * stand-ins, so this is compared against the canvas boards by eye.
 */

import { Button } from '../ds/Button.js';
import { IconButton } from '../ds/IconButton.js';
import { Separator } from './Separator.js';
import { Skeleton } from './Skeleton.js';
import { Spinner } from './Spinner.js';
import { Tooltip } from './Tooltip.js';

/** Grouped under one heading in the preview. */
export const component = 'ProposedCore';

/** Skeleton shapes: text lines, rect, circle, card with the seal slot reserved. */
export function Skeletons() {
  return (
    <div className="hg-specimen-row hg-specimen-top" aria-busy="true" aria-label="Loading">
      <Skeleton shape="text" lines={3} width={200} />
      <Skeleton shape="rect" width={120} height={48} />
      <Skeleton shape="circle" width={40} />
      <Skeleton shape="card" width={240} />
    </div>
  );
}

/** The admin layouts (#699): 44px list rows with a status line, and one block. */
export function SkeletonLayouts() {
  return (
    <div className="hg-specimen-row hg-specimen-top">
      <div style={{ width: 360 }}>
        <Skeleton variant="rows" count={3} label="Loading orders" />
      </div>
      <div style={{ width: 240 }}>
        <Skeleton variant="block" height={96} />
      </div>
    </div>
  );
}

/** Spinner sizes, with and without a visible label. */
export function Spinners() {
  return (
    <div className="hg-specimen-row">
      <Spinner size="sm" label="Loading orders" inline />
      <Spinner size="md" label="Checking again" />
      <Spinner size="lg" decorative />
    </div>
  );
}

/** A plain rule, an inset rule and a labelled one. */
export function Separators() {
  return (
    <div className="hg-specimen-col hg-specimen-pane">
      <Separator />
      <Separator inset />
      <Separator label="Earlier today" />
    </div>
  );
}

/** Tooltips held open: the full date behind a short one, and an icon button's label. */
export function Tooltips() {
  return (
    <div className="hg-specimen-row hg-specimen-tooltip">
      <Tooltip open side="bottom" content="Wednesday 14 October 2026, 2:41 pm EDT">
        <Button variant="link">14 Oct</Button>
      </Tooltip>
      <Tooltip open side="bottom" content="Copy the order ID">
        <IconButton icon="copy" accessibilityLabel="Copy ID" variant="tonal" />
      </Tooltip>
    </div>
  );
}
