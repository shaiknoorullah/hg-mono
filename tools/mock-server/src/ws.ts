/**
 * The realtime mock, per `contracts/websocket.md`.
 *
 * It implements the parts a frontend can actually observe — the ticket-bearing upgrade, the
 * `hello` frame, the five inbound frame types, heartbeats, `seq` bookkeeping, replay — and
 * it can **play a scripted event sequence** so a tracking screen is driven through a whole
 * order lifecycle without a backend.
 *
 * What it deliberately does not do: authorization. Every `subscribe` is granted. The real
 * server runs a fresh Postgres check per subscribe; a mock that pretended to would be
 * teaching frontends to trust the socket, which is the exact thing §0 rule 2 forbids.
 */
import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { FixtureStore } from './fixtures.js';

const HEARTBEAT_S = 25;
const PROTOCOL = 1;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function ulid(): string {
  let out = '';
  for (let i = 0; i < 26; i += 1) out += CROCKFORD[Math.floor(Math.random() * 32)]!;
  return out;
}

function uuid(): string {
  return globalThis.crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.(\d{3})\d*Z$/, '.$1Z');
}

const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/**
 * Shift every RFC 3339 UTC timestamp inside a frame's `data` by `offsetMs`. Fixtures are
 * written against a frozen clock, so a script's `expires_at` / `deadline_at` would be in
 * the past by the time it plays; shifted by (play start - frozen clock) they land where
 * the script meant them, and a client countdown is live. Plain dates (`2027-03-08`) and
 * numbers are left alone.
 */
export function restamp<T>(value: T, offsetMs: number): T {
  if (typeof value === 'string') {
    if (!RFC3339_UTC.test(value)) return value;
    const shifted = Date.parse(value) + offsetMs;
    if (Number.isNaN(shifted)) return value;
    return new Date(shifted).toISOString() as unknown as T;
  }
  if (Array.isArray(value)) return value.map((item) => restamp(item, offsetMs)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = restamp(item, offsetMs);
    }
    return out as T;
  }
  return value;
}

interface ScriptEvent {
  id: string;
  seq: number;
  channel: string;
  type: string;
  v: number;
  ts: string;
  data: unknown;
  _delay_ms?: number;
}

interface Connection {
  socket: WebSocket;
  accountId: string;
  sessionId: string;
  subscriptions: Set<string>;
  /** Per-channel head, for gap detection and `resume`. */
  cursor: Map<string, number>;
  /** Every event this connection has been sent, per channel, so `resume` can replay. */
  history: Map<string, ScriptEvent[]>;
  timers: NodeJS.Timeout[];
  alive: boolean;
}

export interface RealtimeOptions {
  store: FixtureStore;
  path: string;
  /** Multiply every scripted delay. `2` runs a lifecycle at half speed, `0` fires instantly. */
  speed: number;
  log: (message: string) => void;
}

