import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeConnection, resolveSocketUrl, type ChannelSignal } from '../realtimeConnection.js';
import { FakeRealtimeSocket as FakeSocket } from '../../testing/index.js';

const loc = (id: string, seq: number, lat = 43.65) => ({
  id,
  seq,
  channel: 'order:o1',
  type: 'rider.location',
  v: 1,
  ts: '2026-10-05T12:00:00.000Z',
  data: { order_id: 'o1', lat, lng: -79.38, heading_deg: null, speed_mps: null, accuracy_m: null, recorded_at: '2026-10-05T12:00:00.000Z' },
});

describe('RealtimeConnection', () => {
  let sockets: FakeSocket[];
  let tickets: number;
  let conn: RealtimeConnection;

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    tickets = 0;
    conn = new RealtimeConnection({
      client: 'admin-web',
      apiBaseUrl: 'http://localhost:4010',
      mintTicket: async () => ({ ticket: `t${++tickets}`, websocket_url: 'placeholder' }),
      createSocket: (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
      random: () => 0,
    });
  });
  afterEach(() => {
    conn.stop();
    vi.useRealTimers();
  });

  it('mints a fresh ticket per connection, resubscribes and resumes from the last seq after a drop', async () => {
    const got: ChannelSignal[] = [];
    conn.subscribe('order:o1', (s) => got.push(s));
    conn.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets[0]!.url).toBe('ws://localhost:4010/v1/ws?ticket=t1&client=admin-web&v=1');
    sockets[0]!.open();
    expect(sockets[0]!.sent).toContainEqual({ type: 'subscribe', channel: 'order:o1' });
    sockets[0]!.push(loc('e1', 7));

    sockets[0]!.drop();
    expect(conn.status).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(10);
    expect(sockets).toHaveLength(2);
    expect(sockets[1]!.url).toContain('ticket=t2');
    sockets[1]!.open();
    expect(sockets[1]!.sent).toEqual([
      { type: 'subscribe', channel: 'order:o1' },
      { type: 'resume', channel: 'order:o1', after_seq: 7 },
    ]);
    expect(conn.status).toBe('open');
  });

  it('drops duplicate ids, asks for a resume on a seq gap, and answers pings', async () => {
    const got: ChannelSignal[] = [];
    conn.subscribe('order:o1', (s) => got.push(s));
    conn.start();
    await vi.advanceTimersByTimeAsync(0);
    const s = sockets[0]!;
    s.open();
    s.push({ id: 'c', seq: 0, channel: '', type: 'subscribed', v: 1, ts: '', data: { channel: 'order:o1', cursor_seq: 3 } });
    s.push(loc('e4', 4));
    s.push(loc('e4', 4)); // at-least-once redelivery
    s.push(loc('e9', 9)); // 5–8 missing
    s.push({ id: 'p', seq: 0, channel: '', type: 'ping', v: 1, ts: '', data: { t: 42 } });
    s.push({ ...loc('e10', 10), v: 2 }); // a payload version this client does not know

    expect(got.map((g) => (g.kind === 'event' ? g.event.id : g.kind))).toEqual(['e4', 'e9']);
    expect(s.sent).toContainEqual({ type: 'resume', channel: 'order:o1', after_seq: 4 });
    expect(s.sent).toContainEqual({ type: 'pong', t: 42 });
  });

  it('turns a truncated resume into a refetch signal', async () => {
    const got: ChannelSignal[] = [];
    conn.subscribe('order:o1', (s) => got.push(s));
    conn.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.open();
    sockets[0]!.push({
      id: 'r',
      seq: 0,
      channel: '',
      type: 'resume_complete',
      v: 1,
      ts: '',
      data: { channel: 'order:o1', from_seq: 1, to_seq: 2000, replayed: 1000, truncated: true },
    });
    expect(got).toEqual([{ kind: 'refetch', channel: 'order:o1' }]);
  });

  it('replays the 1000 events before the head once, and says how the replay ended', async () => {
    const got: unknown[] = [];
    conn.subscribe('admin:ops', () => undefined, { backfill: 1000, onReplay: (r) => got.push(r) });
    conn.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.open();
    const control = (type: string, data: unknown) => ({ id: type, seq: 0, channel: '', type, v: 1, ts: '', data });
    sockets[0]!.push(control('subscribed', { channel: 'admin:ops', cursor_seq: 1500 }));
    expect(sockets[0]!.sent).toContainEqual({ type: 'resume', channel: 'admin:ops', after_seq: 500 });
    sockets[0]!.push(control('resume_complete', { channel: 'admin:ops', from_seq: 501, to_seq: 1500, replayed: 40, truncated: false }));
    expect(got).toEqual([{ fromSeq: 501, toSeq: 1500, replayed: 40, truncated: false }]);
    // A second `subscribed` (after a reconnect) resumes from the last seq, not from the backfill point.
    const before = sockets[0]!.sent.length;
    sockets[0]!.push(control('subscribed', { channel: 'admin:ops', cursor_seq: 1600 }));
    expect(sockets[0]!.sent.length).toBe(before);
  });

  it('a head below the backfill window starts at seq 0, ', async () => {
    conn.subscribe('admin:ops', () => undefined, { backfill: 1000 });
    conn.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.open();
    sockets[0]!.push({ id: 's', seq: 0, channel: '', type: 'subscribed', v: 1, ts: '', data: { channel: 'admin:ops', cursor_seq: 30 } });
    expect(sockets[0]!.sent).toContainEqual({ type: 'resume', channel: 'admin:ops', after_seq: 0 });
  });
});

