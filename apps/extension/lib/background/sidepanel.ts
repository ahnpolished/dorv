import type { createDocStore, createSettingsStore } from "../storage/stores.js";
import { parseDocId } from "../gdoc/urls.js";
import { parseGitHubPullRequestUrl } from "../github/pr-files.js";
type DocStore = ReturnType<typeof createDocStore>;
type SettingsStore = ReturnType<typeof createSettingsStore>;
type SidePanelSetOptions = (options: {
  tabId: number;
  path?: string;
  enabled: boolean;
}) => Promise<void>;
type SidePanelOpen = (options: { tabId: number }) => Promise<void>;

interface SyncSidePanelInput {
  tabId: number;
  url: string | undefined;
  docStore: DocStore;
  settingsStore: SettingsStore;
  setOptions: SidePanelSetOptions;
  open: SidePanelOpen;
  useNativeSidePanel: boolean;
}

export async function syncSidePanelForTabUrl({
  tabId,
  url,
  docStore,
  settingsStore,
  setOptions,
  open,
  useNativeSidePanel
}: SyncSidePanelInput): Promise<void> {
  const linked = url ? await isLinkedReviewUrl(url, docStore) : false;
  if (!linked) {
    await setOptions({ tabId, enabled: false });
    return;
  }

  await setOptions({ tabId, path: "sidepanel.html", enabled: true });
  if (await settingsStore.getAutoOpenSidepanel()) {
    if (useNativeSidePanel) {
      try {
        await open({ tabId });
      } catch (err) {
        // sidePanel.open() often requires a user gesture.
        // We log but don't fail, as setOptions already enabled the panel for manual opening.
        console.debug("[dorv] sidePanel.open failed (expected if no gesture):", err);
      }
    } else {
      await ensureSidepanelTabOpen();
    }
  }
}

async function ensureSidepanelTabOpen() {
  await openSidepanelTab(false);
}

async function openSidepanelTab(active: boolean) {
  const url = chrome.runtime.getURL("sidepanel.html");
  const tabs = await chrome.tabs.query({ url });
  if (tabs.length === 0) {
    await chrome.tabs.create({ url, active });
    return;
  }

  const existingTabId = tabs[0]?.id;
  if (active && existingTabId !== undefined) {
    await chrome.tabs.update(existingTabId, { active: true });
  }
}

export async function openSidePanelForTab({
  tabId,
  setOptions,
  open
}: {
  tabId: number;
  setOptions: SidePanelSetOptions;
  open: SidePanelOpen;
}): Promise<void> {
  // Fire setOptions and open without an await between them.
  // Chrome's IPC channel processes messages in order, so setOptions
  // completes before open resolves. The key constraint: no await may
  // occur between the two calls — doing so would consume the user-gesture
  // context that chrome.sidePanel.open() requires.
  const enablePanel = setOptions({ tabId, path: "sidepanel.html", enabled: true });
  try {
    await open({ tabId });
  } catch {
    await enablePanel;
    await openSidepanelTab(true);
  }
}

async function isLinkedReviewUrl(url: string, docStore: DocStore): Promise<boolean> {
  const docId = parseDocId(url);
  if (docId) {
    return (await docStore.getByDocId(docId)) !== undefined;
  }

  const ref = parseGitHubPullRequestUrl(url);
  if (!ref) return false;

  const mapping = await docStore.get(`${ref.owner}/${ref.repo}`, ref.prNumber);
  return mapping !== undefined;
}
