import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = join(process.cwd(), ".github", "workflows", "release.yml");

describe("release workflow", () => {
  const workflow = readFileSync(workflowPath, "utf8");

  it("builds the extension zip before publishing", () => {
    expect(workflow).toContain("pnpm --filter @dorv/extension zip");
    expect(workflow).toContain("GOOGLE_CLIENT_ID");
  });

  it("publishes through the Chrome Web Store v2 API", () => {
    expect(workflow).toContain(
      "https://chromewebstore.googleapis.com/upload/v2/publishers/${{ secrets.CWS_PUBLISHER_ID }}/items/${{ secrets.CWS_EXTENSION_ID }}:upload"
    );
    expect(workflow).toContain(
      "https://chromewebstore.googleapis.com/v2/publishers/${{ secrets.CWS_PUBLISHER_ID }}/items/${{ secrets.CWS_EXTENSION_ID }}:publish"
    );
  });

  it("creates the matching GitHub release and tag", () => {
    expect(workflow).toContain("gh release create");
    expect(workflow).toContain("v${{ steps.version.outputs.version }}");
  });
});
