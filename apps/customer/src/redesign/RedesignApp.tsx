/**
 * The customer redesign's root, mounted by `index.js` only when `EXPO_PUBLIC_HG_REDESIGN` is on.
 *
 * Light and dark follow the phone (`ThemeProvider` with no `scheme`), unlike the legacy app which
 * pins light. Fonts, Stripe and the safe area are the same as the legacy root.
 *
 * NativeWind (redesign N0): this root imports the compiled tokens (`global.customer.css`), bridges
 * the colour scheme (no scheme given, so NativeWind follows the phone like `ThemeProvider`) and
 * mounts the `@rn-primitives/portal` host last, so RNR overlays render above the shell.
 */
import '@hg/ui-native/global.customer.css';

import * as React from 'react';
import { PortalHost } from '@rn-primitives/portal';
import { HgColorSchemeBridge } from '@hg/ui-native/lib';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { setClientErrorReporter } from '@hg/ui-native';
import { useHgFonts } from '@hg/ui-native/fonts';

import { StripeRoot } from '../payments/StripeRoot';
import { PaymentSheetHost } from '../payments/PaymentSheetHost';
import { OrderingPauseProvider } from '../ordering/orderingPause';
import { ThemeProvider } from './ds';
import { Shell } from './navigation/Shell';
import { asyncStorageLastSeenStore } from './whatsnew/asyncStorage';
import { setLastSeenStore } from './whatsnew/store';

// What's new remembers the last version it showed in the phone's storage, so the sheet opens once
// per update (https://github.com/shaiknoorullah/hg-mono/issues/1058). Set before the first render.
setLastSeenStore(asyncStorageLastSeenStore());

export default function RedesignApp(): React.ReactElement | null {
  const scheme = useColorScheme();
  const { fontsLoaded, fontError } = useHgFonts();

  React.useEffect(() => {
    setClientErrorReporter((code) => {
      // eslint-disable-next-line no-console
      console.warn('[hg-customer redesign] client error reported:', code);
    });
  }, []);

  if (!fontsLoaded && !fontError) return null;

  return (
    <StripeRoot>
      <SafeAreaProvider>
        <ThemeProvider theme="customer">
          <HgColorSchemeBridge />
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          <OrderingPauseProvider>
            <Shell />
            <PaymentSheetHost />
          </OrderingPauseProvider>
          <PortalHost />
        </ThemeProvider>
      </SafeAreaProvider>
    </StripeRoot>
  );
}
