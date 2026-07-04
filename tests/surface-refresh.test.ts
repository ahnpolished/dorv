import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const extensionRoot = join(repoRoot, "apps", "extension");

function read(path: string): string {
  return readFileSync(join(extensionRoot, path), "utf8");
}

describe("HUM-1230 surface refresh", () => {
  it("keeps hardcoded hex colors out of tokenized surface component files", () => {
    // gdoc-buttons.content.tsx intentionally uses hardcoded Google Sans /
    // #1a73e8 colors — the Docs-side surface deliberately does not share the
    // GitHub-side design token system (see AGENTS.md UI bar).
    for (const path of [
      "entrypoints/github-buttons.content.tsx",
      "src/options.tsx",
      "src/options.css"
    ]) {
      expect(read(path), path).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });

  it("wires GitHub action buttons to shared tokens, animations, state entry, and per-file sync", () => {
    const source = read("entrypoints/github-buttons.content.tsx");

    expect(source).toContain("tokensCss");
    expect(source).toContain("animationsCss");
    expect(source).toContain("dorv-state-enter");
    // v0.3.0: per-file compact buttons use emoji + title-based tooltips
    // instead of the removed sidebar panel with SVG sync icon.
    expect(source).toContain("handleSync");
    expect(source).toContain("dorv-file-btn-sync");
  });

  it("wires Options page to the branded header and animated save confirmation", () => {
    const source = read("src/options.tsx");

    expect(source).toContain('src="/dorv.svg"');
    expect(source).toContain('className="options-shell dorv-state-enter"');
    expect(source).toContain("dorv-skeleton");
    expect(source).toContain("save-confirmation");
  });
});
