import { describe, expect, it } from "vitest";

import { bootstrapChecks, hasBootstrapCheck } from "../src/bootstrap.js";

describe("project bootstrap", () => {
  it("tracks the repo-level quality gates expected by HUM-1205", () => {
    expect(bootstrapChecks).toEqual(["workspace", "lint", "typecheck", "test", "pre-commit", "ci"]);
  });

  it("recognizes configured bootstrap checks", () => {
    expect(hasBootstrapCheck("ci")).toBe(true);
    expect(hasBootstrapCheck("deploy")).toBe(false);
  });
});
