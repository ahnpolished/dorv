import type { StorageArea } from "./area.js";

export function createMemoryStorageArea(seed: Record<string, unknown> = {}): StorageArea {
  const values = new Map(Object.entries(seed));

  return {
    get(keys) {
      return Promise.resolve(Object.fromEntries(keys.map((key) => [key, values.get(key)])));
    },
    set(nextValues) {
      for (const [key, value] of Object.entries(nextValues)) {
        values.set(key, value);
      }
      return Promise.resolve();
    },
    remove(keys) {
      for (const key of keys) {
        values.delete(key);
      }
      return Promise.resolve();
    }
  };
}
