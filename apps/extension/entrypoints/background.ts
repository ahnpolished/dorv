import { defineBackground } from "wxt/utils/define-background";
import { createAuthStore } from "../lib/storage/auth.js";
import { createChromeStorageArea } from "../lib/storage/area.js";
import { resolveAdapter } from "../lib/adapters/resolve.js";
import { createStatusStore } from "../lib/storage/stores.js";

const SYNC_POLL_ALARM = "sync_poll";

export default defineBackground(() => {
  const storageArea = createChromeStorageArea(chrome.storage.local);
  const authStore = createAuthStore(storageArea);
  const statusStore = createStatusStore(storageArea);

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

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const run = async () => {
      try {
        const backendUrl = await authStore.getBackendUrl();
        const adapter = resolveAdapter({
          backendUrl,
          authStore,
          storageArea
        });

        switch (message.type) {
          case "CREATE_DOC": {
            const result = await adapter.createDoc(message.payload);
            sendResponse({ success: true, payload: result });
            break;
          }
          case "SYNC_NOW": {
            await adapter.syncAll(); // Current baseline syncs all active PRs
            sendResponse({ success: true });
            break;
          }
          case "GET_SYNC_STATUS": {
            const status = await statusStore.get(message.payload.repo, message.payload.prNumber);
            sendResponse({ success: true, payload: status });
            break;
          }
          default:
            sendResponse({ success: false, error: `Unknown message type: ${message.type}` });
        }
      } catch (err) {
        console.error("Message handler failed:", err);
        sendResponse({ success: false, error: String(err) });
      }
    };

    void run();
    return true; // Keep channel open for async response
  });
});
