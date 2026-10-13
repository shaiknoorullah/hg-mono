import assert from 'node:assert/strict';
import test from 'node:test';
import { assertFictionalPhone, classifyEnvironment, fictionalLines, fictionalPhone } from './guard.mjs';
import * as logs from './logs.mjs';
import { redact } from './redact.mjs';

test('fictional numbers are the 555 exchange, lines 0100 through 0199', () => {
  assert.equal(fictionalPhone('416', 100), '+14165550100');
  assert.equal(fictionalPhone('647', '199'), '+16475550199');
  assertFictionalPhone('+14375550142');
  assert.deepEqual(fictionalLines(3, 0), ['0100', '0101', '0102']);
  assert.equal(fictionalLines(2, 99)[1], '0100');
});

test('any other phone is refused before a sign-in request', () => {
  const refused = [
    '+14165550200',
    '+14162000100',
    '+14165550099',
    '+15550100100',
    '4165550100',
    '',
  ];
  for (const phone of refused) {
    assert.throws(() => assertFictionalPhone(phone), { code: 'PHONE_NOT_FICTIONAL' });
  }
  assert.throws(() => fictionalPhone('416', 200), { code: 'PHONE_NOT_FICTIONAL' });
  assert.throws(() => fictionalPhone('55', 100), { code: 'PHONE_NOT_FICTIONAL' });
});

test('only local and staging may continue', () => {
  assert.equal(classifyEnvironment('local'), 'local');
  assert.equal(classifyEnvironment('staging'), 'staging');
  assert.throws(() => classifyEnvironment('production'), { code: 'ENV_REFUSED' });
  assert.throws(() => classifyEnvironment('prod'), { code: 'ENV_REFUSED' });
  assert.throws(() => classifyEnvironment(''), { code: 'ENV_UNKNOWN' });
  assert.throws(() => classifyEnvironment(undefined), { code: 'ENV_UNKNOWN' });
});

test('webhook and restricted keys are redacted', () => {
  const samples = [`${'whsec'}_abc123`, `${'rk_test'}_abc123`, `${'rk_live'}_abc123`];
  for (const sample of samples) {
    assert.equal(redact(sample), '[redacted]');
    assert.equal(redact({ note: `prefix ${sample} suffix` }).note, '[redacted]');
  }
});

test('the server stripe helper is gone', () => {
  assert.equal(logs.remoteStripeEnv, undefined);
});
