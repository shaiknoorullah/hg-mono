/**
 * Shared accessibility internals for the navigation and feedback tiers.
 */
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, findNodeHandle } from 'react-native';

/**
 * `AccessibilityInfo.isReduceMotionEnabled`. Under reduced motion every duration collapses to 0
 * and slide/scale becomes cross-fade (01-foundations.md §7.4, 04-accessibility.md §6). Countdown
 * numerals are the documented exception and are not this tier's concern.
 */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (alive) setReduce(v);
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

/** `AccessibilityInfo.isScreenReaderEnabled`, for behaviour that must not fire without AT. */
export function useScreenReader(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((v) => {
        if (alive) setOn(v);
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setOn);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return on;
}

/** Any RN host-component ref. Deliberately loose: every component tier passes a different one. */
export type FocusableRef = { current: any };

/**
 * Move AT focus onto a node. Used when a sheet or modal opens, and when an `ErrorState` replaces
 * the content the user was acting on (04-accessibility.md §4.2).
 */
export function moveAccessibilityFocus(ref: FocusableRef): void {
  const node = ref.current ? findNodeHandle(ref.current as any) : null;
  if (node != null) AccessibilityInfo.setAccessibilityFocus(node);
}

/**
 * Announce a string exactly once per distinct value. The tracking timeline polls every 15 s and
 * re-renders constantly; announcing on every render would make the screen unusable, so state
 * changes announce "once per change, deduplicated" (02-components.md §23).
 */
export function useAnnounceOnce(message: string | null, enabled = true): void {
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !message || message === last.current) return;
    last.current = message;
    AccessibilityInfo.announceForAccessibility(message);
  }, [message, enabled]);
}