export function attachRealtime(server: Server, options: RealtimeOptions): WebSocketServer {
  const { store, path, log } = options;
  const wss = new WebSocketServer({ noServer: true });
  const connections = new Set<Connection>();

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== path) {
      socket.destroy();
      return;
    }
    // The real server consumes a single-use ticket here and refuses with HTTP 401 before
    // any frame is exchanged. The mock accepts any ticket but still *requires* one, so a
    // client that forgets to mint one fails here rather than in staging.
    if (!url.searchParams.get('ticket') && !request.headers['sec-websocket-protocol']) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, url);
    });
  });

  wss.on('connection', (socket: WebSocket, _request: unknown, url: URL) => {
    const accountId = url.searchParams.get('account_id') ?? uuid();
    const conn: Connection = {
      socket,
      accountId,
      sessionId: uuid(),
      subscriptions: new Set(),
      cursor: new Map(),
      history: new Map(),
      timers: [],
      alive: true,
    };
    connections.add(conn);

    const send = (frame: Record<string, unknown>) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame));
    };

    const control = (type: string, data: unknown) =>
      send({ id: ulid(), seq: 0, channel: '', type, v: 1, ts: nowIso(), data });

    const accountChannel = `account:${accountId}`;
    conn.subscriptions.add(accountChannel); // auto-subscribed at hello, per §3.1

    control('hello', {
      account_id: accountId,
      roles: [{ r: url.searchParams.get('role') ?? 'CUSTOMER', s: null }],
      session_id: conn.sessionId,
      allowed_channels: [accountChannel, 'order:*', 'restaurant:*', 'rider:*', 'admin:ops'],
      server_time: nowIso(),
      heartbeat_s: HEARTBEAT_S,
      protocol: PROTOCOL,
    });

    const heartbeat = setInterval(() => {
      if (!conn.alive) {
        socket.close(4401, 'reauth_timeout');
        return;
      }
      control('ping', { t: Date.now() });
    }, HEARTBEAT_S * 1000);
    conn.timers.push(heartbeat);

    // A scenario named on the query string starts playing as soon as the client subscribes
    // (or immediately, if `autoplay=1`).
    const scenario = url.searchParams.get('scenario') ?? undefined;
    let played = false;

    const play = (name: string) => {
      const fixture = store.get(name);
      if (!fixture || !Array.isArray(fixture.payload)) {
        control('error', {
          code: 'NOT_FOUND',
          message: `no realtime script named \`${name}\``,
          retryable: false,
        });
        return;
      }
      played = true;
      log(`ws: playing \`${name}\` (${(fixture.payload as ScriptEvent[]).length} events)`);
      // Every timestamp in a fixture is relative to the frozen clock; move them so the
      // script starts now.
      const frozen = Date.parse(store.manifest.frozen_clock ?? '');
      const offsetMs = Number.isNaN(frozen) ? 0 : Date.now() - frozen;
      for (const raw of fixture.payload as ScriptEvent[]) {
        const delay = Math.round((raw._delay_ms ?? 0) * options.speed);
        const timer = setTimeout(() => {
          const { _delay_ms, ...event } = raw;
          // Re-stamp `ts` to wall clock and the timestamps in `data` (expires_at,
          // deadline_at, ...) to the script's start, so countdowns in the client are live,
          // and give the event a fresh id so a reconnecting client's dedup LRU behaves
          // realistically.
          const frame: ScriptEvent = {
            ...event,
            id: ulid(),
            ts: nowIso(),
            data: restamp(event.data, offsetMs),
          };
          const history = conn.history.get(frame.channel) ?? [];
          history.push(frame);
          conn.history.set(frame.channel, history);
          conn.cursor.set(frame.channel, Math.max(conn.cursor.get(frame.channel) ?? 0, frame.seq));
          send(frame as unknown as Record<string, unknown>);
        }, delay);
        conn.timers.push(timer);
      }
    };

    if (scenario && url.searchParams.get('autoplay') === '1') play(scenario);

    socket.on('message', (buffer) => {
      let frame: any;
      try {
        frame = JSON.parse(buffer.toString());
      } catch {
        socket.close(4400, 'malformed_frame');
        return;
      }

      switch (frame?.type) {
        case 'subscribe': {
          if (typeof frame.channel !== 'string') {
            control('error', { code: 'INVALID_FIELD', message: 'channel is required', retryable: false });
            return;
          }
          if (conn.subscriptions.size >= 50) {
            control('subscribe_error', {
              channel: frame.channel,
              code: 'subscription_limit',
              message: '50 subscriptions per connection.',
            });
            return;
          }
          conn.subscriptions.add(frame.channel);
          control('subscribed', {
            channel: frame.channel,
            cursor_seq: conn.cursor.get(frame.channel) ?? 0,
          });
          if (scenario && !played) play(scenario);
          return;
        }
        case 'unsubscribe': {
          conn.subscriptions.delete(frame.channel);
          control('unsubscribed', { channel: frame.channel, reason: 'client_request' });
          return;
        }
        case 'resume': {
          const history = conn.history.get(frame.channel) ?? [];
          const after = Number(frame.after_seq ?? 0);
          const missed = history.filter((e) => e.seq > after);
          for (const event of missed) send(event as unknown as Record<string, unknown>);
          control('resume_complete', {
            channel: frame.channel,
            from_seq: after,
            to_seq: conn.cursor.get(frame.channel) ?? after,
            replayed: missed.length,
            // The mock keeps everything it sent, so it never truncates. Use the
            // `realtime_gap_and_resume` fixture to exercise the truncated path.
            truncated: false,
          });
          return;
        }
        case 'reauth': {
          conn.alive = true;
          return;
        }
        case 'pong': {
          conn.alive = true;
          return;
        }
        default: {
          // §3.2: anything else is `invalid_frame`. Note that `invalid_frame` is NOT a
          // member of the contract's ErrorCode enum — see contracts/README.md.
          control('error', {
            code: 'VALIDATION_FAILED',
            message: `unknown inbound frame type \`${frame?.type}\` (websocket.md §3.2 defines five)`,
            retryable: false,
          });
        }
      }
    });

    socket.on('close', () => {
      for (const timer of conn.timers) clearTimeout(timer as NodeJS.Timeout);
      clearInterval(heartbeat);
      connections.delete(conn);
    });
  });

  return wss;
}
