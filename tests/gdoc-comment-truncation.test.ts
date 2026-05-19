import { describe, expect, it } from "vitest";
import { truncateToDriveLimit } from "../apps/extension/lib/gdoc/comments.js";

const DRIVE_MAX_BYTES = 4096;

describe("truncateToDriveLimit", () => {
  it("returns short content unchanged", () => {
    const content = "hello world";
    expect(truncateToDriveLimit(content)).toBe(content);
  });

  it("returns content at exactly 4096 bytes unchanged", () => {
    const content = "a".repeat(DRIVE_MAX_BYTES);
    expect(truncateToDriveLimit(content)).toBe(content);
  });

  it("truncates content exceeding 4096 bytes and appends ellipsis", () => {
    const content = "a".repeat(DRIVE_MAX_BYTES + 100);
    const result = truncateToDriveLimit(content);
    const byteLen = new TextEncoder().encode(result).length;
    expect(byteLen).toBeLessThanOrEqual(DRIVE_MAX_BYTES);
    expect(result.endsWith("…")).toBe(true);
  });

  it("truncated result has at most 4096 UTF-8 bytes for multibyte content", () => {
    // each '€' = 3 bytes in UTF-8
    const content = "€".repeat(2000); // 6000 bytes
    const result = truncateToDriveLimit(content);
    const byteLen = new TextEncoder().encode(result).length;
    expect(byteLen).toBeLessThanOrEqual(DRIVE_MAX_BYTES);
    expect(result.endsWith("…")).toBe(true);
  });

  it("does not split a multibyte character at the boundary", () => {
    // 4094 ASCII bytes + 2 × '€' (3 bytes each) = 4100 bytes total
    const content = "a".repeat(4094) + "€€";
    const result = truncateToDriveLimit(content);
    const byteLen = new TextEncoder().encode(result).length;
    expect(byteLen).toBeLessThanOrEqual(DRIVE_MAX_BYTES);
    expect(result).not.toContain("�"); // no replacement chars
  });
});
