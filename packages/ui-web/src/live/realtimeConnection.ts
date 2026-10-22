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
  type SubscribeErrorData,
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

/** How a replay ended (`resume_complete`), for a screen that must say how much history it holds. */
export interface ReplayResult {
  fromSeq: number;
  toSeq: number;
  replayed: number;
  truncated: boolean;
}

/**
 * A `subscribe_error` frame (websocket.md section 4.1): the server refused ONE channel. Its codes are
 * their own closed set, lower case, and not `ErrorCode`.
 */
export interface SubscribeErrorInfo {
  channel: string;
  code: SubscribeErrorData['code'];
  message: string;
}

/**
 * The server wants the person to sign in again over REST: a `reauth_required` frame, or the socket
 * closed `4401` (`session_revoked`, `reauth_timeout` or an invalid ticket). Retrying cannot help.
 */
export interface ReauthInfo {
  /** When this client learned of it (epoch ms). */
  at: number;
  /** The frame's `deadline` (`reauth_required` only); `null` for a `4401` close. */
  deadline: string | null;
  via: 'frame' | 'close';
}

/**
 * The server closed the socket for a reason no retry can change: `4400` (a malformed frame or an
 * unknown field) or `4403` (the origin is not allowed). `contracts/websocket.md` marks both do not
 * retry, and both are a fault on our side rather than anything the person did or can undo.
 *
 * This is told apart from giving up after several refusals because the two want different words and
 * different buttons: a refusal that happened five times may work on the sixth, so offering a retry
 * is honest; these cannot, so offering one hands someone a button that cannot succeed
 * (https://github.com/shaiknoorullah/hg-mono/issues/1010).
 */
export interface FatalCloseInfo {
  /** The close code, `4400` or `4403`. */
  code: number;
  /** When this client learned of it (epoch ms). */
  at: number;
}

/** Options for `RealtimeConnection.subscribe`. */
export interface SubscribeOptions {
  /**
   * On the first `subscribed` frame, replay up to this many events before the channel's head
   * (`resume` with `after_seq = max(cursor_seq - backfill, 0)`), so a page that opens late still
   * sees what just happened. The replay is a read of the immutable event table
   * (websocket.md section 6.3), so any number of screens may do it.
   */
  backfill?: number;
  /** Called when a replay on this channel finishes. Only channels with a `backfill` report it. */
  onReplay?: (result: ReplayResult) => void;
  /** Called when the server refuses this channel with `subscribe_error`. */
  onSubscribeError?: (error: SubscribeErrorInfo) => void;
}

