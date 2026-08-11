import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * `useOrderAlert` — the never-miss-an-order affordance for the restaurant queue.
 *
 * Patterns §3.1 and a11y §8 make this a hard requirement rather than a nicety:
 *
 *  - "A new order raises a `Modal` with a `Countdown` and **an audible, repeating alert
 *    that does not stop until acknowledged**."
 *  - "*Audio blocked by autoplay policy* → a blocking one-time 'Enable sound' gate before
 *    the queue is usable, plus a persistent indicator that sound is on. A silent queue is
 *    not a functioning queue."
 *  - "the audible alert is **always paired with a visual flash** on the board and an
 *    OS-level notification" — because a deaf member of staff must not be worse served by
 *    the queue than a hearing one.
 *
 * The hook owns the *policy*: the arming gate, the repeat loop, the flash cadence, the
 * acknowledgement, and the reporting of a blocked context. The app owns the *asset* — it
 * passes a URL — and the chrome that renders `needsGate` / `soundState`.
 *
 * The flash toggles at 1 Hz. That is deliberately under the 3 Hz threshold in WCAG 2.3.1,
 * and it is not suppressed under `prefers-reduced-motion`, because it is the accessible
 * substitute for the sound rather than decoration. What reduced-motion changes is that
 * the consumer should render it as a steady tint swap, not an animated transition.
 */

export type OrderAlertSoundState =
  /** `arm()` has never been called. Audio will be blocked. The gate must be shown. */
  | 'unarmed'
  /** Armed and silent — nothing to alert about. */
  | 'armed'
  /** Armed and currently sounding. */
  | 'sounding'
  /** `arm()` was called and the browser refused. The queue is not safe to use. */
  | 'blocked'
  /** The consumer turned the hook off. */
  | 'disabled';

export interface UseOrderAlertOptions {
  /**
   * True while there is at least one unacknowledged order. The alert repeats for exactly
   * as long as this is true and `acknowledge()` has not been called for the current
   * `alertKey`.
   */
  active: boolean;
  /**
   * Identifies the current alerting condition — usually the id of the oldest
   * unacknowledged order, or a joined list of them. When it changes, a previous
   * acknowledgement is discarded: a *new* order sounds again even if the last one was
   * acknowledged a second ago.
   */
  alertKey?: string;
  /** The alert sound. The app supplies the asset; this package ships no audio. */
  soundUrl?: string;
  /** Gap between repeats, ms. Default 4000. */
  repeatMs?: number;
  /** Playback volume, 0–1. Default 1 — a kitchen is noisy. */
  volume?: number;
  /** Turn the whole thing off (e.g. the queue screen is not mounted). */
  enabled?: boolean;
  /** Fired when the browser refuses to play. Wire it to the blocking gate. */
  onBlocked?: (error: unknown) => void;
  /** Fired on each repeat, for telemetry ("the queue alerted N times before acknowledgement"). */
  onAlert?: (repeat: number) => void;
  /**
   * An OS-level notification raised alongside the sound, once per `alertKey`. Requires
   * `requestNotificationPermission()` to have been granted.
   */
  notification?: { title: string; body?: string; tag?: string };
}

export interface UseOrderAlertResult {
  soundState: OrderAlertSoundState;
  /** True while the gate has not been passed. Block the queue behind this. */
  needsGate: boolean;
  /**
   * Call from a real user gesture (a click on the "Enable sound" gate). Unlocks audio,
   * resolves `true` when the browser allowed it.
   */
  arm: () => Promise<boolean>;
  /** Stop the repeat for the current `alertKey`. Does not disarm the sound. */
  acknowledge: () => void;
  /** True/false at 1 Hz while alerting. Pair the sound with a visible flash. */
  flash: boolean;
  /** How many times the current condition has sounded. Surfaces "this has been ringing". */
  repeatCount: number;
  /** Ask for OS notification permission. Returns the resulting permission. */
  requestNotificationPermission: () => Promise<NotificationPermission | 'unsupported'>;
  /** The last playback error, for the gate's explanatory copy. */
  lastError: string | null;
}

const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';

