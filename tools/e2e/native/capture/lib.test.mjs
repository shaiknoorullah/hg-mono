// Unit tests for the pure parts of the native capture runner. `node --test tools/e2e/native/capture/lib.test.mjs`
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { APPS, captureName, captureUrl, crashLines, firstDifference, parseDevice, parseManifest, readCaptureLog, readManifest, scenarioProblem, screenOf, settle, shardOf, unknownNames } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..');

describe('the manifests in the repo', () => {
  const operationIds = new Set([...readFileSync(join(root, 'contracts', 'openapi.yaml'), 'utf8').matchAll(/^\s+operationId:\s*(\w+)\s*$/gm)].map((m) => m[1]));
  const fixtureNames = new Set(JSON.parse(readFileSync(join(root, 'contracts', 'fixtures', 'index.json'), 'utf8')).fixtures.map((f) => f.scenario));

  for (const app of Object.keys(APPS)) {
    it(`${app}: every entry is well formed and names an operation and a fixture the contract has`, () => {
      const { entries, problems } = readManifest(join(here, '..', 'boards', `${app}.json`), app);
      assert.deepEqual(problems, []);
      const unknown = entries.flatMap((e) => (e.scenario ? unknownNames(e.scenario, operationIds, fixtureNames).map((u) => `${e.board}: ${u}`) : []));
      assert.deepEqual(unknown, []);
      assert.equal(new Set(entries.map((e) => captureName(e.board))).size, entries.length, 'two entries would write one file');
    });
  }
  it('the operations and fixtures were read (so the test above is not vacuous)', () => {
    assert.ok(operationIds.has('getRiderDashboard') && operationIds.has('listRestaurants'));
    assert.ok(fixtureNames.has('rider_dashboard_on_delivery_pickup'));
  });
});

describe('parseManifest', () => {
  const ok = { board: 'shift-offers/HomeLoading', route: 'home', scenario: 'getRiderDashboard=@stall', device: 'dark-390-100' };
  const problemsOf = (...entries) => parseManifest(JSON.stringify(entries), 'rider').problems;

  it('accepts a sound entry, with and without the optional keys', () => {
    assert.deepEqual(problemsOf(ok), []);
    assert.deepEqual(problemsOf({ ...ok, params: { restaurantId: 'r1' }, clock: '2026-08-10T18:42:11.412Z', volatile: ['^\\d+:\\d\\d$'], note: 'why' }), []);
  });
  it('names the entry and the problem', () => {
    assert.match(problemsOf({ ...ok, board: 'HomeLoading' })[0], /entry 0 \(HomeLoading\): "board" must be "<area>\/<Board>"/);
    assert.match(problemsOf({ ...ok, route: '' })[0], /"route" must be the name of a route/);
    assert.match(problemsOf({ ...ok, params: [] })[0], /"params" must be an object/);
    assert.match(problemsOf({ ...ok, clock: 'tomorrow' })[0], /"clock" must be an ISO date/);
    assert.match(problemsOf({ ...ok, volatile: ['('] })[0], /invalid regular expression/);
    assert.match(problemsOf({ ...ok, colour: 'red' })[0], /unknown key "colour"/);
  });
  it('refuses what is not a list of objects', () => {
    assert.match(parseManifest('{}', 'rider').problems[0], /must be a JSON array/);
    assert.match(parseManifest('[1]', 'rider').problems[0], /is not an object/);
    assert.match(parseManifest('nope', 'rider').problems[0], /is not JSON/);
  });
});

describe('device', () => {
  it('reads the theme and refuses the passes that are not built yet', () => {
    assert.deepEqual(parseDevice('dark-390-100'), { ok: true, theme: 'dark' });
    assert.deepEqual(parseDevice('light-390-100'), { ok: true, theme: 'light' });
    assert.equal(parseDevice('dark-360-100').ok, false);
    assert.equal(parseDevice('light-390-200').ok, false);
    assert.equal(parseDevice(undefined).ok, false);
  });
});

