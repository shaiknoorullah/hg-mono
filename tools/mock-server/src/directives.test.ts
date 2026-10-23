/**
 * Injection directives (directives.ts): parsing, planning, and the running server.
 * `pnpm --filter @hg/mock-server test:unit`.
 */
import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { codeForStatus, parseDirective, planDirective, statusBody } from './directives.js';
import { FixtureStore } from './fixtures.js';

const store = new FixtureStore();

describe('parseDirective', () => {
  it('reads the four directives', () => {
    assert.deepEqual(parseDirective('@stall'), { kind: 'directive', directive: { kind: 'stall' } });
    assert.deepEqual(parseDirective('@reset'), { kind: 'directive', directive: { kind: 'reset' } });
    assert.deepEqual(parseDirective('@delay=2000'), { kind: 'directive', directive: { kind: 'delay', ms: 2000 } });
    assert.deepEqual(parseDirective('@status=503'), { kind: 'directive', directive: { kind: 'status', status: 503 } });
  });

  it('rejects an unknown directive with a message that lists the real ones', () => {
    const plan = parseDirective('@stal');
    assert.equal(plan.kind, 'invalid');
    assert.match((plan as { message: string }).message, /unknown directive: `@stal`.*`@stall`/);
  });

  it('rejects malformed arguments', () => {
    for (const token of ['@delay', '@delay=abc', '@delay=-5', '@delay=999999', '@status=200', '@status=99', '@status=600', '@status', '@stall=1', '@reset=now']) {
      assert.equal(parseDirective(token).kind, 'invalid', token);
    }
  });
});

describe('planDirective', () => {
  it('applies nothing unless the request asked for it', () => {
    assert.equal(planDirective('getOrder', undefined).kind, 'none');
    assert.equal(planDirective('getOrder', 'order_arrived').kind, 'none');
    assert.equal(planDirective('getOrder', 'getCurrentPrincipal=principal_admin').kind, 'none');
  });

  it('applies a directive to the one operation it names', () => {
    const map = 'getOrder=@stall,getCurrentPrincipal=principal_admin';
    assert.deepEqual(planDirective('getOrder', map), { kind: 'directive', directive: { kind: 'stall' } });
    assert.equal(planDirective('getCurrentPrincipal', map).kind, 'none');
    assert.equal(planDirective('listAddresses', map).kind, 'none');
  });

  it('keeps `=` and `,` inside the map working with an argument', () => {
    assert.deepEqual(planDirective('getOrder', 'getOrder=@delay=1500,listAddresses=@status=429'), {
      kind: 'directive',
      directive: { kind: 'delay', ms: 1500 },
    });
    assert.deepEqual(planDirective('listAddresses', 'getOrder=@delay=1500,listAddresses=@status=429'), {
      kind: 'directive',
      directive: { kind: 'status', status: 429 },
    });
  });

  it('refuses a directive that names no operation, for every operation', () => {
    for (const requested of ['@stall', '@delay=100', 'order_arrived,@reset']) {
      assert.equal(planDirective('getOrder', requested).kind, 'invalid', requested);
      assert.equal(planDirective('listAddresses', requested).kind, 'invalid', requested);
    }
  });

  it('refuses an unknown directive for the operation it names', () => {
    assert.equal(planDirective('getOrder', 'getOrder=@hang').kind, 'invalid');
  });
});

describe('FixtureStore.resolve with a directive in the map', () => {
  it('answers the normal fixture, and does not call the directive an unknown scenario', () => {
    const result = store.resolve('getOrder', 'getOrder=@delay=500');
    assert.equal(result.fixture?.scenario, store.defaultFor('getOrder'));
    assert.equal(result.source, 'default');
    assert.equal(result.warning, undefined);
  });

  it('still serves the scenario a bare name picks beside a directive', () => {
    const result = store.resolve('getOrder', 'order_arrived,listAddresses=@stall');
    assert.equal(result.fixture?.scenario, 'order_arrived');
  });
});

