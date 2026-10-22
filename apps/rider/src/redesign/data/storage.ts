/**
 * Where the redesign keeps state that must survive the app being killed (the transition
 * outbox). A two-method interface so the backing store is one line in `RedesignApp`.
 *
 * The outbox still runs on memory (`memoryStore`): a killed app loses unsent steps, exactly as
 * the legacy app does, and its tests run against a persistent fake that models a kill and
 * relaunch. `@react-native-async-storage/async-storage` is a dependency of this app, and
 * `asyncStorageStore` is the phone's small-preferences storage over it: What's new keeps the
 * last version it showed there (`history/whatsNew.ts`).
 */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    async getItem(key) {
      return map.has(key) ? map.get(key)! : null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
    async removeItem(key) {
      map.delete(key);
    },
  };
}

/**
 * The phone's small-preferences storage. The native module is loaded on first use, so an
 * environment without it (a test, the web build) fails at the call, where callers already
 * handle a storage that throws, instead of at import.
 */
export function asyncStorageStore(): KeyValueStore {
  const storage = async () => (await import('@react-native-async-storage/async-storage')).default;
  return {
    async getItem(key) {
      return (await storage()).getItem(key);
    },
    async setItem(key, value) {
      await (await storage()).setItem(key, value);
    },
    async removeItem(key) {
      await (await storage()).removeItem(key);
    },
  };
}
