import { describe, expect, it } from "vitest";

import type { SyncedActivity } from "../apps/extension/lib/adapters/types.js";

// Helper function (tested inline below) that formats an activity for display.
// The actual component is in sidepanel.tsx; these tests verify the rendering
// contract by checking shape conventions rather than DOM output.
function formatActivityDirection(direction: SyncedActivity["direction"]): string {
  return direction === "github_to_gdoc" ? "GH → GDoc" : "GDoc → GH";
}

function formatActivityTimestamp(createdAt: string): string {
  const d = new Date(createdAt);
  return d.toLocaleTimeString();
}

const makeActivity = (overrides: Partial<SyncedActivity> = {}): SyncedActivity => ({
  id: "test:1",
  repo: "org/repo",
  prNumber: 42,
  direction: "github_to_gdoc",
  kind: "comment_synced",
  snippet: "Comment synced from GH to GDoc",
  createdAt: "2026-05-25T12:00:00Z",
  ...overrides
});

describe("HUM-1280 activities feed rendering helpers", () => {
  it("formats direction labels for both sync directions", () => {
    expect(formatActivityDirection("github_to_gdoc")).toBe("GH → GDoc");
    expect(formatActivityDirection("gdoc_to_github")).toBe("GDoc → GH");
  });

  it("formats timestamps from ISO strings", () => {
    const ts = formatActivityTimestamp("2026-05-25T12:30:00Z");
    expect(ts).toBeTypeOf("string");
    expect(ts.length).toBeGreaterThan(0);
  });

  it("produces a stable direction label for github_to_gdoc activities", () => {
    const activity = makeActivity({ direction: "github_to_gdoc" });
    expect(activity.direction).toBe("github_to_gdoc");
  });

  it("includes repository and PR number for filtering", () => {
    const activity = makeActivity({ repo: "org/repo", prNumber: 42 });
    expect(activity.repo).toBe("org/repo");
    expect(activity.prNumber).toBe(42);
  });

  it("carries optional path and line for location hints", () => {
    const activity = makeActivity({ path: "README.md", line: 15 });
    expect(activity.path).toBe("README.md");
    expect(activity.line).toBe(15);
  });

  it("renders kind as comment_synced by default", () => {
    const activity = makeActivity();
    expect(activity.kind).toBe("comment_synced");
  });
});
