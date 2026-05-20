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
