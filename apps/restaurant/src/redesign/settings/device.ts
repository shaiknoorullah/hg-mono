/**
 * What this browser can and has been allowed to do for an order (settings board `PartDevice`):
 * ring, show a notification, keep the screen awake. Read from the browser, never the server.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { chimeUrl } from '../strip/chime';
import { useDevicePrefs, type DevicePrefs } from '../data/devicePrefs';

export type NotificationsState = 'allowed' | 'ask' | 'asking' | 'blocked' | 'unsupported';
export type PlayState = 'idle' | 'playing' | 'blocked';

function permission(): NotificationPermission | 'unsupported' {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

export function canKeepScreenOn(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

/** The one-line summary the section list shows (board `ScreenSettings`, the "This device" row). */
export function deviceSummary(prefs: DevicePrefs, notifications: NotificationsState, playState: PlayState = 'idle'): string {
  if (playState === 'blocked') return 'Sound blocked by the browser';
  if (prefs.soundOff) return 'Order sound off';
  if (notifications === 'ask' || notifications === 'asking') return 'Sound on · notifications not on';
  if (notifications === 'blocked') return 'Sound on · notifications blocked';
  if (notifications === 'unsupported') return 'Sound on · notifications unavailable';
  if (!prefs.screenMayDim && !canKeepScreenOn()) return "Sound on · screen can't stay on";
  return 'Sound on · notifications allowed';
}

/** Notification permission as the section shows it, re-read when the person comes back to the tab. */
export function useNotifications(): { state: NotificationsState; ask: () => Promise<void> } {
  const [perm, setPerm] = useState(permission);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    const reread = () => setPerm(permission());
    window.addEventListener('focus', reread);
    document.addEventListener('visibilitychange', reread);
    return () => {
      window.removeEventListener('focus', reread);
      document.removeEventListener('visibilitychange', reread);
    };
  }, []);

  const ask = useCallback(async () => {
    if (typeof Notification === 'undefined') return;
    setAsking(true);
    try {
      await Notification.requestPermission();
    } catch {
      /* the browser refused to ask: the permission read below says what it is */
    }
    setPerm(permission());
    setAsking(false);
  }, []);

  const state: NotificationsState =
    perm === 'unsupported' ? 'unsupported' : perm === 'granted' ? 'allowed' : perm === 'denied' ? 'blocked' : asking ? 'asking' : 'ask';
  return { state, ask };
}

/** "Play the order sound": a real play inside the click, so a blocked browser says so. */
export function useSoundTest(): { state: PlayState; play: () => void } {
  const [state, setState] = useState<PlayState>('idle');
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);

  const play = useCallback(() => {
    try {
      const a = new Audio(chimeUrl());
      audio.current = a;
      a.onended = () => setState('idle');
      setState('playing');
      void a.play().catch(() => setState('blocked'));
    } catch {
      setState('blocked');
    }
  }, []);
  return { state, play };
}

export { useDevicePrefs };
