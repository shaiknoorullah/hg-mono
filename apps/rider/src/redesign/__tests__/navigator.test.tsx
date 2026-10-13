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

describe('a double tap never goes back twice', () => {
  it('two pops from the same screen in one frame remove that screen only', () => {
    act(() => nav.switchTab('earnings'));
    act(() => nav.push('testDetail', { id: 'a' }));
    act(() => nav.push('testDetail', { id: 'b' }));
    act(() => {
      expect(nav.pop()).toBe(true);
      expect(nav.pop()).toBe(true); // the screen that asked is gone: done, nothing more
    });
    expect(nav.current).toMatchObject({ name: 'testDetail', params: { id: 'a' } });
    expect(nav.stack).toHaveLength(2);
  });

  it('pops asked for by two different screens both happen', () => {
    act(() => nav.push('testDetail', { id: 'a' }));
    const fromA = nav;
    act(() => nav.push('testDetail', { id: 'b' }));
    const fromB = nav;
    act(() => {
      fromB.pop();
      fromA.pop();
    });
    expect(nav.current.name).toBe('home');
  });

  it('two Android Back presses in one frame pop once, and do not switch tab', () => {
    act(() => nav.switchTab('earnings'));
    act(() => nav.push('testDetail', { id: 'e1' }));
    act(() => {
      expect(handleBack(nav)).toBe(true);
      expect(handleBack(nav)).toBe(true);
    });
    expect(nav.tab).toBe('earnings');
    expect(nav.current.name).toBe('earnings');
  });

  it('a double tap inside a flow pops one step', () => {
    act(() => nav.openFlow('trip', { assignmentId: 'a-1' }));
    act(() => nav.push('testDetail', { id: 'hub' }));
    act(() => nav.push('testStep'));
    act(() => {
      nav.pop();
      nav.pop();
    });
    expect(nav.current).toMatchObject({ name: 'testDetail', params: { id: 'hub' } });
  });

  it('a late close from a flow that was replaced leaves the new flow open', () => {
    act(() => nav.openFlow('trip', { assignmentId: 'a-1' }));
    const old = nav;
    act(() => nav.openFlow('trip', { assignmentId: 'a-2' }));
    act(() => old.closeFlow());
    expect(nav.current).toMatchObject({ name: 'trip', params: { assignmentId: 'a-2' } });
    act(() => {
      nav.closeFlow();
      nav.closeFlow();
    });
    expect(nav.flow).toBeNull();
    expect(nav.current.name).toBe('home');
  });
});
