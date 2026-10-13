/**
 * `renderRedesign(ui, { scheme })`: render inside the rider theme in light or dark, the way the
 * redesigned app does. Every screen test runs both schemes (`describe.each(SCHEMES)`).
 *
 * Test files still mock `react-native-safe-area-context` themselves (jest hoisting):
 *   jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
 */
import * as React from 'react';
import { render, type RenderOptions } from '@testing-library/react-native';

import { ThemeProvider } from '../ds';
import { Navigator, type NavigatorProps } from '../nav/Navigator';

export const SCHEMES = ['light', 'dark'] as const;
export type Scheme = (typeof SCHEMES)[number];

export interface RedesignRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  scheme?: Scheme;
  /** Wrap in the redesign navigator (for screens that call `useNav`). */
  nav?: Omit<NavigatorProps, 'children'> | true;
}

export function renderRedesign(ui: React.ReactElement, { scheme = 'light', nav, ...rest }: RedesignRenderOptions = {}) {
  const navProps = nav === true ? {} : nav;
  const wrapped = navProps ? <Navigator {...navProps}>{ui}</Navigator> : ui;
  return render(
    <ThemeProvider theme="rider" scheme={scheme}>
      {wrapped}
    </ThemeProvider>,
    rest,
  );
}