describe('RealtimeConnection: refusals the server gives, and what can put each right', () => {
  const control = (type: string, data: unknown) => ({ id: type, seq: 0, channel: '', type, v: 1, ts: '', data });
  let sockets: FakeSocket[];
  let tickets: number;
  let reauth: unknown[];
  let fatal: unknown[];
  let mint: () => Promise<{ ticket: string; websocket_url: string }>;
  let conn: RealtimeConnection;

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    tickets = 0;
    reauth = [];
    fatal = [];
    mint = async () => ({ ticket: `t${++tickets}`, websocket_url: 'placeholder' });
    conn = new RealtimeConnection({
      client: 'admin-web',
      apiBaseUrl: 'http://localhost:4010',
      mintTicket: () => mint(),
      createSocket: (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
      onReauthRequired: (info) => reauth.push(info),
      onFatalClose: (info) => fatal.push(info),
      random: () => 0,
    });
  });
  afterEach(() => {
    conn.stop();
    vi.useRealTimers();
  });

  it('hands a subscribe_error to the channel that was refused, and to no other', async () => {
    const ops: unknown[] = [];
    const orders: unknown[] = [];
    conn.subscribe('admin:ops', () => undefined, { onSubscribeError: (e) => ops.push(e) });
    conn.subscribe('order:o1', () => undefined, { onSubscribeError: (e) => orders.push(e) });
    conn.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.open();
    sockets[0]!.push(control('subscribe_error', { channel: 'admin:ops', code: 'forbidden', message: 'No.' }));
    expect(ops).toEqual([{ channel: 'admin:ops', code: 'forbidden', message: 'No.' }]);
    expect(orders).toEqual([]);
    // A refusal is not a lost connection: the socket stays open and nothing is retried.
    expect(conn.status).toBe('open');
    expect(conn.retry.attempt).toBe(0);
  });

  it('reauth_required ends the connection and asks for a sign-in: it does not retry', async () => {
    conn.subscribe('admin:ops', () => undefined);
    conn.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.open();
    sockets[0]!.push(control('reauth_required', { deadline: '2026-10-05T12:05:00.000Z' }));
    expect(reauth).toEqual([{ at: expect.any(Number), deadline: '2026-10-05T12:05:00.000Z', via: 'frame' }]);
    expect(conn.status).toBe('offline');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
    expect(tickets).toBe(1);
  });

  // 4400 and 4403 are marked do not retry in contracts/websocket.md, section 1.5. A caller shows a
  // retry from the attempt count, so what matters is not only that nothing is dialled again but
  // that no attempt is left pending to read: otherwise the page says "reconnecting" forever and
  // offers a button that cannot work (https://github.com/shaiknoorullah/hg-mono/issues/1010).
  for (const code of [4400, 4403]) {
    it(`a ${code} close stops for good, reports itself, and leaves no attempt pending`, async () => {
      conn.subscribe('admin:ops', () => undefined);
      conn.start();
      await vi.advanceTimersByTimeAsync(0);
      sockets[0]!.open();
      sockets[0]!.drop(code);
      expect(fatal).toEqual([{ code, at: expect.any(Number) }]);
      expect(reauth).toEqual([]);
      expect(conn.status).toBe('offline');
      // Nothing is scheduled, and nothing a caller could mistake for a reconnection in progress.
      expect(conn.retry).toMatchObject({ attempt: 0, nextAt: null });
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(sockets).toHaveLength(1);
      expect(tickets).toBe(1);
    });
  }

  it('a 4401 close asks for a sign-in too, and a later reconnectNow mints a fresh ticket', async () => {
    conn.subscribe('admin:ops', () => undefined);
    conn.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.open();
    sockets[0]!.drop(4401);
    expect(reauth).toEqual([{ at: expect.any(Number), deadline: null, via: 'close' }]);
    expect(conn.status).toBe('offline');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
    // After the person signs in again:
    conn.reconnectNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toHaveLength(2);
    expect(sockets[1]!.url).toContain('ticket=t2');
  });

  it('says whether the last failed attempt got stuck at the ticket or at the socket', async () => {
    let fail = true;
    mint = async () => {
      if (fail) throw new Error('503');
      return { ticket: `t${++tickets}`, websocket_url: 'placeholder' };
    };
    conn.subscribe('admin:ops', () => undefined);
    conn.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(conn.retry.cause).toBe('ticket');
    expect(sockets).toHaveLength(0);

    fail = false;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sockets).toHaveLength(1);
    sockets[0]!.drop(1006);
    expect(conn.retry.cause).toBe('socket');
    await vi.advanceTimersByTimeAsync(20_000);
    sockets[1]!.open();
    expect(conn.retry.cause).toBeNull();
  });
});

describe('resolveSocketUrl', () => {
  it("uses the ticket's ws URL, an override, or derives one from the API base", () => {
    expect(resolveSocketUrl('wss://api.halalgoes.com/v1/ws')).toBe('wss://api.halalgoes.com/v1/ws');
    expect(resolveSocketUrl('https://cdn.example/x.webp', 'https://api.example.com/')).toBe('wss://api.example.com/v1/ws');
    expect(resolveSocketUrl('wss://a/v1/ws', undefined, 'ws://localhost:4010/v1/ws')).toBe('ws://localhost:4010/v1/ws');
  });
});