describe('scenarios', () => {
  it('accepts operation=scenario pairs and the four directives', () => {
    for (const s of ['getOrder=order_arrived', 'a=@stall', 'a=@reset', 'a=@delay=2000', 'a=@status=503', 'listRestaurants=@status=401,refreshSession=error_session_revoked']) assert.equal(scenarioProblem(s), null, s);
  });
  it('refuses a bare name, which would apply to every operation, and a malformed directive', () => {
    assert.match(scenarioProblem('order_arrived'), /not operation=scenario/);
    assert.match(scenarioProblem('a=@hang'), /neither a scenario name nor a directive/);
    assert.match(scenarioProblem('a=@status=200'), /neither a scenario name nor a directive/);
    assert.match(scenarioProblem('a=@delay=abc'), /neither a scenario name nor a directive/);
    assert.match(scenarioProblem(''), /non-empty/);
  });
  it('finds an operation or a fixture the contract lacks', () => {
    const ops = new Set(['getOrder']);
    const fixtures = new Set(['order_arrived']);
    assert.deepEqual(unknownNames('getOrder=order_arrived,getOrder=@stall', ops, fixtures), []);
    assert.deepEqual(unknownNames('getOrdr=order_arrived', ops, fixtures), ['operation "getOrdr" is not in contracts/openapi.yaml']);
    assert.deepEqual(unknownNames('getOrder=order_arived', ops, fixtures), ['scenario "order_arived" is not a fixture in contracts/fixtures/index.json']);
  });
});

describe('captureUrl', () => {
  it('builds the link the entry reads, with every value recoverable', () => {
    const entry = { board: 'shift-offers/HomeLoading', route: 'home', params: { assignmentId: 'a 1' }, scenario: 'getRiderDashboard=@stall,x=y', clock: '2026-08-10T18:42:11.412Z' };
    const url = captureUrl('rider', entry);
    assert.ok(url.startsWith('hgrider://__capture?'));
    assert.ok(!url.includes("'"), 'a quote would end the shell quoting the runner puts the link in');
    const q = new URL(url.replace('hgrider://', 'http://')).searchParams;
    assert.equal(q.get('board'), entry.board);
    assert.equal(q.get('route'), 'home');
    assert.deepEqual(JSON.parse(q.get('params')), entry.params);
    assert.equal(q.get('scenario'), entry.scenario);
    assert.equal(q.get('clock'), entry.clock);
  });
  it('leaves out what an entry does not have, and uses the customer scheme for the customer', () => {
    assert.equal(captureUrl('customer', { board: 'a/B', route: 'home' }), 'hgcustomer://__capture?board=a%2FB&route=home');
  });
  it('names the file after the board, as the design diff pairs it', () => {
    assert.equal(captureName('shift-offers/HomeLoading'), 'design--shift-offers--HomeLoading');
    assert.throws(() => captureName('HomeLoading'), /not a board id/);
  });
});

describe('shardOf', () => {
  const entries = [0, 1, 2, 3, 4, 5, 6];
  it('deals the entries out, each to one shard', () => {
    const parts = [1, 2, 3].map((i) => shardOf(entries, i, 3));
    assert.deepEqual(parts, [[0, 3, 6], [1, 4], [2, 5]]);
    assert.deepEqual(shardOf(entries, 1, 1), entries);
  });
  it('refuses a shard that does not exist', () => {
    assert.throws(() => shardOf(entries, 0, 2), /shard must be i\/n/);
    assert.throws(() => shardOf(entries, 3, 2), /shard must be i\/n/);
  });
});

describe('the app log', () => {
  const line = (m) => `I/ReactNativeJS( 4242): ${m}`;
  it('says waiting until the app logs the board, then opened', () => {
    assert.deepEqual(readCaptureLog(line('Running "main"'), 'a/B'), { state: 'waiting' });
    assert.deepEqual(readCaptureLog([line('Running "main"'), line("[capture] a/B: {\"name\":\"home\"} · x=y")].join('\n'), 'a/B'), { state: 'opened' });
  });
  it('does not take another board for this one', () => {
    assert.deepEqual(readCaptureLog(line('[capture] a/Bc: {}'), 'a/B'), { state: 'waiting' });
  });
  it('reports a refusal with the entry\'s reason', () => {
    assert.deepEqual(readCaptureLog(line('[capture] nothing opened. a/B: there is no route called "nowhere"'), 'a/B'), { state: 'refused', why: 'a/B: there is no route called "nowhere"' });
  });
  it('picks out a crash, not a handled error', () => {
    const log = ['E/AndroidRuntime( 1): FATAL EXCEPTION: mqt_native_modules', line('Error: Network request failed')].join('\n');
    assert.equal(crashLines(log).length, 1);
    assert.match(crashLines(log)[0], /FATAL EXCEPTION/);
  });
});

