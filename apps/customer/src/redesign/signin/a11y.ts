/**
 * Focus helpers for the sign-in pages (manifest global rule 6: focus goes to the page's only h1 on
 * arrival, and to the error on failure). Hooks only; the pages compose DS components.
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
