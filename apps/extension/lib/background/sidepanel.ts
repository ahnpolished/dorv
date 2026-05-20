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
}

export async function syncSidePanelForTabUrl({
  tabId,
  url,
  docStore,
  settingsStore,
  setOptions,
  open
}: SyncSidePanelInput): Promise<void> {
  const linked = url ? await isLinkedReviewUrl(url, docStore) : false;
  if (!linked) {
    await setOptions({ tabId, enabled: false });
    return;
  }

  await setOptions({ tabId, path: "sidepanel.html", enabled: true });
  if (await settingsStore.getAutoOpenSidepanel()) {
    await open({ tabId });
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
  await open({ tabId });
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
