/**
 * One order's realtime channel, per contracts/websocket.md: mint a ticket, open the socket,
 * `subscribe` to `order:{id}` on `hello`, answer `ping`, drop duplicate events, `resume` on a
 * gap, reconnect with the contract's backoff. It reports only what the tracking screen needs:
 * whether the socket is open, and each `rider.location`. Event types come from @hg/api-client.
 */
import {
  SeenEventIds,
  channel,
  hasGap,
  reconnectDelayMs,
  unwrap,
  type RealtimeEnvelope,
  type RiderLocationData,
} from '@hg/api-client';

import { api } from '../api/client';

export type OrderSocketHandlers = {
  /** True once the order channel is subscribed, false whenever the socket is not usable. */
  onLink: (open: boolean) => void;
  onRiderLocation: (fix: RiderLocationData) => void;
  /**
   * Any `order.*` or `payment.*` event on the channel (state changes, ETA, cancellation, items
   * adjusted). The tracking screen re-reads the order over REST on each; it never derives state
   * from the payload (client rule 9).
   */
  onOrderEvent?: (type: string) => void;
};

/** What the socket needs from the platform, so a test can stand in for it. */
export type SocketDeps = {
  mintTicket: () => Promise<{ ticket: string; websocket_url: string }>;
  createSocket: (url: string) => WebSocketLike;
  random?: () => number;
};

export type WebSocketLike = {
  onopen: ((e: unknown) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  send: (data: string) => void;
  close: () => void;
};

export const defaultSocketDeps: SocketDeps = {
  mintTicket: async () => {
    const body = await unwrap(
      api.POST('/v1/realtime/ticket', { params: { header: { 'X-HG-Client': 'customer-app' } } }),
    );
    return body.data;
  },
  createSocket: (url) => new WebSocket(url) as unknown as WebSocketLike,
};

/** Opens the channel and keeps it open until the returned function is called. */
export function openOrderSocket(
  orderId: string,
  handlers: OrderSocketHandlers,
  deps: SocketDeps = defaultSocketDeps,
): () => void {
  const topic = channel.order(orderId);
  const seen = new SeenEventIds();
  let lastSeq: number | undefined;
  let stopped = false;
  let attempt = 0;
  let socket: WebSocketLike | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let open = false;

  const setOpen = (next: boolean) => {
    if (open === next) return;
    open = next;
    handlers.onLink(next);
  };

  const scheduleReconnect = () => {
    if (stopped || retry) return;
    const delay = reconnectDelayMs(attempt++, deps.random);
    retry = setTimeout(() => {
      retry = undefined;
      void connect();
    }, delay);
  };

  const connect = async () => {
    if (stopped) return;
    let ws: WebSocketLike;
    try {
      const { ticket, websocket_url } = await deps.mintTicket();
      if (stopped) return;
      const sep = websocket_url.includes('?') ? '&' : '?';
      ws = deps.createSocket(
        `${websocket_url}${sep}ticket=${encodeURIComponent(ticket)}&client=customer-app&v=1`,
      );
    } catch {
      scheduleReconnect();
      return;
    }
    socket = ws;
    const send = (frame: object) => ws.send(JSON.stringify(frame));

    ws.onmessage = (e) => {
      let msg: RealtimeEnvelope;
      try {
        msg = JSON.parse(String(e.data)) as RealtimeEnvelope;
      } catch {
        return;
      }
      switch (msg.type) {
        case 'hello':
          attempt = 0;
          send({ type: 'subscribe', channel: topic });
          return;
        case 'subscribed':
          setOpen(true);
          // §6.3: every reconnect resumes from the last sequence number seen.
          if (lastSeq !== undefined) send({ type: 'resume', channel: topic, after_seq: lastSeq });
          return;
        case 'resume_complete':
          return;
        case 'subscribe_error':
        case 'unsubscribed':
          setOpen(false);
          return;
        case 'ping':
          send({ type: 'pong', t: (msg.data as { t?: number })?.t ?? Date.now() });
          return;
        default:
          break;
      }
      if (msg.channel !== topic || msg.v !== 1 || !seen.admit(msg.id)) return;
      if (hasGap(lastSeq, msg.seq)) send({ type: 'resume', channel: topic, after_seq: lastSeq });
      lastSeq = Math.max(lastSeq ?? 0, msg.seq);
      if (msg.type === 'rider.location') handlers.onRiderLocation(msg.data as RiderLocationData);
      else if (/^(order|payment|refund)\./.test(String(msg.type))) handlers.onOrderEvent?.(String(msg.type));
    };
    ws.onclose = () => {
      if (socket === ws) socket = null;
      setOpen(false);
      scheduleReconnect();
    };
    ws.onerror = () => {
      // `onclose` always follows; it owns the reconnect.
    };
  };

  void connect();

  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    if (socket) {
      socket.onclose = null;
      socket.close();
      socket = null;
    }
    setOpen(false);
  };
}