export function useOrderAlert(options: UseOrderAlertOptions): UseOrderAlertResult {
  const {
    active,
    alertKey = 'default',
    soundUrl,
    repeatMs = 4000,
    volume = 1,
    enabled = true,
    onBlocked,
    onAlert,
    notification,
  } = options;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [armed, setArmed] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [flash, setFlash] = useState(false);
  const [repeatCount, setRepeatCount] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const acknowledgedKeyRef = useRef<string | null>(null);
  const notifiedKeyRef = useRef<string | null>(null);

  const [, forceRender] = useState(0);
  const acknowledged = acknowledgedKeyRef.current === alertKey;

  // A new condition invalidates the previous acknowledgement.
  useEffect(() => {
    if (acknowledgedKeyRef.current !== null && acknowledgedKeyRef.current !== alertKey) {
      acknowledgedKeyRef.current = null;
      forceRender((n) => n + 1);
    }
    setRepeatCount(0);
  }, [alertKey]);

  const alerting = enabled && active && !acknowledged;

  const ensureAudio = useCallback((): HTMLAudioElement | null => {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return null;
    if (!audioRef.current) {
      const element = new Audio(soundUrl ?? SILENT_WAV);
      element.preload = 'auto';
      audioRef.current = element;
    } else if (soundUrl && !audioRef.current.src.endsWith(soundUrl)) {
      audioRef.current.src = soundUrl;
    }
    audioRef.current.volume = Math.min(1, Math.max(0, volume));
    return audioRef.current;
  }, [soundUrl, volume]);

  const arm = useCallback(async (): Promise<boolean> => {
    const element = ensureAudio();
    if (!element) {
      setBlocked(true);
      setLastError('This browser cannot play audio.');
      return false;
    }
    try {
      // Play-then-reset inside the gesture is what actually unlocks the element.
      await element.play();
      element.pause();
      element.currentTime = 0;
      setArmed(true);
      setBlocked(false);
      setLastError(null);
      return true;
    } catch (cause) {
      setArmed(false);
      setBlocked(true);
      setLastError(
        cause instanceof Error
          ? cause.message
          : 'The browser blocked audio playback for this page.',
      );
      onBlocked?.(cause);
      return false;
    }
  }, [ensureAudio, onBlocked]);

  const acknowledge = useCallback(() => {
    acknowledgedKeyRef.current = alertKey;
    setFlash(false);
    forceRender((n) => n + 1);
  }, [alertKey]);

  /* The repeat loop. It does not stop until `active` goes false or `acknowledge()` is
     called — deliberately not a fixed number of repeats. */
  useEffect(() => {
    if (!alerting) return;

    let cancelled = false;
    let repeat = 0;

    const sound = (): void => {
      if (cancelled) return;
      repeat += 1;
      setRepeatCount(repeat);
      onAlert?.(repeat);
      const element = ensureAudio();
      if (!element) return;
      element.currentTime = 0;
      void element.play().catch((cause: unknown) => {
        setBlocked(true);
        setArmed(false);
        setLastError(
          cause instanceof Error ? cause.message : 'The browser blocked audio playback.',
        );
        onBlocked?.(cause);
      });
    };

    sound();
    const interval = window.setInterval(sound, Math.max(1000, repeatMs));
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      const element = audioRef.current;
      if (element) {
        element.pause();
        element.currentTime = 0;
      }
    };
  }, [alerting, repeatMs, ensureAudio, onAlert, onBlocked]);

  /* The visual pairing. 1 Hz — under the 3 Hz photosensitivity threshold, and present
     whether or not the sound is working. */
  useEffect(() => {
    if (!alerting) {
      setFlash(false);
      return;
    }
    setFlash(true);
    const interval = window.setInterval(() => setFlash((on) => !on), 1000);
    return () => window.clearInterval(interval);
  }, [alerting]);

  /* One OS notification per condition, never per repeat. */
  useEffect(() => {
    if (!alerting || !notification) return;
    if (notifiedKeyRef.current === alertKey) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    notifiedKeyRef.current = alertKey;
    try {
      // eslint-disable-next-line no-new -- the notification is fire-and-forget
      new Notification(notification.title, {
        body: notification.body,
        tag: notification.tag ?? alertKey,
        requireInteraction: true,
      });
    } catch {
      /* A failed notification must never take the queue down. */
    }
  }, [alerting, alertKey, notification]);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      audioRef.current = null;
    },
    [],
  );

  const requestNotificationPermission = useCallback(async (): Promise<
    NotificationPermission | 'unsupported'
  > => {
    if (typeof Notification === 'undefined') return 'unsupported';
    if (Notification.permission !== 'default') return Notification.permission;
    return Notification.requestPermission();
  }, []);

  const soundState: OrderAlertSoundState = !enabled
    ? 'disabled'
    : blocked
      ? 'blocked'
      : !armed
        ? 'unarmed'
        : alerting
          ? 'sounding'
          : 'armed';

  return {
    soundState,
    needsGate: enabled && (soundState === 'unarmed' || soundState === 'blocked'),
    arm,
    acknowledge,
    flash,
    repeatCount,
    requestNotificationPermission,
    lastError,
  };
}
