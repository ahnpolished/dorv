import type { createDocStore, createSettingsStore } from "../storage/stores.js";
import { parseDocId } from "../gdoc/urls.js";
import { parseGitHubPullRequestUrl } from "../github/pr-files.js";
import type { BrowserKind } from "../compat.js";

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
  browserKind: BrowserKind;
}

export async function syncSidePanelForTabUrl({
  tabId,
  url,
  docStore,
  settingsStore,
  setOptions,
  open,
  browserKind
}: SyncSidePanelInput): Promise<void> {
  const linked = url ? await isLinkedReviewUrl(url, docStore) : false;
  if (!linked) {
    await setOptions({ tabId, enabled: false });
    return;
  }

  await setOptions({ tabId, path: "sidepanel.html", enabled: true });
  if (browserKind === "chrome" && (await settingsStore.getAutoOpenSidepanel())) {
    try {
      await open({ tabId });
    } catch (err) {
      // sidePanel.open() often requires a user gesture.
      // We log but don't fail, as setOptions already enabled the panel for manual opening.
      console.debug("[dorv] sidePanel.open failed (expected if no gesture):", err);
    }
  } else if (browserKind !== "chrome" && (await settingsStore.getAutoOpenSidepanel())) {
    await ensureSidepanelTabOpen();
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
  await setOptions({ tabId, path: "sidepanel.html", enabled: true });
  try {
    await open({ tabId });
  } catch {
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
