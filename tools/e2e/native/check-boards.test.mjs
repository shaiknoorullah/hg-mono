import assert from 'node:assert/strict';
import { test } from 'node:test';
import { APPS, boardOf, check, manifestBoards, shotsIn } from './check-boards.mjs';

const reason = 'No flow reaches this state, and the reason is written out in full.';
const shot = (name) => ({ shot: name, file: 'customer/redesign/x.yaml', line: 1 });
const boards = ['sign-in/Main', 'sign-in/Code-dark', 'cart-checkout/Cart-empty'];

test('a capture name is read the way the diff reads it', () => {
  assert.equal(boardOf('design--sign-in--Main'), 'sign-in/Main');
  assert.equal(boardOf('design--cart-checkout--Cart-empty'), 'cart-checkout/Cart-empty');
  assert.equal(boardOf('redesign-wp1-02-invalid'), null);
});

test('every board is captured or unpairable with a reason, and nothing is stale', () => {
  const rules = [[/-dark$/, reason], [/^cart-checkout\//, reason]];
  assert.deepEqual(check([shot('design--sign-in--Main')], rules, boards).problems, []);
});

test('each way the two can disagree is reported', () => {
  const rules = [[/-dark$/, reason], [/^never\//, reason], [/^sign-in\/Main$/, reason], [/^cart-checkout\//, 'too short']];
  const text = check([shot('design--sign-in--Main'), shot('design--sign-in--Main'), shot('design--sign-in--Typo'), shot('oops')], rules, boards).problems.join('\n');
  assert.match(text, /captured twice/);
  assert.match(text, /sign-in\/Typo is not a board/);
  assert.match(text, /"oops" is not a capture name/);
  assert.match(text, /yet customer-boards.mjs entry 2 declares it unpairable/);
  assert.match(text, /entry 3 .* the reason is missing or too short/);
  assert.match(text, /entry 1 .* matches no board/);
  assert.match(check([], [[/-dark$/, reason]], boards).problems.join('\n'), /sign-in\/Main: no flow captures it/);
});

test('without the branch only the flows and the reasons are checked', () => {
  assert.deepEqual(check([shot('design--sign-in--Main')], [[/-dark$/, reason]], null).problems, []);
});

test('each native app\'s own flows and boards file agree, with or without the branch', () => {
  for (const [app, { flows, rules, file }] of Object.entries(APPS)) {
    const { problems, paired } = check(shotsIn(flows), rules, null, { file, app });
    assert.deepEqual(problems, [], `${app}: ${problems.join('; ')}`);
    assert.ok(paired.size > 0, `${app} captures at least one board`);
  }
});

test('the messages name the app\'s own boards file and canvases folder', () => {
  const text = check([shot('design--sign-in--Typo')], [], boards, { file: 'rider-boards.mjs', app: 'rider' }).problems.join('\n');
  assert.match(text, /canvases\/rider\/sign-in\/project\/Typo\.dc\.html/);
  assert.match(text, /rider-boards\.mjs gives no reason/);
});

test('a board listed in the manifest is accounted for without a flow or a reason', () => {
  const { problems, listed } = check([shot('design--sign-in--Main')], [[/^cart-checkout\//, reason]], boards, { manifest: ['sign-in/Code-dark'] });
  assert.deepEqual(problems, []);
  assert.deepEqual([...listed], ['sign-in/Code-dark']);
});

test('a manifest entry whose board does not exist fails', () => {
  const text = check([shot('design--sign-in--Main')], [[/-dark$/, reason], [/^cart-checkout\//, reason]], boards, { manifest: ['sign-in/Typo'], app: 'rider' }).problems.join('\n');
  assert.match(text, /boards\/rider\.json: sign-in\/Typo is not a board on the canvases branch \(canvases\/rider\/sign-in\/project\/Typo\.dc\.html\)/);
});

test('a manifest entry that a flow also captures fails', () => {
  const text = check([shot('design--sign-in--Main')], [[/-dark$/, reason], [/^cart-checkout\//, reason]], boards, { manifest: ['sign-in/Main'] }).problems.join('\n');
  assert.match(text, /boards\/customer\.json: sign-in\/Main is listed, yet a flow captures it/);
});

test('a manifest entry that is also declared unpairable fails', () => {
  const text = check([shot('design--sign-in--Main')], [[/-dark$/, reason], [/^cart-checkout\//, reason]], boards, { manifest: ['sign-in/Code-dark'].concat('cart-checkout/Cart-empty') }).problems.join('\n');
  assert.match(text, /sign-in\/Code-dark is listed, yet customer-boards\.mjs entry 0 declares it unpairable/);
  assert.match(text, /cart-checkout\/Cart-empty is listed, yet customer-boards\.mjs entry 1 declares it unpairable/);
});

test('a manifest entry listed twice fails, with or without the branch', () => {
  assert.match(check([], [], null, { manifest: ['a/B', 'a/B'] }).problems.join('\n'), /a\/B is listed twice/);
});

test('a board nobody accounts for names the manifest as a way out', () => {
  assert.match(check([], [], ['sign-in/Main']).problems.join('\n'), /boards\/customer\.json does not list it/);
});

test('the manifest files exist, are arrays of { board } and agree with the flows and reasons', () => {
  for (const [app, { flows, rules, file }] of Object.entries(APPS)) {
    const manifest = manifestBoards(app);
    const { problems } = check(shotsIn(flows), rules, null, { file, app, manifest });
    assert.deepEqual(problems, [], `${app}: ${problems.join('; ')}`);
  }
});
