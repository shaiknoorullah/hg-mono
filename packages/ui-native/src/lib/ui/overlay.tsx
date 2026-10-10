/**
 * The plumbing every overlay of the className tier shares (design-system N2): Sheet, Modal and
 * Toast render through `@rn-primitives/portal` into the app's root `<PortalHost />`.
 *
 * Why a portal and not React Native's `Modal`: overlays must stack by `z-*` role (a toast over a
 * sheet, the rider offer over EVERYTHING, including an open sheet), and on iOS a second RN
 * `Modal` presented while another is visible is presented from the same view controller and
 * fails. A portal layer is ordinary views, ordered by the z-index tokens.
 *
 * What the portal costs, and how it is paid:
 *   - React context does not cross it. Content is rendered under the host, so the `/ds` layer
 *     passes `wrap` to re-provide its `ThemeProvider` around the portalled tree; safe-area
 *     insets are read outside and passed in as numbers.
 *   - No native modality. The panel sets `accessibilityViewIsModal` (iOS traps VoiceOver in it),
 *     focus moves to the title on open, and the Android back button is handled here.
 */
import * as React from 'react';
import { AccessibilityInfo, BackHandler, findNodeHandle } from 'react-native';
import { Portal } from '@rn-primitives/portal';

/** Re-provides context around portalled content (the `/ds` layer passes its ThemeProvider). */
export type OverlayWrap = (node: React.ReactElement) => React.ReactElement;

const identity: OverlayWrap = (node) => node;

/** Renders `children` into the root PortalHost under a name unique to this mount. */
export function OverlayPortal({ children, wrap = identity }: { children: React.ReactElement; wrap?: OverlayWrap }) {
  const id = React.useId();
  return <Portal name={`hg-overlay-${id}`}>{wrap(children)}</Portal>;
}

/**
 * Android hardware back while an overlay is open: always consumed, so it never falls through to
 * the screen underneath (for the rider offer that would be the "rider loses the offer" bug);
 * `onDismiss` runs only when the overlay is dismissible.
 */
export function useBackToDismiss(onDismiss: (() => void) | undefined): void {
  const latest = React.useRef(onDismiss);
  latest.current = onDismiss;
  React.useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      latest.current?.();
      return true;
    });
    return () => sub.remove();
  }, []);
}

/** Moves screen-reader focus to `ref` after `delayMs` (the entry animation), once per mount. */
export function useInitialFocus(ref: React.RefObject<unknown>, delayMs: number): void {
  React.useEffect(() => {
    const t = setTimeout(() => {
      const node = ref.current ? findNodeHandle(ref.current as never) : null;
      if (node != null) AccessibilityInfo.setAccessibilityFocus(node);
    }, delayMs);
    return () => clearTimeout(t);
    // Once per open (empty deps): a re-render must not pull focus back to the start.
  }, []);
}