describe('statusBody', () => {
  it('uses the contract fixture for a status when one exists', () => {
    const { body, scenario } = statusBody(store, 'login', 429, 'REQ');
    assert.ok(scenario);
    assert.deepEqual(body, store.get(scenario)!.payload);
  });

  it('prefers a fixture registered for the operation over a generic one', () => {
    const { scenario } = statusBody(store, 'refreshSession', 401, 'REQ');
    assert.ok(scenario);
    assert.ok(store.get(scenario)!.operations.length === 0 || store.get(scenario)!.operations.includes('refreshSession'));
  });

  it('falls back to a minimal valid envelope when no fixture has the status', () => {
    const { body, scenario } = statusBody(store, 'getOrder', 599, 'REQ');
    assert.equal(scenario, undefined);
    assert.deepEqual(Object.keys((body as { error: object }).error).sort(), ['code', 'message', 'request_id']);
    assert.equal((body as { error: { code: string } }).error.code, 'INTERNAL_ERROR');
    assert.equal((body as { error: { request_id: string } }).error.request_id, 'REQ');
  });

  it('maps statuses to codes in the contract set', () => {
    assert.equal(codeForStatus(429), 'RATE_LIMITED');
    assert.equal(codeForStatus(504), 'TIMEOUT');
    assert.equal(codeForStatus(418), 'VALIDATION_FAILED');
  });
});

describe('the running server', () => {
  let child: ChildProcess;
  let base = '';

  before(async () => {
    const port = await new Promise<number>((resolve) => {
      const probe = createServer().listen(0, () => {
        const { port: free } = probe.address() as { port: number };
        probe.close(() => resolve(free));
      });
    });
    const root = fileURLToPath(new URL('..', import.meta.url));
    child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: root,
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
      stdio: 'ignore',
    });
    base = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        if ((await fetch(`${base}/__mock/health`)).ok) return;
      } catch {
        // not listening yet
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('the mock server did not start');
  });

  after(() => {
    child.kill();
  });

  const get = (path: string, scenario?: string, signal?: AbortSignal) =>
    fetch(`${base}${path}`, { headers: scenario ? { 'X-Mock-Scenario': scenario } : {}, signal });

  it('echoes the frozen clock on every contract response and on health', async () => {
    const frozen = store.manifest.frozen_clock!;
    assert.equal((await get('/v1/orders/any')).headers.get('x-mock-frozen-clock'), frozen);
    const health = (await (await fetch(`${base}/__mock/health`)).json()) as { data: { frozen_clock: string } };
    assert.equal(health.data.frozen_clock, frozen);
  });

  it('answers normally, with no directive header, when none is asked for', async () => {
    const res = await get('/v1/orders/any', 'getOrder=order_arrived');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-mock-directive'), null);
  });

  it('@status answers with the error envelope', async () => {
    const res = await get('/v1/orders/any', 'getOrder=@status=503');
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('x-mock-directive'), 'status=503');
    const body = (await res.json()) as { error: { code: string; message: string; request_id: string } };
    assert.ok(body.error.code && body.error.message && body.error.request_id);
  });

  it('@delay answers the normal fixture late', async () => {
    const plain = await (await get('/v1/orders/any', 'getOrder=order_arrived')).json();
    const start = Date.now();
    const res = await get('/v1/orders/any', 'getOrder=@delay=400,listAddresses=@status=500');
    const elapsed = Date.now() - start;
    assert.equal(res.status, 200);
    assert.ok(elapsed >= 380, `answered after ${elapsed} ms`);
    assert.equal(res.headers.get('x-mock-directive'), 'delay=400');
    assert.equal(typeof ((await res.json()) as { data: unknown }).data, typeof (plain as { data: unknown }).data);
  });

  it('@stall never answers, and only for the operation it names', async () => {
    const stalled = get('/v1/orders/any', 'getOrder=@stall', AbortSignal.timeout(600));
    await assert.rejects(stalled);
    assert.equal((await get('/v1/auth/me', 'getOrder=@stall')).status, 200);
  });

  it('@reset drops the connection with no response', async () => {
    await assert.rejects(get('/v1/orders/any', 'getOrder=@reset'));
    assert.equal((await get('/v1/orders/any')).status, 200);
  });

  it('an unknown or unaddressed directive is a 400 that says why', async () => {
    for (const scenario of ['getOrder=@hang', '@stall']) {
      const res = await get('/v1/orders/any', scenario);
      assert.equal(res.status, 400, scenario);
      const body = (await res.json()) as { error: { code: string; message: string } };
      assert.equal(body.error.code, 'VALIDATION_FAILED');
      assert.match(body.error.message, /@/);
    }
  });
});
