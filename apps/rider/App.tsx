/**
 * Halal Goes — Rider app root.
 *
 * A minimal, bootable scaffold: one provider, one smoke screen. The whole tree renders under
 * the RIDER register (`theme="rider"`) in the light scheme, so every `@hg/ui-native` component
 * below picks up the field-register density and 56pt touch targets. Nothing forks on the value —
 * the register does the work.
 */
import * as React from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ThemeProvider } from '@hg/ui-native';

import { NavProvider } from './src/nav';
import { Router } from './src/Router';

export default function App(): React.ReactElement {
  return (
    <SafeAreaProvider>
      <ThemeProvider theme="rider" scheme="light">
        <StatusBar style="dark" />
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
          <View style={{ flex: 1 }}>
            <NavProvider>
              <Router />
            </NavProvider>
          </View>
        </SafeAreaView>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
