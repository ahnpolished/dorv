import { defineBackground } from "wxt/utils/define-background";
import { createAuthStore } from "../lib/storage/auth.js";
import { createChromeStorageArea } from "../lib/storage/area.js";
import { resolveAdapter } from "../lib/adapters/resolve.js";

const SYNC_POLL_ALARM = "sync_poll";

export default defineBackground(() => {
  const storageArea = createChromeStorageArea(chrome.storage.local);
  const authStore = createAuthStore(storageArea);

  const startPolling = () => {
    void chrome.alarms.create(SYNC_POLL_ALARM, { periodInMinutes: 2 });
  };

  const handlePoll = async () => {
    try {
      const backendUrl = await authStore.getBackendUrl();
      const adapter = resolveAdapter({
        backendUrl,
        authStore,
        storageArea
      });
      await adapter.syncAll();
    } catch (err) {
      console.error("Background poll failed:", err);
    }
  };

  chrome.runtime.onInstalled.addListener(() => {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    startPolling();
    // Trigger immediate poll on install
    void handlePoll();
  });

  chrome.runtime.onStartup.addListener(() => {
    startPolling();
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_POLL_ALARM) {
      void handlePoll();
    }
  });
});
