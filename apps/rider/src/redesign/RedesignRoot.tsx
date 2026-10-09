/**
 * Root for a redesign build (`EXPO_PUBLIC_HG_REDESIGN=1`, redesign N0 spike).
 *
 * The ONLY place the rider app touches NativeWind: it imports the compiled tokens
 * (`global.rider.css`), and this directory is the only app code Babel compiles with
 * NativeWind's JSX runtime (babel.config.js). `App.tsx` requires this module inside the flag
 * branch alone, so a flag-off build contains none of it.
 *
 * Opens on the design-system gallery under its own `ThemeProvider` — the scheme source of
 * truth, bridged to NativeWind by `useHgColorScheme` — and "Continue to the app" hands over to
 * the unchanged app tree. `<PortalHost />` sits last, above everything, so
 * `@rn-primitives/portal` content renders over the whole app.
 */
import '@hg/ui-native/global.rider.css';

import * as React from 'react';
import { View } from 'react-native';
import { PortalHost } from '@rn-primitives/portal';
import { ThemeProvider } from '@hg/ui-native';
import { useHgFonts } from '@hg/ui-native/fonts';

import { DsGallery } from './DsGallery';

export function RedesignRoot({ children }: { children: React.ReactNode }): React.ReactElement | null {
  const [gallery, setGallery] = React.useState(true);
  const [scheme, setScheme] = React.useState<'light' | 'dark'>('light');
  // The gallery mounts before AppRoot, which is where the faces are normally registered; the
  // `font-sans*` utilities name them, and React Native has no fallback chain.
  const { fontsLoaded } = useHgFonts();
  if (!fontsLoaded) return null;
  return (
    <View style={{ flex: 1 }}>
      {gallery ? (
        <ThemeProvider theme="rider" scheme={scheme}>
          <DsGallery
            onToggleScheme={() => setScheme((s) => (s === 'light' ? 'dark' : 'light'))}
            onClose={() => setGallery(false)}
          />
        </ThemeProvider>
      ) : (
        children
      )}
      <PortalHost />
    </View>
  );
}
