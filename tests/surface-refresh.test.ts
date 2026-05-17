import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const extensionRoot = join(repoRoot, "apps", "extension");

function read(path: string): string {
  return readFileSync(join(extensionRoot, path), "utf8");
}

describe("HUM-1230 surface refresh", () => {
  it("keeps hardcoded hex colors out of surface component files", () => {
    for (const path of [
      "entrypoints/github-sidebar.content.tsx",
      "src/sidepanel.tsx",
      "src/sidepanel.css",
      "src/options.tsx",
      "src/options.css"
    ]) {
      expect(read(path), path).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });

  it("wires PR sidebar to shared tokens, animations, skeletons, state entry, and mono paths", () => {
    const source = read("entrypoints/github-sidebar.content.tsx");

    expect(source).toContain("tokensCss");
    expect(source).toContain("animationsCss");
    expect(source).toContain("dorv-state-enter");
    expect(source).toContain("dorv-skeleton");
    expect(source).toContain("dorv-file-path");
    expect(source).toContain("dorv-sync.svg");
  });

  it("wires DocSidebar to tokenized controls, nav buttons, skeletons, and push success", () => {
    const source = read("src/sidepanel.tsx");

    expect(source).toContain('className="dorv-icon-btn"');
    expect(source).toContain("ti-brand-github");
    expect(source).toContain("ti-file-description");
    expect(source).toContain("dorv-skeleton");
    expect(source).toContain("dorv-check-path");
    expect(source).not.toContain("style={{");
  });

  it("wires Options page to the branded header and animated save confirmation", () => {
    const source = read("src/options.tsx");

    expect(source).toContain('src="/dorv.svg"');
    expect(source).toContain('className="options-shell dorv-state-enter"');
    expect(source).toContain("dorv-skeleton");
    expect(source).toContain("save-confirmation");
  });
});
