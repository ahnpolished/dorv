import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const sidepanelSource = readFileSync(
  join(repoRoot, "apps", "extension", "src", "sidepanel.tsx"),
  "utf8"
);

describe("HUM-1273 sidepanel comment anchors", () => {
  it("renders an icon button on GitHub comment cards that links to the native GitHub comment", () => {
    expect(sidepanelSource).toContain('label="Open GitHub comment"');
    expect(sidepanelSource).toContain("href={thread.root.htmlUrl}");
  });

  it("renders an icon button on Google Doc comment cards that links back to the doc", () => {
    expect(sidepanelSource).toContain('label="Open Google Doc comment"');
    expect(sidepanelSource).toContain("href={mapping.docUrl}");
  });
});
