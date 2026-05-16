export interface StorageArea {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export function createChromeStorageArea(area: chrome.storage.StorageArea): StorageArea {
  return {
    async get(keys) {
      return area.get(keys);
    },
    async set(values) {
      await area.set(values);
    },
    async remove(keys) {
      await area.remove(keys);
    }
  };
}
