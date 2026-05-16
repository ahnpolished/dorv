import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const extensionRoot = join(repoRoot, "apps", "extension");

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
  });

  it("creates the GitHub content script and Google Docs side panel entrypoints", () => {
    expect(existsSync(join(extensionRoot, "entrypoints", "github-sidebar.content.tsx"))).toBe(true);
    expect(existsSync(join(extensionRoot, "entrypoints", "sidepanel.html"))).toBe(true);
    expect(existsSync(join(extensionRoot, "src", "sidepanel.tsx"))).toBe(true);
  });
});
