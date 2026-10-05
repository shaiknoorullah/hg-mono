/**
 * The web apps' realtime socket — one connection per signed-in tab, per `contracts/websocket.md`.
 *
 * Framework-free on purpose: the React binding is `RealtimeProvider` in `./useRealtime.tsx`, and
 * the tests drive this class with a fake `WebSocket`. It implements the contract's client
 * checklist (websocket.md "Client checklist"):
 *
 * 1. a fresh single-use ticket for every connection attempt, never reused;
 * 2. dedup on the envelope `id` with a bounded set (`SeenEventIds`);
 * 3. `seq` tracked per channel, `resume` on a gap and on every reconnect;
 * 4. `resume_complete{truncated:true}` handed to the subscriber as "refetch over REST";
 * 5. events whose `v` it does not understand are ignored, unknown `type`s never crash it;
 * 6. `reauth` every 9 minutes with the current access token;
 * 8. status is exposed so the caller can fall back to REST polling while the socket is down.
 *
 * Identity never travels in a frame: the ticket is minted by an authenticated REST call and
 * the five inbound frame types carry no user, role or restaurant field.
 */
import {
  REALTIME_CLOSE,
  SeenEventIds,
  hasGap,
  reconnectDelayMs,
  type InboundFrame,
  type RealtimeEnvelope,
} from '@hg/api-client';

/** What a connection is doing right now. Anything but `open` means "poll REST instead". */
export type RealtimeStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'offline';

/** The part of `RealtimeTicket` this client needs. */
export interface RealtimeTicketLike {
  ticket: string;
  websocket_url: string;
}

/** A delivered event, or the "your view may be missing events" signal after a truncated resume. */
export type ChannelSignal =
  | { kind: 'event'; event: RealtimeEnvelope }
  | { kind: 'refetch'; channel: string };

/** Receives every signal for one channel. */
export type ChannelHandler = (signal: ChannelSignal) => void;

