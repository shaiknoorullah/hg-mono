/**
 * The redesigned rider app root (behind `EXPO_PUBLIC_HG_REDESIGN`, see `flag.ts`).
 *
 * Light and dark follow the phone (rider manifest: no in-app switch): `ThemeProvider` gets no
 * `scheme`, so it reads `useColorScheme`, and the status bar follows the same answer.
 */
import * as React from 'react';
import { useColorScheme } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useHgFonts } from '@hg/ui-native/fonts';

import { ThemeProvider } from './ds';
import { outbox } from './data/outbox';
import { SessionGate } from './session/Session';
import './screens';

export function RedesignRoot({ children }: { children: React.ReactNode }): React.ReactElement {
  const scheme = useColorScheme();
  return (
    <SafeAreaProvider>
      <ThemeProvider theme="rider">
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
  React.useEffect(() => outbox.start(), []);
  if (!fontsLoaded) return null;
  return (
    <RedesignRoot>
      <SessionGate />
    </RedesignRoot>
  );
}
