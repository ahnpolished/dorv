import { describe, expect, it } from "vitest";
import { findLineMatch } from "../apps/extension/lib/gdoc/matching.js";

describe("findLineMatch", () => {
  const files = [
    { filename: "a.ts", content: "line 1\nline 2\nmatch me\nline 4" },
    { filename: "b.ts", content: "another\nmatch me\nhere" }
  ];

  it("finds exact string match", () => {
    const result = findLineMatch("match me", files);
    expect(result).toEqual([
      { path: "a.ts", line: 3 },
      { path: "b.ts", line: 2 }
    ]);
  });

  it("trims whitespace from quote", () => {
    const result = findLineMatch("  match me  ", files);
    expect(result).toEqual([
      { path: "a.ts", line: 3 },
      { path: "b.ts", line: 2 }
    ]);
  });

  it("returns empty for no match", () => {
    const result = findLineMatch("missing", files);
    expect(result).toHaveLength(0);
  });

  it("returns empty for empty quote", () => {
    expect(findLineMatch("", files)).toHaveLength(0);
    expect(findLineMatch("   ", files)).toHaveLength(0);
  });

  it("matches multi-line GDoc quotes with normalized whitespace", () => {
    const result = findLineMatch("first selected line\nsecond selected line", [
      {
        filename: "docs/rfc.md",
        content: "intro\nfirst selected line   second selected line\noutro"
      }
    ]);

    expect(result).toEqual([{ path: "docs/rfc.md", line: 2 }]);
  });

  it("matches a GDoc quote spanning multiple raw markdown lines", () => {
    const result = findLineMatch("first selected line second selected line", [
      {
        filename: "docs/rfc.md",
        content: "intro\nfirst selected line\nsecond selected line\noutro"
      }
    ]);

    expect(result).toEqual([{ path: "docs/rfc.md", line: 2 }]);
  });

  it("matches rendered GDoc text against raw markdown syntax", () => {
    const result = findLineMatch("Please review bold text before merging", [
      {
        filename: "README.md",
        content: "intro\nPlease review **bold text** before merging\noutro"
      }
    ]);

    expect(result).toEqual([{ path: "README.md", line: 2 }]);
  });
});
