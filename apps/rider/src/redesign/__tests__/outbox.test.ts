/**
 * WP0: the outbox survives an app kill and replays in order with the original `occurred_at`
 * and Idempotency-Key; a 401 keeps everything; a refused replay is held and reported; proof of
 * delivery never queues.
 */
import { HgApiError, HgTransportError } from '@hg/api-client';

import { Outbox, type OutboxEntry, type Poster } from '../data/outbox';
import { memoryStore } from '../data/storage';
import { resetConnectivity } from '../data/connectivity';

const ASSIGNMENT = { id: 'a-1' } as never;
const offline = () => Promise.reject(new HgTransportError(new TypeError('Network request failed')));
const apiError = (status: number, code: string) =>
  Promise.reject(new HgApiError(status, { error: { code, message: code, request_id: 'r' } } as never));

function recorder(answers: Array<() => Promise<unknown>>): { post: Poster; sent: OutboxEntry[] } {
  const sent: OutboxEntry[] = [];
  const post: Poster = (entry) => {
    sent.push(entry);
    const next = answers.shift() ?? (() => Promise.resolve(ASSIGNMENT));
    return next() as never;
  };
  return { post, sent };
}

afterEach(() => resetConnectivity());

it('sends at once when the API answers, and queues nothing', async () => {
  const { post, sent } = recorder([]);
  const box = new Outbox(memoryStore(), post);
  const r = await box.send('a-1', { to_state: 'ARRIVED_AT_PICKUP' });
  expect(r.queued).toBe(false);
  expect(sent).toHaveLength(1);
  expect(box.snapshot()).toHaveLength(0);
});

it('queues a step on a transport failure, survives a kill, and replays in order with the original key and time', async () => {
  const store = memoryStore();
  const first = recorder([offline, offline]);
  const before = new Outbox(store, first.post);
  const a = await before.send('a-1', { to_state: 'ARRIVED_AT_PICKUP', occurred_at: '2026-10-10T14:00:00.000Z' });
  const b = await before.send('a-1', { to_state: 'PICKED_UP', occurred_at: '2026-10-10T14:05:00.000Z' });
  await before.drain();
  expect(a.queued && b.queued).toBe(true);
  // The second step queued behind the first: every try so far was the first step.
  expect(first.sent.map((e) => e.input.to_state)).toEqual(['ARRIVED_AT_PICKUP', 'ARRIVED_AT_PICKUP']);

  // The app is killed. A new process loads the same store.
  const second = recorder([]);
  const after = new Outbox(store, second.post);
  await after.drain();
  expect(second.sent.map((e) => e.input.to_state)).toEqual(['ARRIVED_AT_PICKUP', 'PICKED_UP']);
  expect(second.sent.map((e) => e.input.occurred_at)).toEqual(['2026-10-10T14:00:00.000Z', '2026-10-10T14:05:00.000Z']);
  expect(second.sent[0]!.id).toBe(first.sent[0]!.id); // same Idempotency-Key as the first try
  expect(after.snapshot()).toHaveLength(0);
});

it('a 401 during replay keeps every step for the next session', async () => {
  const store = memoryStore();
  const box = new Outbox(store, recorder([offline]).post);
  await box.send('a-1', { to_state: 'ARRIVED_AT_PICKUP' });
  const signedOut = new Outbox(store, recorder([() => apiError(401, 'SESSION_REVOKED')]).post);
  await signedOut.drain();
  expect(signedOut.snapshot()).toHaveLength(1);
  expect(signedOut.snapshot()[0]!.status).toBe('pending');
});

it('a replay the server refuses is held, reported once, and blocks the steps behind it until dismissed', async () => {
  const { post, sent } = recorder([offline, offline, () => apiError(422, 'VALIDATION_FAILED')]);
  const box = new Outbox(memoryStore(), post);
  const rejected: OutboxEntry[] = [];
  box.onRejected((e) => rejected.push(e));
  await box.send('a-1', { to_state: 'ARRIVED_AT_PICKUP' }); // offline → queued
  await box.send('a-1', { to_state: 'PICKED_UP' }); // queued behind; send() starts a drain
  await box.drain(); // joins that drain: still offline
  await box.drain(); // signal back: 422 on the first
  expect(rejected).toHaveLength(1);
  expect(rejected[0]!.input.to_state).toBe('ARRIVED_AT_PICKUP');
  expect(rejected[0]!.error?.code).toBe('VALIDATION_FAILED');
  const tries = sent.length;
  await box.drain(); // still blocked: nothing sent
  expect(sent.length).toBe(tries);
  await box.dismiss(rejected[0]!.id);
  await box.drain();
  expect(sent[sent.length - 1]!.input.to_state).toBe('PICKED_UP');
  expect(box.snapshot()).toHaveLength(0);
});

it('an API error on a direct send is thrown to the screen, not queued', async () => {
  const box = new Outbox(memoryStore(), recorder([() => apiError(409, 'INVALID_TRANSITION')]).post);
  await expect(box.send('a-1', { to_state: 'PICKED_UP' })).rejects.toBeInstanceOf(HgApiError);
  expect(box.snapshot()).toHaveLength(0);
});

it('DELIVERED never queues: proof goes with it', async () => {
  const box = new Outbox(memoryStore(), recorder([]).post);
  await expect(box.send('a-1', { to_state: 'DELIVERED' })).rejects.toThrow(/never queues/);
});

it('clearing an ended assignment drops only its steps', async () => {
  const box = new Outbox(memoryStore(), recorder([offline, offline]).post);
  await box.send('a-1', { to_state: 'ARRIVED_AT_PICKUP' });
  await box.send('a-2', { to_state: 'ARRIVED_AT_PICKUP' });
  await box.clearAssignment('a-1');
  expect(box.snapshot().map((e) => e.assignmentId)).toEqual(['a-2']);
});