describe('the settled screen', () => {
  const APP = 'com.halalgoes.rider.dev';
  const node = (pkg, text, bounds, extra = '') => `<node index="0" text="${text}" resource-id="" class="android.widget.TextView" package="${pkg}" content-desc="${extra}" bounds="${bounds}"/>`;
  const dump = (...nodes) => `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0"><node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="${APP}" content-desc="" bounds="[0,0][1170,2532]">${nodes.join('')}</node></hierarchy>`;

  it('ignores the status bar and every window that is not the app', () => {
    const a = screenOf(dump(node(APP, 'Home', '[0,0][100,50]'), node('com.android.systemui', '5:43', '[0,0][10,10]')), APP);
    const b = screenOf(dump(node(APP, 'Home', '[0,0][100,50]'), node('com.android.systemui', '5:44', '[0,0][10,10]')), APP);
    assert.ok(a);
    assert.equal(a, b);
  });
  it('tells two screens apart by text and by place', () => {
    const base = screenOf(dump(node(APP, 'Home', '[0,0][100,50]')), APP);
    assert.notEqual(base, screenOf(dump(node(APP, 'Offline', '[0,0][100,50]')), APP));
    assert.notEqual(base, screenOf(dump(node(APP, 'Home', '[0,0][100,60]')), APP));
  });
  it('blanks a countdown when the entry says it is volatile', () => {
    const at = (text, desc) => screenOf(dump(node(APP, text, '[0,0][100,50]', desc)), APP, ['^\\d+:\\d{2}$', '^\\d+ seconds']);
    assert.equal(at('0:28', '28 seconds left'), at('0:27', '27 seconds left'));
    assert.notEqual(at('0:28', '28 seconds left'), at('Gone', '28 seconds left'));
  });
  it('is null when the app has drawn nothing or the dump is not one', () => {
    assert.equal(screenOf(`<hierarchy><node text="" class="x" package="com.android.systemui" bounds="[0,0][1,1]"/></hierarchy>`, APP), null);
    assert.equal(screenOf('ERROR: could not get idle state.', APP), null);
  });
  it('names the first line that differs', () => {
    assert.equal(firstDifference('a\nb\nc', 'a\nX\nc'), 'line 2: "b" then "X"');
    assert.equal(firstDifference('a', 'a'), 'no difference');
  });
});

describe('settle', () => {
  /** A scripted screen reader and a clock that only moves when the code sleeps. */
  function rig(script) {
    let t = 0;
    let i = 0;
    return {
      read: async () => {
        const next = script[Math.min(i++, script.length - 1)];
        if (next instanceof Error) throw next;
        return next;
      },
      sleep: async (ms) => {
        t += ms;
      },
      now: () => t,
    };
  }

  it('returns once the screen is the same three reads running', async () => {
    const r = await settle({ ...rig(['splash', 'home', 'home', 'home']) });
    assert.deepEqual(r, { ok: true, screen: 'home', reads: 4 });
  });
  it('starts counting again when the screen changes in between', async () => {
    const r = await settle({ ...rig(['a', 'a', 'b', 'b', 'b']) });
    assert.deepEqual(r, { ok: true, screen: 'b', reads: 5 });
  });
  it('does not settle on a screen it could not read', async () => {
    const r = await settle({ ...rig([null, null, 'home', 'home', 'home']) });
    assert.equal(r.ok, true);
    assert.equal(r.reads, 5);
  });
  it('gives up when the screen never stops changing, and says where it changed', async () => {
    let n = 0;
    const base = rig(['x']);
    const r = await settle({ ...base, read: async () => `tick ${n++}`, timeoutMs: 5_000 });
    assert.equal(r.ok, false);
    assert.match(r.why, /still changing after 5 s/);
    assert.match(r.why, /last change at line 1: "tick \d+" then "tick \d+"/);
  });
  it('gives up when the hierarchy cannot be read at all, with the device\'s reason', async () => {
    const r = await settle({ ...rig([new Error('uiautomator dump did not write /sdcard/x: could not get idle state')]), timeoutMs: 3_000 });
    assert.equal(r.ok, false);
    assert.match(r.why, /showed nothing the hierarchy could read for 3 s \(uiautomator dump did not write/);
  });
  it('waits by sleeping between reads, not for a fixed time', async () => {
    const base = rig(['a', 'a', 'a']);
    const slept = [];
    const r = await settle({ ...base, sleep: async (ms) => { slept.push(ms); await base.sleep(ms); }, intervalMs: 700 });
    assert.equal(r.ok, true);
    assert.deepEqual(slept, [700, 700]);
  });
});
