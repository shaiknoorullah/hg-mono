/**
 * Where the redesign keeps state that must survive the app being killed (the transition
 * outbox). A two-method interface so the backing store is one line in `RedesignApp`.
 *
 * Today it is memory: `@react-native-async-storage/async-storage` is not a dependency of this
 * app, and only the DS track adds dependencies (MASTER-PLAN §3). The request is filed as
 * `ds-request(native): AsyncStorage dependency for the rider outbox`. Until it lands, a killed
 * app loses unsent steps, exactly as the legacy app does; the outbox tests run against a
 * persistent fake that models a kill and relaunch.
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
