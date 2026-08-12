/**
 * Static replacement for `@hg/ui-native/src/feedback/internal/clipboard.ts`.
 *
 * That module resolves `expo-clipboard` through `tryRequire(name)` — a `require()` whose argument
 * is a *variable*. Metro's dependency collector rejects a non-literal `require` at transform time,
 * which fails the bundle before the module's own try/catch can do its job. Metro's resolver is
 * pointed here instead (see `metro.config.js`), so nothing in the library changes and the bundle
 * gets the same contract with a static import: `expo-clipboard` is a real dependency of this app,
 * so `ErrorState`'s "Copy technical detail" genuinely writes to the browser clipboard.
 */
import * as Clipboard from 'expo-clipboard';

/** Returns whether the text actually reached a clipboard, so the UI can stay honest about it. */
export function copyToClipboard(text: string): boolean {
  try {
    void Clipboard.setStringAsync(text);
    return true;
  } catch {
    return false;
  }
}
