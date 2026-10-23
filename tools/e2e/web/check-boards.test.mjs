import assert from 'node:assert/strict';
import { test } from 'node:test';
import { declarations } from './check-boards.mjs';

const boards = new Set(['admin/orders/OrdersEmpty', 'admin/orders/OrderDetailCreated', 'admin/orders/CancelCreated', 'restaurant/onboarding/OnbTop']);

test('a board id written out in full is a declaration', () => {
  const d = declarations(`await capture(page, 'admin/orders/OrdersEmpty');`, boards);
  assert.deepEqual(d.literals, ['admin/orders/OrdersEmpty']);
});

test('a board id built from a prefix constant is a declaration, and a misspelling of it is visible', () => {
  const src = "const OR = 'admin/orders/';\nawait capture(page, { 1440: `${OR}OrdersEmpty` });\nawait capture(page, { 1440: `${OR}OrdersEmtpy` });";
  const d = declarations(src, boards);
  assert.deepEqual(d.constants, ['admin/orders/OrdersEmpty', 'admin/orders/OrdersEmtpy']);
  assert.equal(d.constants.filter((id) => !boards.has(id)).length, 1);
});

test('a board id built from a constant and a variable counts the names the spec tabulates', () => {
  const src = [
    "const OR = 'admin/orders/';",
    "const DETAIL = [['OrderDetailCreated', 'fixture_a'], ['CancelCreated', 'fixture_b'], ['NotABoardName', 'fixture_c']];",
    'for (const [board] of DETAIL) await capture(page, { 1440: `${OR}${board}` });',
  ].join('\n');
  const d = declarations(src, boards);
  assert.deepEqual(d.tables.sort(), ['admin/orders/CancelCreated', 'admin/orders/OrderDetailCreated']);
  assert.deepEqual(d.problems, []);
});

test('a variable-built id with no board of its area among the names is reported rather than counted as nothing', () => {
  const src = "const OR = 'admin/orders/';\nawait capture(page, `${OR}${board}`);";
  const d = declarations(src, boards);
  assert.equal(d.tables.length, 0);
  assert.equal(d.problems.length, 1);
});

test('a prefix constant that is never used declares nothing', () => {
  const d = declarations("const ONB = 'restaurant/onboarding/';", boards);
  assert.deepEqual([d.literals, d.constants, d.tables, d.problems], [[], [], [], []]);
});
