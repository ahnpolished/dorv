import { describe, expect, it, vi } from "vitest";
import { createMemoryStorageArea } from "../apps/extension/lib/storage/memory.js";
import { createDocStore, createSettingsStore } from "../apps/extension/lib/storage/stores.js";
import { syncSidePanelForTabUrl } from "../apps/extension/lib/background/sidepanel.js";
import type { DocMapping } from "../apps/extension/lib/adapters/types.js";

const mapping: DocMapping = {
  repo: "org/repo",
  prNumber: 12,
  docId: "doc-12",
  docUrl: "https://docs.google.com/document/d/doc-12/edit",
  createdAt: "2026-05-19T00:00:00Z",
  lastSyncedAt: "2026-05-19T00:00:00Z",
  headSha: "abc",
  latestSha: "abc",
  isStale: false
};

function makeDeps() {
  const storage = createMemoryStorageArea();
  const docStore = createDocStore(storage);
  const settingsStore = createSettingsStore(storage);
  const setOptions =
    vi.fn<(options: { tabId: number; path?: string; enabled: boolean }) => Promise<void>>();
  const open = vi.fn<(options: { tabId: number }) => Promise<void>>();
  return { docStore, settingsStore, setOptions, open };
}

describe("syncSidePanelForTabUrl", () => {
  it("opens the side panel for a previously synced GitHub PR", async () => {
    const deps = makeDeps();
    await deps.docStore.upsert(mapping);

    await syncSidePanelForTabUrl({
      tabId: 7,
      url: "https://github.com/org/repo/pull/12/files",
      ...deps
    });

    expect(deps.setOptions).toHaveBeenCalledWith({
      tabId: 7,
      path: "sidepanel.html",
      enabled: true
    });
    expect(deps.open).toHaveBeenCalledWith({ tabId: 7 });
  });

  it("opens the side panel for a previously synced Google Doc", async () => {
    const deps = makeDeps();
    await deps.docStore.upsert(mapping);

    await syncSidePanelForTabUrl({
      tabId: 8,
      url: "https://docs.google.com/document/d/doc-12/edit",
      ...deps
    });

    expect(deps.setOptions).toHaveBeenCalledWith({
      tabId: 8,
      path: "sidepanel.html",
      enabled: true
    });
    expect(deps.open).toHaveBeenCalledWith({ tabId: 8 });
  });

  it("does not auto-open when the setting is disabled", async () => {
    const deps = makeDeps();
    await deps.docStore.upsert(mapping);
    await deps.settingsStore.setAutoOpenSidepanel(false);

    await syncSidePanelForTabUrl({
      tabId: 9,
      url: "https://github.com/org/repo/pull/12",
      ...deps
    });

    expect(deps.setOptions).toHaveBeenCalledWith({
      tabId: 9,
      path: "sidepanel.html",
      enabled: true
    });
    expect(deps.open).not.toHaveBeenCalled();
  });

  it("disables the side panel when the URL is not linked", async () => {
    const deps = makeDeps();
    await deps.docStore.upsert(mapping);

    await syncSidePanelForTabUrl({
      tabId: 10,
      url: "https://github.com/org/repo/issues/12",
      ...deps
    });

    expect(deps.setOptions).toHaveBeenCalledWith({ tabId: 10, enabled: false });
    expect(deps.open).not.toHaveBeenCalled();
  });
});
