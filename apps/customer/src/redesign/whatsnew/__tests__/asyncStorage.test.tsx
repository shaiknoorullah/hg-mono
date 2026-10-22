/**
 * What's new keeps the last version it showed in the phone's storage (issue 1058): the
 * AsyncStorage-backed store is persistent, survives a relaunch, and a storage that fails leaves
 * What's new silent instead of repeating. `@react-native-async-storage/async-storage` is mocked
 * (`__mocks__/@react-native-async-storage/async-storage.js`), an in-memory map that outlives
 * `resetWhatsNew()`, which is what a relaunch of the app looks like to the store.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { asyncStorageLastSeenStore } from '../asyncStorage';
import { LAST_SEEN_KEY, markSeen, resetWhatsNew, setLastSeenStore, useSeen } from '../store';

const storage = AsyncStorage as typeof AsyncStorage & { __reset(): void };

beforeEach(() => {
  storage.__reset();
  resetWhatsNew();
});

afterEach(() => {
  jest.restoreAllMocks();
  resetWhatsNew();
});

describe("What's new last-seen store on AsyncStorage", () => {
  it('is persistent and round-trips through the phone storage', async () => {
    const store = asyncStorageLastSeenStore();
    expect(store.persistent).toBe(true);
    await store.setItem(LAST_SEEN_KEY, '1.2.0');
    expect(await AsyncStorage.getItem(LAST_SEEN_KEY)).toBe('1.2.0');
    expect(await store.getItem(LAST_SEEN_KEY)).toBe('1.2.0');
  });

  it('a first launch may open the sheet; once seen, a relaunch remembers it', async () => {
    setLastSeenStore(asyncStorageLastSeenStore());
    const first = renderHook(() => useSeen());
    await waitFor(() => expect(first.result.current.loaded).toBe(true));
    expect(first.result.current.canAutoShow).toBe(true);
    expect(first.result.current.lastSeen).toBeNull();

    act(() => markSeen('1.2.0'));
    await waitFor(async () => expect(await AsyncStorage.getItem(LAST_SEEN_KEY)).toBe('1.2.0'));
    first.unmount();

    // The app is closed and opened again: a fresh store over the same phone storage.
    setLastSeenStore(asyncStorageLastSeenStore());
    const second = renderHook(() => useSeen());
    await waitFor(() => expect(second.result.current.loaded).toBe(true));
    expect(second.result.current.lastSeen).toBe('1.2.0');
    expect(second.result.current.atLaunch).toBe('1.2.0');
  });

  it('storage that cannot be read keeps What\'s new from opening by itself', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValue(new Error('storage unavailable'));
    setLastSeenStore(asyncStorageLastSeenStore());
    const { result } = renderHook(() => useSeen());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.canAutoShow).toBe(false);
  });
});
