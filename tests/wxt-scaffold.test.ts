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

  it("configures manifest permissions, hosts, oauth, and side panel", () => {
    const config = readFileSync(join(extensionRoot, "wxt.config.ts"), "utf8");

    expect(config).toContain("@wxt-dev/module-react");
    expect(config).toContain("storage");
    expect(config).toContain("identity");
    expect(config).toContain("alarms");
    expect(config).toContain("sidePanel");
    expect(config).toContain("https://github.com/*");
    expect(config).toContain("https://docs.google.com/*");
    expect(config).toContain("https://api.github.com/*");
    expect(config).toContain("https://www.googleapis.com/*");
    expect(config).toContain("GOOGLE_CLIENT_ID");
    expect(config).toContain("side_panel");
    expect(config).toContain("sidepanel.html");
    expect(config).toContain("commands");
    expect(config).toContain("toggle-sidepanel");
    expect(config).toContain("Alt+Shift+D");
  });

  it("configures extension icon assets", () => {
    const config = readFileSync(join(extensionRoot, "wxt.config.ts"), "utf8");

    expect(config).toContain("default_icon");
    expect(config).toContain("icon-16.png");
    expect(config).toContain("icon-48.png");
    expect(config).toContain("icon-128.png");

    for (const asset of [
      "dorv.svg",
      "dorv-sync.svg",
      "status-icons.svg",
      "icon-16.png",
      "icon-48.png",
      "icon-128.png"
    ]) {
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

    const syncSvg = readFileSync(join(extensionRoot, "public", "dorv-sync.svg"), "utf8");
    expect(syncSvg).toContain("animation: spin 1s linear infinite");
    expect(syncSvg).toContain("prefers-reduced-motion");

    const statusSprite = readFileSync(join(extensionRoot, "public", "status-icons.svg"), "utf8");
    for (const symbol of ["status-linked", "status-stale", "status-error", "status-syncing"]) {
      expect(statusSprite).toContain(`id="${symbol}"`);
    }
  });

  it("creates the GitHub content script and Google Docs side panel entrypoints", () => {
    expect(existsSync(join(extensionRoot, "entrypoints", "github-sidebar.content.tsx"))).toBe(true);
    expect(existsSync(join(extensionRoot, "entrypoints", "sidepanel.html"))).toBe(true);
    expect(existsSync(join(extensionRoot, "src", "sidepanel.tsx"))).toBe(true);
  });
});
