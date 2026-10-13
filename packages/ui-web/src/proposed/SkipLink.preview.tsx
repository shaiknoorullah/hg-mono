/**
 * SkipLink specimen (proposed, packet P15), after `admin/staff/SkipLinkFocus`. The link is
 * off-screen until focused; the specimen draws its focused look by focusing it on mount.
 */

import { useEffect, useRef } from 'react';

import { SkipLink } from './index.js';

/** The proposed component's name. */
export const component = 'SkipLink';

/** Visible on focus. */
export function Focused() {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector('a')?.focus({ preventScroll: true });
  }, []);
  return (
    <div ref={box} style={{ position: 'relative', width: 360, height: 72 }}>
      <SkipLink targetId="w2-skip-target" />
      <div id="w2-skip-target" />
    </div>
  );
}
