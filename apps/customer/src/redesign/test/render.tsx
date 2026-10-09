/**
 * `renderRedesign(ui, { scheme })`: render a redesigned screen the way the app does, in light or
 * dark, with the safe area and (optionally) a navigation context whose calls are recorded.
 */
import * as React from 'react';
import { render, type RenderOptions } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider } from '../ds';
import { NavContext, type Nav } from '../navigation/context';
import type { Route } from '../navigation/routes';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

export interface NavSpy extends Nav {
  log: Array<{ action: string; route?: Route; tab?: string }>;
}

export function navSpy(current: Route = { name: 'home' }): NavSpy {
  const log: NavSpy['log'] = [];
  return {
    current,
    tab: 'home',
    canGoBack: true,
    log,
    push: (route) => log.push({ action: 'push', route }),
    replace: (route) => log.push({ action: 'replace', route }),
    back: () => log.push({ action: 'back' }),
    selectTab: (tab) => log.push({ action: 'selectTab', tab }),
    open: (route) => log.push({ action: 'open', route }),
    reset: (route) => log.push({ action: 'reset', route }),
  };
}

export function renderRedesign(
  ui: React.ReactElement,
  { scheme = 'light', nav, ...options }: { scheme?: 'light' | 'dark'; nav?: Nav } & RenderOptions = {},
) {
  const tree = (
    <SafeAreaProvider initialMetrics={METRICS}>
      <ThemeProvider theme="customer" scheme={scheme}>
        {nav ? <NavContext.Provider value={nav}>{ui}</NavContext.Provider> : ui}
      </ThemeProvider>
    </SafeAreaProvider>
  );
  return render(tree, options);
}
