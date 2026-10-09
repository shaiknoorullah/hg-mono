/** WP0: three tabs keep their own stacks; flows cover the tabs; Android Back never drops a step. */
import * as React from 'react';
import { act, render } from '@testing-library/react-native';

import { Navigator, handleBack, useNav, type Nav } from '../nav/Navigator';
import { clearScreens, registerScreen } from '../nav/registry';

declare module '../nav/routes' {
  interface RedesignRoutes {
    testDetail: { id: string };
    testStep: undefined;
  }
}

let nav!: Nav;
function Grab() {
  nav = useNav();
  return null;
}

beforeEach(() => {
  clearScreens();
  render(
    <Navigator>
      <Grab />
    </Navigator>,
  );
});

it('starts on Home, and each tab keeps its own stack', () => {
  expect(nav.current.name).toBe('home');
  act(() => nav.switchTab('earnings'));
  act(() => nav.push('testDetail', { id: 'e1' }));
  act(() => nav.switchTab('account'));
  expect(nav.current.name).toBe('account');
  act(() => nav.switchTab('earnings'));
  expect(nav.current).toMatchObject({ name: 'testDetail', params: { id: 'e1' } });
});

it('tapping the current tab returns it to its root', () => {
  act(() => nav.push('testDetail', { id: 'x' }));
  act(() => nav.switchTab('home'));
  expect(nav.current.name).toBe('home');
});

it('a flow covers the tabs; push and pop act on the flow', () => {
  act(() => nav.openFlow('trip', { assignmentId: 'a-1' }));
  act(() => nav.push('testStep'));
  expect(nav.current.name).toBe('testStep');
  act(() => {
    nav.pop();
  });
  expect(nav.current.name).toBe('trip');
  act(() => nav.closeFlow());
  expect(nav.current.name).toBe('home');
});

it('Android Back: pops, then Home tab, then the OS; never closes a flow; swallowed on no-back screens', () => {
  act(() => nav.switchTab('earnings'));
  act(() => nav.push('testDetail', { id: 'e1' }));
  act(() => {
    expect(handleBack(nav)).toBe(true);
  });
  expect(nav.current.name).toBe('earnings');
  act(() => {
    expect(handleBack(nav)).toBe(true);
  });
  expect(nav.tab).toBe('home');
  expect(handleBack(nav)).toBe(false);

  act(() => nav.openFlow('trip', { assignmentId: 'a-1' }));
  act(() => {
    expect(handleBack(nav)).toBe(true);
  });
  expect(nav.current.name).toBe('trip');

  registerScreen('testStep', { component: () => null, back: 'none' });
  act(() => nav.push('testStep'));
  act(() => {
    expect(handleBack(nav)).toBe(true);
  });
  expect(nav.current.name).toBe('testStep');
});
