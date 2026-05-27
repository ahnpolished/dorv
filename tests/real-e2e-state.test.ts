import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearState,
  readState,
  readStateForPr,
  writeState,
  writeStateForPr
} from "./e2e/real/state.js";

describe("real e2e state helpers", () => {
  beforeEach(() => {
    clearState();
  });

  afterEach(() => {
    clearState();
  });

  it("stores PR-scoped mappings without clobbering another PR", () => {
    writeStateForPr("ahnpolished/dorv", 6, {
      docId: "doc-6",
      docStoreKey: "docStore:ahnpolished/dorv#6",
      docMapping: {
        repo: "ahnpolished/dorv",
        prNumber: 6,
        docId: "doc-6"
      }
    });

    writeStateForPr("ahnpolished/dorv", 7, {
      docId: "doc-7",
      docStoreKey: "docStore:ahnpolished/dorv#7",
      docMapping: {
        repo: "ahnpolished/dorv",
        prNumber: 7,
        docId: "doc-7"
      }
    });

    expect(readStateForPr("ahnpolished/dorv", 6).docId).toBe("doc-6");
    expect(readStateForPr("ahnpolished/dorv", 7).docId).toBe("doc-7");
  });

  it("falls back to legacy top-level state for the matching PR", () => {
    writeState({
      docId: "legacy-doc",
      docStoreKey: "docStore:ahnpolished/dorv#6",
      docMapping: {
        repo: "ahnpolished/dorv",
        prNumber: 6,
        docId: "legacy-doc"
      }
    });

    expect(readStateForPr("ahnpolished/dorv", 6).docId).toBe("legacy-doc");
    expect(readStateForPr("ahnpolished/dorv", 7).docId).toBeUndefined();
    expect(readState().docId).toBe("legacy-doc");
  });
});
