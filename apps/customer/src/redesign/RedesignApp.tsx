/**
 * The customer redesign's root, mounted by `index.js` only when `EXPO_PUBLIC_HG_REDESIGN` is on.
 *
 * Light and dark follow the phone (`ThemeProvider` with no `scheme`), unlike the legacy app which
 * pins light. Fonts, Stripe and the safe area are the same as the legacy root.
 */
import * as React from 'react';
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
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          <OrderingPauseProvider>
            <Shell />
            <PaymentSheetHost />
          </OrderingPauseProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </StripeRoot>
  );
}
