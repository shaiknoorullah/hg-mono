/**
 * Clipboard write for `ErrorState`'s technical detail, which 02-components.md §36 requires to be
 * "always copyable" — support cannot work from "something went wrong".
 *
 * `expo-clipboard` is an optional peer: the library must not hard-fail to import in a host that
 * has not installed it, in a jest run, or on a web surface. So it is resolved at call time and the
 * caller can always override with `onCopyDetail`.
 */
type ExpoClipboard = { setStringAsync?: (t: string) => Promise<unknown>; setString?: (t: string) => void };

function tryRequire(name: string): unknown {
  try {
    return (require as (id: string) => unknown)(name);
  } catch {
    return null;
  }
}

/** Returns whether the text actually reached a clipboard, so the UI can stay honest about it. */
export function copyToClipboard(text: string): boolean {
  const expo = tryRequire('expo-clipboard') as ExpoClipboard | null;
  if (expo?.setStringAsync) {
    void expo.setStringAsync(text);
    return true;
  }
  if (expo?.setString) {
    expo.setString(text);
    return true;
  }
  const rn = tryRequire('react-native') as { Clipboard?: { setString?: (t: string) => void } } | null;
  if (rn?.Clipboard?.setString) {
    rn.Clipboard.setString(text);
    return true;
  }
  return false;
}
