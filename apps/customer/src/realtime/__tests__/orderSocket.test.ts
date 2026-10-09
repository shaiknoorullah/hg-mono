/** The order channel's protocol handling (contracts/websocket.md §1-§3, §6), against a fake socket. */
import { openOrderSocket, type SocketDeps, type WebSocketLike } from '../orderSocket';

const ORDER = '6b1f0a3c-2f4e-7c1a-9f00-3a1b2c3d4e5f';
const TOPIC = `order:${ORDER}`;

class FakeSocket implements WebSocketLike {
  onopen: WebSocketLike['onopen'] = null;
  onmessage: WebSocketLike['onmessage'] = null;
  onclose: WebSocketLike['onclose'] = null;
  onerror: WebSocketLike['onerror'] = null;
  sent: Array<Record<string, unknown>> = [];
  closed = false;
  constructor(readonly url: string) {}
  send(d: string) {
    this.sent.push(JSON.parse(d));
  }
  close() {
    this.closed = true;
  }
  receive(frame: object) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

const frame = (type: string, seq: number, data: object, id = `id${type}${seq}`, channel = TOPIC) => ({
  id,
  seq,
  channel,
  type,
  v: 1,
  ts: '2026-10-06T12:00:00.000Z',
  data,
});
const fix = { order_id: ORDER, lat: 43.7, lng: -79.4, heading_deg: 1, speed_mps: 2, accuracy_m: 3, recorded_at: '2026-10-06T12:00:00.000Z' };

function setup() {
  const sockets: FakeSocket[] = [];
  const deps: SocketDeps = {
    mintTicket: jest.fn().mockResolvedValue({ ticket: 't k', websocket_url: 'wss://x.test/v1/ws' }),
    createSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    random: () => 0.999,
  };
  const onLink = jest.fn();
  const onRiderLocation = jest.fn();
  const stop = openOrderSocket(ORDER, { onLink, onRiderLocation }, deps);
  return { sockets, deps, onLink, onRiderLocation, stop };
}
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('connects with the ticket, subscribes to the order channel on hello, reports open on subscribed', async () => {
  const { sockets, onLink } = setup();
  await flush();
  expect(sockets[0]!.url).toBe('wss://x.test/v1/ws?ticket=t%20k&client=customer-app&v=1');
  sockets[0]!.receive({ type: 'hello', seq: 0, data: {} });
  expect(sockets[0]!.sent).toEqual([{ type: 'subscribe', channel: TOPIC }]);
  expect(onLink).not.toHaveBeenCalled();
  sockets[0]!.receive({ type: 'subscribed', seq: 0, data: { channel: TOPIC, cursor_seq: 4 } });
  expect(onLink).toHaveBeenCalledWith(true);
});

test('delivers rider.location once: duplicates and other channels are dropped; ping gets a pong', async () => {
  const { sockets, onRiderLocation } = setup();
  await flush();
  const s = sockets[0]!;
  s.receive(frame('rider.location', 1, fix));
  s.receive(frame('rider.location', 1, fix)); // same id: redelivery
  s.receive(frame('rider.location', 2, fix, 'other', 'order:someone-else'));
  expect(onRiderLocation).toHaveBeenCalledTimes(1);
  s.receive({ type: 'ping', seq: 0, data: { t: 1234 } });
  expect(s.sent).toContainEqual({ type: 'pong', t: 1234 });
});

test('reports each order.* event once, by type', async () => {
  const { sockets, deps } = setup();
  const onOrderEvent = jest.fn();
  openOrderSocket(ORDER, { onLink: jest.fn(), onRiderLocation: jest.fn(), onOrderEvent }, deps);
  await flush();
  const s = sockets[1]!;
  s.receive(frame('order.state_changed', 1, { order_id: ORDER, to: 'READY_FOR_PICKUP' }));
  s.receive(frame('order.state_changed', 1, { order_id: ORDER, to: 'READY_FOR_PICKUP' }));
  s.receive(frame('rider.location', 2, fix));
  expect(onOrderEvent.mock.calls).toEqual([['order.state_changed']]);
});

test('a gap in seq sends resume from the last seq seen', async () => {
  const { sockets, onRiderLocation } = setup();
  await flush();
  const s = sockets[0]!;
  s.receive(frame('rider.location', 1, fix, 'a'));
  s.receive(frame('rider.location', 4, fix, 'b'));
  expect(s.sent).toContainEqual({ type: 'resume', channel: TOPIC, after_seq: 1 });
  expect(onRiderLocation).toHaveBeenCalledTimes(2);
});

test('on close it reports the link down and reconnects with backoff, resuming from the last seq', async () => {
  const { sockets, onLink } = setup();
  await flush();
  sockets[0]!.receive({ type: 'subscribed', seq: 0, data: {} });
  sockets[0]!.receive(frame('rider.location', 7, fix, 'a'));
  sockets[0]!.onclose?.({});
  expect(onLink).toHaveBeenLastCalledWith(false);

  await jest.advanceTimersByTimeAsync(1_000);
  expect(sockets).toHaveLength(2);
  sockets[1]!.receive({ type: 'hello', seq: 0, data: {} });
  sockets[1]!.receive({ type: 'subscribed', seq: 0, data: {} });
  expect(sockets[1]!.sent).toContainEqual({ type: 'resume', channel: TOPIC, after_seq: 7 });
});

test('a ticket failure retries; stop closes the socket and stops retrying', async () => {
  const { sockets, deps, stop } = setup();
  (deps.mintTicket as jest.Mock).mockRejectedValueOnce(new Error('401'));
  await flush();
  sockets[0]!.onclose?.({});
  await jest.advanceTimersByTimeAsync(1_000); // mint fails
  await jest.advanceTimersByTimeAsync(2_000); // then succeeds
  expect(sockets.length).toBe(2);
  stop();
  expect(sockets[1]!.closed).toBe(true);
  await jest.advanceTimersByTimeAsync(60_000);
  expect(sockets).toHaveLength(2);
});
