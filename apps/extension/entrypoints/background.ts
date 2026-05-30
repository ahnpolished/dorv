import { defineBackground } from "wxt/utils/define-background";
import { createAuthStore } from "../lib/storage/auth.js";
import { createChromeStorageArea } from "../lib/storage/area.js";
import { resolveAdapter } from "../lib/adapters/resolve.js";
import { captureExtensionException, initSentryForSurface } from "../lib/telemetry/sentry.js";
import { createDocStore, createStatusStore, createSettingsStore } from "../lib/storage/stores.js";
import { syncSidePanelForTabUrl, openSidePanelForTab } from "../lib/background/sidepanel.js";
import { isSidePanelSupported, isNativeSidePanelBrowser } from "../lib/compat.js";
import type { CreateDocInput, PullRequestRef } from "../lib/adapters/types.js";

// Sync every 2 minutes to reduce API calls and storage writes.
// The sidepanel also triggers syncs on user interaction, so this
// alarm is just a background safety net.
const SYNC_POLL_ALARM = "sync_poll";
const SYNC_POLL_MINUTES = 2;

interface ChromeMessage {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any;
}

export default defineBackground(() => {
  initSentryForSurface("background");
  const storageArea = createChromeStorageArea(chrome.storage.local);
  // Tracks which tabs currently have the side panel open so Alt+Shift+D can toggle.
  // State is best-effort: Chrome's sidePanel API has no "is open" query, so closing
  // via the browser's own X button won't update this set (next press re-opens).
  const panelOpenTabs = new Set<number>();
  const authStore = createAuthStore(storageArea, createChromeStorageArea(chrome.storage.managed));
  const docStore = createDocStore(storageArea);
  const statusStore = createStatusStore(storageArea);
  const settingsStore = createSettingsStore(storageArea);
  const useNativeSidePanel = isSidePanelSupported() && isNativeSidePanelBrowser();

  const startPolling = () => {
    void chrome.alarms.create(SYNC_POLL_ALARM, { periodInMinutes: SYNC_POLL_MINUTES });
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
      captureExtensionException(err, {
        extra: { alarm: SYNC_POLL_ALARM },
        surface: "background",
        tags: { operation: "poll" }
      });
    }
  };

  chrome.runtime.onInstalled.addListener(() => {
    if (isSidePanelSupported()) {
      void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
    startPolling();
    void handlePoll();
  });

  chrome.runtime.onStartup.addListener(() => {
    if (isSidePanelSupported()) {
      void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
    startPolling();
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_POLL_ALARM) {
      void handlePoll();
    }
  });

  chrome.runtime.onMessage.addListener((message: ChromeMessage, sender, sendResponse) => {
    // OPEN_SIDE_PANEL is handled here, outside the async wrapper below.
    // chrome.sidePanel.open() requires an unbroken user-gesture context; any prior
    // await inside openSidePanelForTab's async scope would cause rejection.
    // openSidePanelForTab now fires setOptions synchronously before calling open
    // so Chrome processes both IPC calls in order without consuming the gesture.
    if (message.type === "OPEN_SIDE_PANEL") {
      if (sender.tab?.id === undefined) {
        sendResponse({ success: false, error: "Cannot open side panel without a sender tab." });
        return false;
      }
      const tabId = sender.tab.id;
      const setOptions = useNativeSidePanel
        ? chrome.sidePanel.setOptions.bind(chrome.sidePanel)
        : () => Promise.resolve();
      const open = useNativeSidePanel
        ? chrome.sidePanel.open.bind(chrome.sidePanel)
        : () => Promise.reject(new Error("Side panel is not supported in this browser."));
      void openSidePanelForTab({
        tabId,
        setOptions,
        open
      })
        .then(() => {
          panelOpenTabs.add(tabId);
          try {
            sendResponse({ success: true });
          } catch {
            /* sender closed */
          }
        })
        .catch((err: unknown) => {
          try {
            sendResponse({ success: false, error: String(err) });
          } catch {
            /* sender closed */
          }
        });
      return true;
    }

    const safeSendResponse = (response: Record<string, unknown>) => {
      try {
        sendResponse(response);
      } catch {
        // Sender tab may have closed before the async handler resolved.
        // Chrome throws "message channel closed before a response was received"
        // — this is a no-op, safe to swallow.
      }
    };

    const run = async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const payload = message.payload;

        switch (message.type) {
          case "CREATE_DOC": {
            const backendUrl = await authStore.getBackendUrl();
            const adapter = resolveAdapter({
              backendUrl,
              authStore,
              storageArea
            });
            const result = await adapter.createDoc(payload as CreateDocInput);
            safeSendResponse({ success: true, payload: result });
            break;
          }
          case "SYNC_NOW": {
            const backendUrl = await authStore.getBackendUrl();
            const adapter = resolveAdapter({
              backendUrl,
              authStore,
              storageArea
            });
            await adapter.syncAll();
            safeSendResponse({ success: true });
            break;
          }
          case "GET_SYNC_STATUS": {
            const p = payload as PullRequestRef;
            const status = await statusStore.get(p.repo, p.prNumber);
            safeSendResponse({ success: true, payload: status });
            break;
          }
          case "CLOSE_SIDE_PANEL": {
            if (isSidePanelSupported()) {
              const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
              const tabId = tabs[0]?.id;
              if (tabId !== undefined) {
                panelOpenTabs.delete(tabId);
                await chrome.sidePanel.setOptions({ tabId, enabled: false });
              }
            }
            safeSendResponse({ success: true });
            break;
          }
          default:
            safeSendResponse({ success: false, error: `Unknown message type: ${message.type}` });
        }
      } catch (err) {
        console.error("Message handler failed:", err);
        captureExtensionException(err, {
          extra: { messageType: message.type },
          surface: "background",
          tags: { operation: "runtime_message" }
        });
        safeSendResponse({ success: false, error: String(err) });
      }
    };

    void run();
    return true;
  });

  const syncTabSidePanel = (tabId: number, url?: string) => {
    const setOptions = useNativeSidePanel
      ? chrome.sidePanel.setOptions.bind(chrome.sidePanel)
      : () => Promise.resolve();
    const open = useNativeSidePanel
      ? chrome.sidePanel.open.bind(chrome.sidePanel)
      : () => Promise.resolve();
    void syncSidePanelForTabUrl({
      tabId,
      url,
      docStore,
      settingsStore,
      setOptions,
      open,
      useNativeSidePanel
    }).catch((err: unknown) => {
      console.error("Side panel sync failed:", err);
      captureExtensionException(err, {
        extra: { tabId, url },
        surface: "background",
        tags: { operation: "sidepanel_sync" }
      });
    });
  };

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete" && changeInfo.url === undefined) return;
    if (!tab.active) return;
    syncTabSidePanel(tabId, tab.url ?? changeInfo.url);
  });

  chrome.tabs.onActivated.addListener(({ tabId }) => {
    chrome.tabs.get(tabId, (tab) => {
      syncTabSidePanel(tabId, tab.url);
    });
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    panelOpenTabs.delete(tabId);
  });

  chrome.commands.onCommand.addListener((command, tab) => {
    if (command !== "toggle-sidepanel") return;
    if (!isSidePanelSupported()) return;
    const tabId = tab?.id;
    if (tabId === undefined) return;
    if (panelOpenTabs.has(tabId)) {
      panelOpenTabs.delete(tabId);
      void chrome.sidePanel.setOptions({ tabId, enabled: false });
    } else {
      panelOpenTabs.add(tabId);
      void openSidePanelForTab({
        tabId,
        setOptions: chrome.sidePanel.setOptions.bind(chrome.sidePanel),
        open: chrome.sidePanel.open.bind(chrome.sidePanel)
      }).catch((err: unknown) => {
        console.error("[dorv] sidepanel toggle open failed:", err);
        captureExtensionException(err, {
          surface: "background",
          tags: { operation: "keyboard_shortcut_toggle" }
        });
      });
    }
  });
});
