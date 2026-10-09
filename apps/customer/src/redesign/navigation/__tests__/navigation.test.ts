import { fromLegacy, toLegacy } from '../LegacyBridge';
import { routeForUrl } from '../deepLinks';
import { canGoBack, currentRoute, initialNavState, reduceNav } from '../state';

describe('tab stacks', () => {
  it('starts on Home and keeps each tab its own stack', () => {
    let s = initialNavState();
    expect(currentRoute(s)).toEqual({ name: 'home' });
    s = reduceNav(s, { type: 'push', route: { name: 'restaurant', restaurantId: 'r1' } });
    s = reduceNav(s, { type: 'selectTab', tab: 'orders' });
    expect(currentRoute(s)).toEqual({ name: 'orders' });
    s = reduceNav(s, { type: 'selectTab', tab: 'home' });
    expect(currentRoute(s)).toEqual({ name: 'restaurant', restaurantId: 'r1' });
    expect(canGoBack(s)).toBe(true);
  });

  it('pressing the active tab returns to its root', () => {
    let s = initialNavState();
    s = reduceNav(s, { type: 'push', route: { name: 'cart' } });
    s = reduceNav(s, { type: 'selectTab', tab: 'home' });
    expect(currentRoute(s)).toEqual({ name: 'home' });
  });

  it('opens a route on the tab it belongs to', () => {
    const s = reduceNav(initialNavState(), { type: 'open', route: { name: 'tracking', orderId: 'o1' } });
    expect(s.tab).toBe('orders');
    expect(s.stacks.orders).toEqual([{ name: 'orders' }, { name: 'tracking', orderId: 'o1' }]);
  });

  it('lands on tracking after sign-in with Back to Home (next_route ORDER_TRACKING)', () => {
    const s = initialNavState({ name: 'tracking', orderId: 'o1' });
    expect(currentRoute(s)).toEqual({ name: 'tracking', orderId: 'o1' });
    const back = reduceNav(s, { type: 'back' });
    expect(currentRoute(back)).toEqual({ name: 'orders' });
  });
});

describe('deep links', () => {
  it.each([
    ['hgcustomer://verify-email?token=abc', { name: 'emailVerify', token: 'abc' }],
    ['hgcustomer://restaurant/a74bdb39-6440', { name: 'restaurant', restaurantId: 'a74bdb39-6440' }],
    ['hgcustomer://order/c622bd1b', { name: 'tracking', orderId: 'c622bd1b' }],
    ['hgcustomer://verify-email', null],
    ['https://example.com/order/1', null],
    ['hgcustomer://somewhere', null],
  ])('%s', (url, route) => {
    expect(routeForUrl(url)).toEqual(route);
  });
});

describe('legacy fallback bridge', () => {
  it('translates legacy routes into the redesign routes', () => {
    expect(fromLegacy({ name: 'discovery' })).toEqual({ name: 'home' });
    expect(fromLegacy({ name: 'notifications' })).toEqual({ name: 'home' });
    expect(fromLegacy({ name: 'profile' })).toEqual({ name: 'account' });
    expect(fromLegacy({ name: 'rateOrder', orderId: 'o' })).toEqual({ name: 'receipt', orderId: 'o' });
    expect(fromLegacy({ name: 'checkout' })).toEqual({ name: 'checkout' });
  });

  it('gives each redesign route a legacy screen', () => {
    expect(toLegacy({ name: 'home' })).toEqual({ name: 'discovery' });
    expect(toLegacy({ name: 'certificate', restaurantId: 'r' })).toEqual({ name: 'restaurant', restaurantId: 'r' });
    expect(toLegacy({ name: 'account' })).toEqual({ name: 'profile' });
    expect(toLegacy({ name: 'tracking', orderId: 'o' })).toEqual({ name: 'tracking', orderId: 'o' });
  });
});

describe('landing on another tab (WP1: signed in with an order on the way)', () => {
  it('puts tracking above Home, so Back goes to Home', () => {
    let s = initialNavState({ name: 'tracking', orderId: 'o1' }, 'home');
    expect(s.tab).toBe('home');
    expect(currentRoute(s)).toEqual({ name: 'tracking', orderId: 'o1' });
    expect(canGoBack(s)).toBe(true);
    s = reduceNav(s, { type: 'back' });
    expect(currentRoute(s)).toEqual({ name: 'home' });
  });
});
