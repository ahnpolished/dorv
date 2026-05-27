import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const sidepanelSource = readFileSync(
  join(repoRoot, "apps", "extension", "src", "sidepanel.tsx"),
  "utf8"
);

describe("HUM-1257 sidepanel query integration", () => {
  it("wraps sidepanel React with a TanStack Query provider", () => {
    expect(sidepanelSource).toContain("QueryClientProvider");
    expect(sidepanelSource).toContain("createSidepanelQueryClient");
  });

  it("keeps stale cached sync data while refetching and persists a curated snapshot", () => {
    expect(sidepanelSource).toContain("hydrateSidepanelCache");
    expect(sidepanelSource).toContain("queryClient.getQueryData<GitHubReviewComment[]>");
    expect(sidepanelSource).toContain("queryClient.fetchQuery");
    expect(sidepanelSource).toContain("persistSidepanelCacheSnapshot");
  });

  it("invalidates sync queries after sync and push mutations", () => {
    expect(sidepanelSource).toContain("invalidateSyncQueries");
    expect(sidepanelSource).toContain("queryClient.invalidateQueries");
    expect(sidepanelSource).toContain("queryClient.setQueryData<GoogleDocComment[]>");
  });
});

describe("HUM-1280 Activities tab replaces PR Info", () => {
  it("defines an Activities tab type", () => {
    expect(sidepanelSource).toContain('"activities"');
    expect(sidepanelSource).not.toContain('"info"');
  });

  it("renders an Activities tab button", () => {
    expect(sidepanelSource).toContain("Activities");
    expect(sidepanelSource).not.toContain("PR Info");
  });

  it("imports createActivityStore from stores", () => {
    expect(sidepanelSource).toContain("createActivityStore");
    expect(sidepanelSource).toContain("SyncedActivity");
  });

  it("read a SyncedActivity, create activityStore, and load activities in loadSyncData", () => {
    expect(sidepanelSource).toContain("activityStore");
    expect(sidepanelSource).toContain("activityStore.listByPR");
  });
});
