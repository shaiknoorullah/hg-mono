/**
 * Halal Goes — customer app entry.
 *
 * It wraps the tree in the design system's `ThemeProvider` under this app's register (`customer`,
 * `light` scheme) and a `SafeAreaProvider`, then mounts the customer journey behind a small
 * in-app stack `Router`: Discovery → Restaurant → Cart → Checkout → Tracking. Everything
 * domain-shaped comes from `@hg/api-client` against the mock; every visible component comes from
 * `@hg/ui-native`.
 */
import * as React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, setClientErrorReporter } from '@hg/ui-native';

import { Router } from './src/navigation/Router';

export default function App(): React.ReactElement {
  React.useEffect(() => {
    // Unmapped enum values (halal states, error codes) report rather than crash. In this scaffold
    // we log them; a real build would forward to telemetry.
    setClientErrorReporter((code) => {
      // eslint-disable-next-line no-console
      console.warn('[hg-customer] client error reported:', code);
    });
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider theme="customer" scheme="light">
        <StatusBar style="dark" />
        <Router />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
