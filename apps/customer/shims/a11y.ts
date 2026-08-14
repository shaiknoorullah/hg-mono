/**
 * Web-safe replacement for `@hg/ui-native/src/feedback/internal/a11y.ts`.
 *
 * That module's `moveAccessibilityFocus()` calls `findNodeHandle()`, which react-native-web
 * implements as `throw new Error('findNodeHandle is not supported on web')`. It is called from an
 * effect — `ErrorState` defaults `autoFocus` on for the `inline` variant, and `Sheet`/`Modal` move
 * focus to the dialog title on open — so on web the throw escapes into React and unmounts the
 * whole tree. A gallery that renders twenty inline error states goes completely blank.
 *
 * Metro's resolver points ui-native's imports of `internal/a11y` here (see `metro.config.js`).
 * Everything else in the module is re-exported unchanged; only the focus move is made web-safe, by
 * falling back to DOM focus, which is what `setAccessibilityFocus` is a proxy for anyway.
 *
 * This is a host-side adapter, not a fix: the library should guard the call itself. It is listed
 * in the gallery README as a finding.
 */
import { AccessibilityInfo, findNodeHandle } from 'react-native';

export {
  useAnnounceOnce,
  useReduceMotion,
  useScreenReader,
} from '../../../packages/ui-native/src/feedback/internal/a11y';
export type { FocusableRef } from '../../../packages/ui-native/src/feedback/internal/a11y';

/** Any RN host-component ref. Deliberately loose, matching the module this replaces. */
type Ref = { current: unknown };

export function moveAccessibilityFocus(ref: Ref): void {
  const target = ref?.current;
  if (!target) return;
  try {
    const node = findNodeHandle(target as never);
    if (node != null) AccessibilityInfo.setAccessibilityFocus(node as never);
  } catch {
    // react-native-web: no node handles. The ref already *is* the DOM element.
    const el = target as { focus?: (opts?: { preventScroll?: boolean }) => void };
    if (typeof el.focus === 'function') el.focus({ preventScroll: true });
  }
}
