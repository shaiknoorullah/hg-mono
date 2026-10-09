/**
 * The design-system gallery's root (redesign, N0): a dev tool, not a screen of the app.
 *
 * `RedesignApp` opens on it only when the build also sets `EXPO_PUBLIC_HG_DS_GALLERY=1`, so
 * the redesign shell and its e2e flows are unaffected. It owns its `ThemeProvider` scheme (the
 * source of truth) and bridges it to NativeWind, so the toggle flips StyleSheet and `className`
 * styling together. "Continue to the app" hands over to the redesign shell.
 */
import * as React from 'react';
import { HgColorSchemeBridge } from '@hg/ui-native/lib';

import { ThemeProvider } from './ds';
import { DsGallery } from './DsGallery';

/** Whether this build opens on the gallery (build-time, like the redesign flag). */
export const DS_GALLERY_ENABLED = process.env.EXPO_PUBLIC_HG_DS_GALLERY === '1';

/** The gallery under its own rider `ThemeProvider`, light first, with the NativeWind bridge. */
export function DsGalleryRoot({ onClose }: { onClose: () => void }): React.ReactElement {
  const [scheme, setScheme] = React.useState<'light' | 'dark'>('light');
  return (
    <ThemeProvider theme="rider" scheme={scheme}>
      <HgColorSchemeBridge scheme={scheme} />
      <DsGallery
        scheme={scheme}
        onToggleScheme={() => setScheme((s) => (s === 'light' ? 'dark' : 'light'))}
        onClose={onClose}
      />
    </ThemeProvider>
  );
}