/** How the connection is retrying, for "Trying again in 8 seconds" and "refused 5 times". */
export interface RetryInfo {
  /** Consecutive attempts that did not reach an open socket. 0 while open or never tried. */
  attempt: number;
  /** When the next attempt starts (epoch ms), or `null` when none is scheduled. */
  nextAt: number | null;
  /**
   * What the last failed attempt got stuck on: `ticket` when `POST /v1/realtime/ticket` failed (no
   * socket was dialled), `socket` when a ticket was minted but the socket did not stay open.
   * `null` when nothing has failed.
   */
  cause: 'ticket' | 'socket' | null;
}

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
  /**
   * Called when the server asks for a new sign-in (`reauth_required`, or close `4401`). The
   * connection stops retrying first: a retry would be refused the same way. `reconnectNow()` dials
   * again once the person has signed in.
   */
  onReauthRequired?: (info: ReauthInfo) => void;
  /**
   * Called when the server closed the socket `4400` or `4403`. The connection has already stopped
   * retrying; a caller that shows a retry after this is offering a button that cannot work.
   */
  onFatalClose?: (info: FatalCloseInfo) => void;
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
  readonly #backfill = new Map<string, number>();
  readonly #replayHandlers = new Map<string, Set<(result: ReplayResult) => void>>();
  readonly #subscribeErrorHandlers = new Map<string, Set<(error: SubscribeErrorInfo) => void>>();
  readonly #backfilled = new Set<string>();
  readonly #seen = new SeenEventIds();
  #socket: SocketLike | null = null;
  #status: RealtimeStatus = 'idle';
  #attempt = 0;
  #retryTimer: ReturnType<typeof setTimeout> | undefined;
  #nextAt: number | null = null;
  #cause: 'ticket' | 'socket' | null = null;
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

  /** Consecutive failed attempts and when the next one starts. */
  get retry(): RetryInfo {
    return { attempt: this.#attempt, nextAt: this.#nextAt, cause: this.#cause };
  }

  /** Skips the wait and dials now ("Reconnect now"). A no-op while open or stopped. */
  reconnectNow(): void {
    if (this.#stopped || this.#status === 'open' || this.#status === 'connecting') return;
    clearTimeout(this.#retryTimer);
    this.#nextAt = null;
    void this.#dial();
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
    this.#nextAt = null;
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
  subscribe(channel: string, handler: ChannelHandler, options: SubscribeOptions = {}): () => void {
    let set = this.#handlers.get(channel);
    if (!set) {
      set = new Set();
      this.#handlers.set(channel, set);
      this.#send({ type: 'subscribe', channel });
    }
    if (options.backfill && options.backfill > (this.#backfill.get(channel) ?? 0)) {
      this.#backfill.set(channel, options.backfill);
    }
    const onSubscribeError = options.onSubscribeError;
    if (onSubscribeError) {
      const errors = this.#subscribeErrorHandlers.get(channel) ?? new Set();
      errors.add(onSubscribeError);
      this.#subscribeErrorHandlers.set(channel, errors);
    }
    const onReplay = options.onReplay;
    if (onReplay) {
      const replays = this.#replayHandlers.get(channel) ?? new Set();
      replays.add(onReplay);
      this.#replayHandlers.set(channel, replays);
    }
    set.add(handler);
    return () => {
      if (onReplay) this.#replayHandlers.get(channel)?.delete(onReplay);
      if (onSubscribeError) this.#subscribeErrorHandlers.get(channel)?.delete(onSubscribeError);
      const current = this.#handlers.get(channel);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        this.#handlers.delete(channel);
        this.#lastSeq.delete(channel);
        this.#backfill.delete(channel);
        this.#backfilled.delete(channel);
        this.#replayHandlers.delete(channel);
        this.#subscribeErrorHandlers.delete(channel);
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
      if (generation === this.#generation) {
        this.#cause = 'ticket';
        this.#scheduleRetry();
      }
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
      this.#cause = 'socket';
      this.#scheduleRetry();
      return;
    }
    this.#socket = socket;

    socket.onopen = () => {
      if (generation !== this.#generation) return;
      this.#attempt = 0;
      this.#nextAt = null;
      this.#cause = null;
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
      if (ev.code === REALTIME_CLOSE.UNAUTHENTICATED) {
        this.#endForReauth(null, 'close');
        return;
      }
      if (FATAL_CLOSE.has(ev.code)) {
        // Retrying is over, so nothing is scheduled and the attempt count is cleared: a caller that
        // reads `retry` must not see a pending attempt and call this a reconnection in progress.
        clearTimeout(this.#retryTimer);
        this.#nextAt = null;
        this.#attempt = 0;
        this.#cause = null;
        this.#setStatus('offline');
        this.#opts.onFatalClose?.({ code: ev.code, at: Date.now() });
        return;
      }
      this.#cause = 'socket';
      this.#scheduleRetry();
    };
  }

  /**
   * The server wants a new sign-in. Nothing here retries (a new ticket is minted with the same dead
   * session), the socket is closed, and the owner is told once.
   */
  #endForReauth(deadline: string | null, via: 'frame' | 'close') {
    if (this.#stopped) return;
    this.#generation++;
    clearTimeout(this.#retryTimer);
    clearInterval(this.#reauthTimer);
    this.#nextAt = null;
    this.#attempt = 0;
    this.#cause = null;
    const socket = this.#socket;
    this.#socket = null;
    if (socket) {
      socket.onclose = null;
      socket.close(REALTIME_CLOSE.NORMAL, 'reauth_required');
    }
    this.#setStatus('offline');
    this.#opts.onReauthRequired?.({ at: Date.now(), deadline, via });
  }

  #scheduleRetry() {
    if (this.#stopped) return;
    this.#setStatus('reconnecting');
    const delay = reconnectDelayMs(this.#attempt, this.#opts.random);
    this.#attempt++;
    this.#nextAt = Date.now() + delay;
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
      const backfill = this.#backfill.get(channel);
      if (backfill && !this.#backfilled.has(channel)) {
        this.#backfilled.add(channel);
        this.#send({ type: 'resume', channel, after_seq: Math.max(cursor_seq - backfill, 0) });
      }
      return;
    }
    if (envelope.type === 'reauth_required') {
      const deadline = (envelope.data as { deadline?: string } | null)?.deadline ?? null;
      this.#endForReauth(deadline, 'frame');
      return;
    }
    if (envelope.type === 'subscribe_error') {
      const { channel, code, message } = envelope.data as SubscribeErrorData;
      for (const onError of [...(this.#subscribeErrorHandlers.get(channel) ?? [])]) {
        try {
          onError({ channel, code, message });
        } catch {
          /* one listener's bug must not starve the others */
        }
      }
      return;
    }
    if (envelope.type === 'resume_complete') {
      const { channel, truncated, to_seq, from_seq, replayed } = envelope.data as {
        channel: string;
        truncated: boolean;
        to_seq: number;
        from_seq: number;
        replayed: number;
      };
      for (const onReplay of [...(this.#replayHandlers.get(channel) ?? [])]) {
        try {
          onReplay({ fromSeq: from_seq, toSeq: to_seq, replayed, truncated });
        } catch {
          /* one listener's bug must not starve the others */
        }
      }
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
