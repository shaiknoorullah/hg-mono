/**
 * The redesigned rider app root (behind `EXPO_PUBLIC_HG_REDESIGN`, see `flag.ts`).
 *
 * Light and dark follow the phone (rider manifest: no in-app switch): `ThemeProvider` gets no
 * `scheme`, so it reads `useColorScheme`, and the status bar follows the same answer.
 *
 * NativeWind (N0) is wired here and nowhere else in the app: this module loads the compiled
 * tokens (`global.rider.css`), hands NativeWind's scheme back to the system so `className` and
 * `useTheme()` follow the phone together, and mounts the `@rn-primitives/portal` host last, over
 * everything. `App.tsx` requires this module only when the flag is on, and only `src/redesign/`
 * compiles its JSX through NativeWind (babel.config.js), so a flag-off build contains none of it.
 */
import '@hg/ui-native/global.rider.css';

import * as React from 'react';
import { useColorScheme, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { PortalHost } from '@rn-primitives/portal';
import { useHgFonts } from '@hg/ui-native/fonts';
import { HgColorSchemeBridge } from '@hg/ui-native/lib';

import { ThemeProvider } from './ds';
import { outbox } from './data/outbox';
import { SessionGate } from './session/Session';
import { DS_GALLERY_ENABLED, DsGalleryRoot } from './DsGalleryRoot';
import './screens';

export function RedesignRoot({ children }: { children: React.ReactNode }): React.ReactElement {
  const scheme = useColorScheme();
  return (
    <SafeAreaProvider>
      <ThemeProvider theme="rider">
        <HgColorSchemeBridge />
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
          {children}
        </SafeAreaView>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

export function RedesignApp(): React.ReactElement | null {
  const { fontsLoaded } = useHgFonts();
  const [gallery, setGallery] = React.useState(DS_GALLERY_ENABLED);
  React.useEffect(() => outbox.start(), []);
  if (!fontsLoaded) return null;
  return (
    <View style={{ flex: 1 }}>
      {gallery ? (
        <DsGalleryRoot onClose={() => setGallery(false)} />
      ) : (
        <RedesignRoot>
          <SessionGate />
        </RedesignRoot>
      )}
      <PortalHost />
    </View>
  );
}
