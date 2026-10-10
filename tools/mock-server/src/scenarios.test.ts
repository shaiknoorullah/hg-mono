/**
 * How the mock picks one fixture per operation, and how a realtime script is moved to wall
 * clock. Runs against the real generated fixture set, so a renamed default or a missing
 * fixture fails here too. `pnpm --filter @hg/mock-server test`.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FixtureStore, parseScenarioRequest } from './fixtures.js';
import { restamp } from './ws.js';

const store = new FixtureStore();

describe('parseScenarioRequest', () => {
  it('reads nothing as no request', () => {
    assert.equal(parseScenarioRequest(undefined), undefined);
    assert.equal(parseScenarioRequest(''), undefined);
    assert.equal(parseScenarioRequest(' , '), undefined);
  });

  it('reads one bare name', () => {
    const request = parseScenarioRequest('order_arrived')!;
    assert.deepEqual(request.bare, ['order_arrived']);
    assert.equal(request.byOperation.size, 0);
  });

  it('reads a per-operation map mixed with bare names', () => {
    const request = parseScenarioRequest(
      ' getCurrentPrincipal=principal_admin , restaurant_order_queue_busy,getOrder = order_arrived',
    )!;
    assert.equal(request.byOperation.get('getCurrentPrincipal'), 'principal_admin');
    assert.equal(request.byOperation.get('getOrder'), 'order_arrived');
    assert.deepEqual(request.bare, ['restaurant_order_queue_busy']);
  });
});

describe('FixtureStore.resolve', () => {
  it('keeps the plain defaults for the operations batch 1 added fixtures to', () => {
    assert.equal(store.defaultFor('getCurrentPrincipal'), 'principal_customer');
    assert.equal(store.defaultFor('getRestaurantProfile'), 'restaurant_profile');
  });

  it('serves one bare name for every operation, warning when it is registered elsewhere', () => {
    const own = store.resolve('getCurrentPrincipal', 'principal_admin');
    assert.equal(own.fixture?.scenario, 'principal_admin');
    assert.equal(own.source, 'scenario');
    assert.equal(own.warning, undefined);

    const other = store.resolve('getOrder', 'principal_admin');
    assert.equal(other.fixture?.scenario, 'principal_admin');
    assert.match(other.warning ?? '', /not registered for `getOrder`/);
  });

  it('reports an unknown bare name instead of serving anything', () => {
    const result = store.resolve('getOrder', 'order_does_not_exist');
    assert.equal(result.fixture, undefined);
    assert.equal(result.source, 'none');
    assert.match(result.warning ?? '', /unknown scenario `order_does_not_exist`/);
  });

  it('gives each operation its own fixture from a map', () => {
    const map = 'getCurrentPrincipal=principal_support_agent,listRestaurantOrders=restaurant_order_queue_empty';
    assert.equal(store.resolve('getCurrentPrincipal', map).fixture?.scenario, 'principal_support_agent');
    assert.equal(store.resolve('listRestaurantOrders', map).fixture?.scenario, 'restaurant_order_queue_empty');

    const unnamed = store.resolve('getOrder', map);
    assert.equal(unnamed.fixture?.scenario, 'order_preparing');
    assert.equal(unnamed.source, 'default');
    assert.equal(unnamed.warning, undefined);
  });

  it('serves a pair even for a generic error registered for no operation', () => {
    const result = store.resolve('createOrder', 'createOrder=error_active_order_exists,getOrder=order_preparing');
    assert.equal(result.fixture?.scenario, 'error_active_order_exists');
    assert.equal(result.source, 'scenario');
  });

  it('uses a bare name in a list only for the operations it is registered for', () => {
    const list = 'principal_super_admin,restaurant_profile_account_suspended';
    assert.equal(store.resolve('getCurrentPrincipal', list).fixture?.scenario, 'principal_super_admin');
    assert.equal(
      store.resolve('getRestaurantProfile', list).fixture?.scenario,
      'restaurant_profile_account_suspended',
    );
    assert.equal(store.resolve('getOrder', list).source, 'default');
  });

  it('reports unknown names in a map and still answers the operation', () => {
    const result = store.resolve('getOrder', 'getCurrentPrincipal=principal_nobody');
    assert.equal(result.fixture?.scenario, 'order_preparing');
    assert.match(result.warning ?? '', /unknown scenario `principal_nobody`/);

    const paired = store.resolve('getCurrentPrincipal', 'getCurrentPrincipal=principal_nobody,x=y');
    assert.equal(paired.fixture, undefined);
    assert.equal(paired.source, 'none');
  });
});

describe('restamp', () => {
  it('moves every RFC 3339 UTC timestamp and nothing else', () => {
    const hour = 3_600_000;
    const data = {
      expires_at: '2026-08-10T18:45:11.412Z',
      deadline_at: '2026-08-10T18:45:11Z',
      expires_on: '2027-03-08',
      code: 'HG-A7K2-4M',
      total_cents: 4369,
      lines: [{ at: '2026-08-10T18:42:11.412Z', note: null }],
    };
    const moved = restamp(data, hour);
    assert.equal(moved.expires_at, '2026-08-10T19:45:11.412Z');
    assert.equal(moved.deadline_at, '2026-08-10T19:45:11.000Z');
    assert.equal(moved.expires_on, '2027-03-08');
    assert.equal(moved.code, 'HG-A7K2-4M');
    assert.equal(moved.total_cents, 4369);
    assert.equal(moved.lines[0]!.at, '2026-08-10T19:42:11.412Z');
    assert.equal(moved.lines[0]!.note, null);
    // The fixture itself is never mutated.
    assert.equal(data.expires_at, '2026-08-10T18:45:11.412Z');
  });

  it('keeps an offer countdown the length the script meant', () => {
    const script = store.get('realtime_restaurant_offer_one')!.payload as Array<{
      data: { expires_at: string };
      _delay_ms: number;
    }>;
    const frozen = Date.parse(store.manifest.frozen_clock!);
    const start = frozen + 5 * 24 * 3_600_000;
    const offered = restamp(script[0]!.data, start - frozen);
    assert.equal(Date.parse(offered.expires_at) - start, 180_000);
  });
});
