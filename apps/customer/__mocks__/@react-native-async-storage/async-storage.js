/**
 * Manual Jest mock for `@react-native-async-storage/async-storage`: its native module is not in
 * this app's plain `react-native` preset. An in-memory map with the three methods the app calls;
 * `__reset()` empties it between tests.
 */
const map = new Map();
const storage = {
  getItem: async (key) => (map.has(key) ? map.get(key) : null),
  setItem: async (key, value) => {
    map.set(key, value);
  },
  removeItem: async (key) => {
    map.delete(key);
  },
  __reset: () => map.clear(),
};
module.exports = { __esModule: true, default: storage };
