/**
 * The phone's small-preferences storage, as the What's new last-seen store (https://github.com/shaiknoorullah/hg-mono/issues/1058). The same
 * module the rider app keeps its last-seen version in (`apps/rider/src/redesign/data/storage.ts`
 * `asyncStorageStore`); the customer app needs only the two methods `LastSeenStore` has.
 *
 * The native module is loaded on first use, so an environment without it (a test, a build that
 * left it out) fails at the call. `store.ts` already treats a read that throws as "cannot tell what
 * was seen" and shows nothing by itself, and a write that throws as "remembered for this run only".
 */
import type { LastSeenStore } from './store';

/** A `LastSeenStore` over AsyncStorage: `persistent` is true, so What's new may open by itself. */
export function asyncStorageLastSeenStore(): LastSeenStore {
  const storage = async () => (await import('@react-native-async-storage/async-storage')).default;
  return {
    persistent: true,
    async getItem(key) {
      return (await storage()).getItem(key);
    },
    async setItem(key, value) {
      await (await storage()).setItem(key, value);
    },
  };
}
