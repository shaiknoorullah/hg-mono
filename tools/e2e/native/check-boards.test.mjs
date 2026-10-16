import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boardOf, check } from './check-boards.mjs';

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
