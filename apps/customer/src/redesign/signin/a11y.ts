/**
 * Focus helpers for the sign-in pages (manifest global rule 6: focus goes to the page's only h1 on
 * arrival, and to the error on failure). The pages compose DS components.
 *
 * The DS Input forwards no ref, so a page cannot move focus into an invalid field yet (ds-request:
 * Input ref / focus). Until it can, a failed submit announces the field's error with
 * `announceError`, so a screen-reader user hears it at once instead of finding it later.
 */
import * as React from 'react';
import { AccessibilityInfo, findNodeHandle } from 'react-native';

/** Move screen-reader focus to `ref` once it has mounted (and again whenever `key` changes). */
export function useFocusOnMount(ref: React.RefObject<unknown>, key: unknown = null, enabled = true): void {
  React.useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => {
      try {
        const node = ref.current ? findNodeHandle(ref.current as never) : null;
        if (node) AccessibilityInfo.setAccessibilityFocus(node);
      } catch {
        // Focus is a courtesy; a renderer without accessibility focus just skips it.
      }
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
}

/**
 * Say a submit's error out loud (manifest global rule 6, boards `SI/*-invalidfocus`). Call it with
 * the first invalid field's error, in reading order, each time a submit fails validation.
 */
export function announceError(message: string): void {
  try {
    AccessibilityInfo.announceForAccessibility(message);
  } catch {
    // A renderer without announcements just skips it; the error is still drawn in the field.
  }
}
