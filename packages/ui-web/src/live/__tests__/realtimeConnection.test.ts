import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeConnection, resolveSocketUrl, type ChannelSignal, type SocketLike } from '../realtimeConnection.js';

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(frame: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

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
    sockets[0]!.receive(loc('e1', 7));

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
    s.receive({ id: 'c', seq: 0, channel: '', type: 'subscribed', v: 1, ts: '', data: { channel: 'order:o1', cursor_seq: 3 } });
    s.receive(loc('e4', 4));
    s.receive(loc('e4', 4)); // at-least-once redelivery
    s.receive(loc('e9', 9)); // 5–8 missing
    s.receive({ id: 'p', seq: 0, channel: '', type: 'ping', v: 1, ts: '', data: { t: 42 } });
    s.receive({ ...loc('e10', 10), v: 2 }); // a payload version this client does not know

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
    sockets[0]!.receive({
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
});

describe('resolveSocketUrl', () => {
  it("uses the ticket's ws URL, an override, or derives one from the API base", () => {
    expect(resolveSocketUrl('wss://api.halalgoes.com/v1/ws')).toBe('wss://api.halalgoes.com/v1/ws');
    expect(resolveSocketUrl('https://cdn.example/x.webp', 'https://api.example.com/')).toBe('wss://api.example.com/v1/ws');
    expect(resolveSocketUrl('wss://a/v1/ws', undefined, 'ws://localhost:4010/v1/ws')).toBe('ws://localhost:4010/v1/ws');
  });
});
