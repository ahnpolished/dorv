import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const extensionRoot = join(repoRoot, "apps", "extension");

function readPngSize(path: string): { width: number; height: number } {
  const buffer = readFileSync(path);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

describe("HUM-1194 WXT extension scaffold", () => {
  it("adds an extension workspace with WXT scripts", () => {
    const rootPackage = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const extensionPackage = JSON.parse(
      readFileSync(join(extensionRoot, "package.json"), "utf8")
    ) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts.dev).toBe("pnpm --filter @dorv/extension dev");
    expect(rootPackage.scripts.zip).toBe("pnpm --filter @dorv/extension zip");
    expect(extensionPackage.scripts.dev).toBe("wxt");
    expect(extensionPackage.scripts.build).toBe("wxt build");
    expect(extensionPackage.scripts.zip).toBe("wxt zip");
  });

  it("configures manifest permissions, hosts, and oauth", () => {
    const config = readFileSync(join(extensionRoot, "wxt.config.ts"), "utf8");

    expect(config).toContain("@wxt-dev/module-react");
    expect(config).toContain("storage");
    expect(config).toContain("identity");
    expect(config).not.toContain("alarms");
    expect(config).not.toContain("sidePanel");
    expect(config).toContain("https://github.com/*");
    expect(config).toContain("https://docs.google.com/*");
    expect(config).toContain("https://api.github.com/*");
    expect(config).toContain("https://www.googleapis.com/*");
    expect(config).toContain("https://www.googleapis.com/auth/drive.file");
    expect(config).not.toContain("https://www.googleapis.com/auth/documents");
    expect(config).toContain("GOOGLE_CLIENT_ID");
    expect(config).not.toContain("side_panel");
    expect(config).not.toContain("sidepanel.html");
    expect(config).not.toContain("toggle-sidepanel");
  });

  it("configures extension icon assets", () => {
    const config = readFileSync(join(extensionRoot, "wxt.config.ts"), "utf8");

    expect(config).toContain("default_icon");
    expect(config).toContain("icon-16.png");
    expect(config).toContain("icon-48.png");
    expect(config).toContain("icon-128.png");

    for (const asset of ["dorv.svg", "icon-16.png", "icon-48.png", "icon-128.png"]) {
      expect(existsSync(join(extensionRoot, "public", asset))).toBe(true);
    }

    expect(readPngSize(join(extensionRoot, "public", "icon-16.png"))).toEqual({
      width: 16,
      height: 16
    });
    expect(readPngSize(join(extensionRoot, "public", "icon-48.png"))).toEqual({
      width: 48,
      height: 48
    });
    expect(readPngSize(join(extensionRoot, "public", "icon-128.png"))).toEqual({
      width: 128,
      height: 128
    });
  });

  it("creates the GitHub and Google Docs button content scripts", () => {
    expect(existsSync(join(extensionRoot, "entrypoints", "github-buttons.content.tsx"))).toBe(true);
    expect(existsSync(join(extensionRoot, "entrypoints", "gdoc-buttons.content.tsx"))).toBe(true);
  });
});