/** Minimal `WebSocket` surface, so tests can substitute a fake. */
export interface SocketLike {
  readonly readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/** Options for `RealtimeConnection`. */
export interface RealtimeConnectionOptions {
  /** `POST /v1/realtime/ticket`. Called once per connection attempt — tickets are single-use. */
  mintTicket: () => Promise<RealtimeTicketLike>;
  /** The `client` query parameter, e.g. `admin-web`. */
  client: string;
  /** The API base URL; used to derive the socket URL when the ticket's is not a `ws(s)://` URL. */
  apiBaseUrl?: string;
  /** An explicit socket URL, overriding the ticket's (local development against the mock). */
  socketUrl?: string;
  /** The current access token, sent in a `reauth` frame every 9 minutes. */
  getAccessToken?: () => string | null;
  /** Called on every status change. */
  onStatus?: (status: RealtimeStatus) => void;
  /** Injected for tests. Defaults to the global `WebSocket`. */
  createSocket?: (url: string) => SocketLike;
  /** Injected for tests. */
  random?: () => number;
}

const OPEN = 1;
/** The contract asks for a `reauth` at least every 10 minutes; leave a minute of slack. */
const REAUTH_MS = 9 * 60_000;
/** websocket.md: the payload version this client understands. */
const PAYLOAD_VERSION = 1;
/** Close codes after which retrying cannot help (websocket.md "Close codes"). */
const FATAL_CLOSE = new Set<number>([REALTIME_CLOSE.ORIGIN_NOT_ALLOWED, REALTIME_CLOSE.MALFORMED_FRAME]);

/**
 * Turns the ticket's `websocket_url` into the URL to dial. A `ws(s)://` URL is used as-is;
 * anything else (the mock's fixture is a placeholder) falls back to `{apiBaseUrl}/v1/ws`.
 */
export function resolveSocketUrl(ticketUrl: string, apiBaseUrl?: string, override?: string): string {
  if (override) return override;
  if (/^wss?:\/\//i.test(ticketUrl)) return ticketUrl;
  const base = (apiBaseUrl ?? globalThis.location?.origin ?? 'http://localhost:4010').replace(/\/+$/, '');
  return `${base.replace(/^http/i, 'ws')}/v1/ws`;
}

/**
 * One realtime connection with ref-counted channel subscriptions, reconnect with the
 * contract's backoff, gap detection and dedup.
 */
export class RealtimeConnection {
  readonly #opts: RealtimeConnectionOptions;
  readonly #handlers = new Map<string, Set<ChannelHandler>>();
  readonly #lastSeq = new Map<string, number>();
  readonly #seen = new SeenEventIds();
  #socket: SocketLike | null = null;
  #status: RealtimeStatus = 'idle';
  #attempt = 0;
  #retryTimer: ReturnType<typeof setTimeout> | undefined;
  #reauthTimer: ReturnType<typeof setInterval> | undefined;
  #stopped = true;
  /** Bumped on every dial so a late callback from an old socket is ignored. */
  #generation = 0;

  constructor(opts: RealtimeConnectionOptions) {
    this.#opts = opts;
  }

  /** The current status. */
  get status(): RealtimeStatus {
    return this.#status;
  }

  /** Opens the connection (idempotent). */
  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    void this.#dial();
  }

  /** Closes the connection and stops reconnecting. Subscriptions are kept for a later `start`. */
  stop(): void {
    this.#stopped = true;
    this.#generation++;
    clearTimeout(this.#retryTimer);
    clearInterval(this.#reauthTimer);
    const socket = this.#socket;
    this.#socket = null;
    if (socket) {
      socket.onclose = null;
      socket.close(REALTIME_CLOSE.NORMAL, 'client_stop');
    }
    this.#setStatus('idle');
  }

  /**
   * Listens on a channel. The first listener subscribes, the last one to leave unsubscribes.
   * Returns the function that removes this listener.
   */
  subscribe(channel: string, handler: ChannelHandler): () => void {
    let set = this.#handlers.get(channel);
    if (!set) {
      set = new Set();
      this.#handlers.set(channel, set);
      this.#send({ type: 'subscribe', channel });
    }
    set.add(handler);
    return () => {
      const current = this.#handlers.get(channel);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        this.#handlers.delete(channel);
        this.#lastSeq.delete(channel);
        this.#send({ type: 'unsubscribe', channel });
      }
    };
  }

  #setStatus(next: RealtimeStatus) {
    if (this.#status === next) return;
    this.#status = next;
    this.#opts.onStatus?.(next);
  }

  #send(frame: InboundFrame) {
    if (this.#socket && this.#socket.readyState === OPEN) this.#socket.send(JSON.stringify(frame));
  }

  async #dial() {
    const generation = ++this.#generation;
    this.#setStatus(this.#attempt === 0 ? 'connecting' : 'reconnecting');
    let ticket: RealtimeTicketLike;
    try {
      ticket = await this.#opts.mintTicket();
    } catch {
      if (generation === this.#generation) this.#scheduleRetry();
      return;
    }
    if (generation !== this.#generation || this.#stopped) return;

    const base = resolveSocketUrl(ticket.websocket_url, this.#opts.apiBaseUrl, this.#opts.socketUrl);
    const url = new URL(base);
    url.searchParams.set('ticket', ticket.ticket);
    url.searchParams.set('client', this.#opts.client);
    url.searchParams.set('v', '1');

    let socket: SocketLike;
    try {
      socket = this.#opts.createSocket
        ? this.#opts.createSocket(url.toString())
        : (new WebSocket(url.toString()) as unknown as SocketLike);
    } catch {
      this.#scheduleRetry();
      return;
    }
    this.#socket = socket;

    socket.onopen = () => {
      if (generation !== this.#generation) return;
      this.#attempt = 0;
      this.#setStatus('open');
      // Subscriptions belong to a connection: re-establish every channel, then resume it.
      for (const channel of this.#handlers.keys()) {
        this.#send({ type: 'subscribe', channel });
        const after = this.#lastSeq.get(channel);
        if (after !== undefined) this.#send({ type: 'resume', channel, after_seq: after });
      }
      clearInterval(this.#reauthTimer);
      this.#reauthTimer = setInterval(() => {
        const token = this.#opts.getAccessToken?.();
        if (token) this.#send({ type: 'reauth', access_token: token });
      }, REAUTH_MS);
    };
    socket.onmessage = (ev) => {
      if (generation !== this.#generation) return;
      this.#onMessage(ev.data);
    };
    socket.onerror = () => {
      /* the close handler that follows decides what to do */
    };
    socket.onclose = (ev) => {
      if (generation !== this.#generation) return;
      clearInterval(this.#reauthTimer);
      this.#socket = null;
      if (this.#stopped) return;
      if (FATAL_CLOSE.has(ev.code)) {
        this.#setStatus('offline');
        return;
      }
      this.#scheduleRetry();
    };
  }

  #scheduleRetry() {
    if (this.#stopped) return;
    this.#setStatus('reconnecting');
    const delay = reconnectDelayMs(this.#attempt, this.#opts.random);
    this.#attempt++;
    clearTimeout(this.#retryTimer);
    this.#retryTimer = setTimeout(() => void this.#dial(), delay);
  }

  #onMessage(raw: unknown) {
    let envelope: RealtimeEnvelope;
    try {
      envelope = JSON.parse(String(raw)) as RealtimeEnvelope;
    } catch {
      return;
    }
    if (!envelope || typeof envelope.type !== 'string') return;

    if (envelope.type === 'ping') {
      const t = (envelope.data as { t?: number } | null)?.t ?? Date.now();
      this.#send({ type: 'pong', t });
      return;
    }
    if (envelope.type === 'subscribed') {
      const { channel, cursor_seq } = envelope.data as { channel: string; cursor_seq: number };
      if (!this.#lastSeq.has(channel)) this.#lastSeq.set(channel, cursor_seq);
      return;
    }
    if (envelope.type === 'resume_complete') {
      const { channel, truncated, to_seq } = envelope.data as { channel: string; truncated: boolean; to_seq: number };
      if (truncated) {
        this.#lastSeq.set(channel, to_seq);
        this.#dispatch(channel, { kind: 'refetch', channel });
      }
      return;
    }
    if (!envelope.channel) return; // other control frames: nothing for a channel listener
    if (envelope.v !== PAYLOAD_VERSION) return;
    if (!this.#seen.admit(envelope.id)) return;

    const last = this.#lastSeq.get(envelope.channel);
    if (hasGap(last, envelope.seq)) {
      this.#send({ type: 'resume', channel: envelope.channel, after_seq: last! });
    }
    if (last === undefined || envelope.seq > last) this.#lastSeq.set(envelope.channel, envelope.seq);
    this.#dispatch(envelope.channel, { kind: 'event', event: envelope });
  }

  #dispatch(channel: string, signal: ChannelSignal) {
    const set = this.#handlers.get(channel);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        handler(signal);
      } catch {
        /* one listener's bug must not starve the others */
      }
    }
  }
}
