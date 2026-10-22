/**
 * React binding for `RealtimeConnection`: one provider per signed-in app, hooks per screen.
 *
 * `useRealtimeChannel(channel, handler)` listens while the component is mounted;
 * `useRealtimeStatus()` tells a screen whether to poll REST instead (anything but `open`).
 * Without a provider both hooks are inert and the status reads `offline`, so a screen
 * rendered in a test or a gallery takes its polling path and never opens a socket.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { RealtimeEnvelope, RealtimeEventMap, RealtimeEventType } from '@hg/api-client';
import {
  RealtimeConnection,
  type ChannelSignal,
  type RealtimeConnectionOptions,
  type RealtimeStatus,
  type ReplayResult,
  type SubscribeErrorInfo,
  type RetryInfo,
  type SubscribeOptions,
} from './realtimeConnection.js';

interface RealtimeContextValue {
  connection: RealtimeConnection;
  status: RealtimeStatus;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

/** Props for `RealtimeProvider`: the connection options, minus the status callback it owns. */
export interface RealtimeProviderProps extends Omit<RealtimeConnectionOptions, 'onStatus'> {
  children: ReactNode;
  /** `false` keeps the socket closed (signed out). Default `true`. */
  enabled?: boolean;
}

/** Opens one realtime connection for the subtree and closes it on unmount. */
export function RealtimeProvider({ children, enabled = true, ...options }: RealtimeProviderProps) {
  const [status, setStatus] = useState<RealtimeStatus>('idle');
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [connection] = useState(
    () =>
      new RealtimeConnection({
        // Late-bound so the provider's latest props are used on every reconnect.
        mintTicket: () => optionsRef.current.mintTicket(),
        getAccessToken: () => optionsRef.current.getAccessToken?.() ?? null,
        client: options.client,
        apiBaseUrl: options.apiBaseUrl,
        socketUrl: options.socketUrl,
        createSocket: options.createSocket,
        random: options.random,
        onStatus: setStatus,
        onReauthRequired: (info) => optionsRef.current.onReauthRequired?.(info),
        onFatalClose: (info) => optionsRef.current.onFatalClose?.(info),
      }),
  );

  useEffect(() => {
    if (!enabled) return;
    connection.start();
    return () => connection.stop();
  }, [connection, enabled]);

  return <RealtimeContext.Provider value={{ connection, status }}>{children}</RealtimeContext.Provider>;
}

/** The connection status; `offline` when there is no provider. */
export function useRealtimeStatus(): RealtimeStatus {
  return useContext(RealtimeContext)?.status ?? 'offline';
}

/** A realtime event narrowed to its catalogue type. */
export type TypedRealtimeEvent<K extends RealtimeEventType = RealtimeEventType> = RealtimeEnvelope<K, RealtimeEventMap[K]>;

/**
 * Listens on `channel` (or nothing when `null`) for the component's lifetime. The handler
 * may change between renders without resubscribing.
 */
export function useRealtimeChannel(
  channel: string | null,
  handler: (signal: ChannelSignal) => void,
  options?: SubscribeOptions,
): void {
  const ctx = useContext(RealtimeContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const connection = ctx?.connection;
  const backfill = options?.backfill;
  const replayRef = useRef(options?.onReplay);
  replayRef.current = options?.onReplay;
  const wantsReplay = Boolean(options?.onReplay);
  const subscribeErrorRef = useRef(options?.onSubscribeError);
  subscribeErrorRef.current = options?.onSubscribeError;
  const wantsSubscribeError = Boolean(options?.onSubscribeError);
  useEffect(() => {
    if (!connection || !channel) return;
    return connection.subscribe(channel, (signal) => handlerRef.current(signal), {
      ...(backfill ? { backfill } : {}),
      ...(wantsReplay ? { onReplay: (result: ReplayResult) => replayRef.current?.(result) } : {}),
      ...(wantsSubscribeError ? { onSubscribeError: (error: SubscribeErrorInfo) => subscribeErrorRef.current?.(error) } : {}),
    });
  }, [connection, channel, backfill, wantsReplay, wantsSubscribeError]);
}

/** What a screen needs to show "Trying again in 8 seconds" and to offer "Reconnect now". */
export interface RealtimeControls {
  readonly retry: () => RetryInfo;
  readonly reconnectNow: () => void;
}

const NO_CONTROLS: RealtimeControls = { retry: () => ({ attempt: 0, nextAt: null, cause: null }), reconnectNow: () => undefined };

/** The connection's retry state and "reconnect now"; inert without a provider. */
export function useRealtimeControls(): RealtimeControls {
  const ctx = useContext(RealtimeContext);
  const connection = ctx?.connection;
  return connection ? { retry: () => connection.retry, reconnectNow: () => connection.reconnectNow() } : NO_CONTROLS;
}

/**
 * Listens on many channels at once — the operations map follows every active order. The
 * channel list is compared by value, so a new array with the same members does not churn
 * subscriptions.
 */
export function useRealtimeChannels(channels: readonly string[], handler: (signal: ChannelSignal) => void): void {
  const ctx = useContext(RealtimeContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const connection = ctx?.connection;
  const key = [...channels].sort().join('|');
  useEffect(() => {
    if (!connection || !key) return;
    const offs = key.split('|').map((channel) => connection.subscribe(channel, (signal) => handlerRef.current(signal)));
    return () => offs.forEach((off) => off());
  }, [connection, key]);
}

/** Narrows a signal to one event type, or `null`. */
export function eventOfType<K extends RealtimeEventType>(signal: ChannelSignal, type: K): TypedRealtimeEvent<K> | null {
  if (signal.kind !== 'event' || signal.event.type !== type) return null;
  return signal.event as TypedRealtimeEvent<K>;
}
