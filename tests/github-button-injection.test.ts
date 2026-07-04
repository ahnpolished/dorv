import { describe, expect, it } from "vitest";

import {
  BUTTON_ROOT_PREFIX,
  FILE_HEADER_SELECTORS,
  fileButtonRootId,
  findInjectionAnchors,
  getFileHeaderFilename,
  hasFileButton,
  isMarkdownFileHeader,
  resolveFileHeaderSelector
} from "../apps/extension/lib/github/button-injection.js";

// ─── minimal fakes (repo convention: no jsdom, hand-rolled DOM-like fakes) ──

function makeFakeDoc(selectorResults: Element[] = []) {
  const result = {
    length: selectorResults.length,
    [Symbol.iterator]: () => selectorResults[Symbol.iterator]()
  };
  return {
    querySelectorAll: () => result as NodeListOf<Element>
  };
}

function makeFakeHeader(filename: string, existingChildId?: string): Element {
  const children: Element[] = [];
  const fakeLink = {
    textContent: filename
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as Element;

  return {
    querySelector: (sel: string) => {
      if (sel === "a") return fakeLink;
      if (existingChildId && sel === `#${existingChildId}`) return {};
      return null;
    },
    appendChild: (child: Element) => {
      children.push(child);
      return child;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as Element;
}

// ─── tests ─────────────────────────────────────────────────────────────

describe("FILE_HEADER_SELECTORS", () => {
  it("is an ordered array of fallback selectors", () => {
    expect(Array.isArray(FILE_HEADER_SELECTORS)).toBe(true);
    expect(FILE_HEADER_SELECTORS.length).toBeGreaterThanOrEqual(2);
    expect(FILE_HEADER_SELECTORS[0]).toBe('[class*="file-header"]');
  });
});

describe("resolveFileHeaderSelector", () => {
  it("returns first selector that finds a markdown file header", () => {
    const headers = [
      makeFakeHeader("app.tsx"),
      makeFakeHeader("README.md"),
      makeFakeHeader("test.ts")
    ];
    const doc = makeFakeDoc(headers);
    // First selector matches and finds a .md → resolved
    expect(resolveFileHeaderSelector(doc)).toBe('[class*="file-header"]');
  });

  it("returns null when no selector finds any markdown files", () => {
    const doc = makeFakeDoc([makeFakeHeader("app.tsx"), makeFakeHeader("test.ts")]);
    expect(resolveFileHeaderSelector(doc)).toBeNull();
  });

  it("returns null when no elements match any selector", () => {
    const doc = makeFakeDoc([]);
    expect(resolveFileHeaderSelector(doc)).toBeNull();
  });

  it("caches result for the same document", () => {
    const headers = [makeFakeHeader("README.md")];
    const doc = makeFakeDoc(headers);
    const first = resolveFileHeaderSelector(doc);
    const second = resolveFileHeaderSelector(doc);
    expect(first).toBe('[class*="file-header"]');
    expect(second).toBe(first); // cached
  });
});

describe("getFileHeaderFilename", () => {
  it("returns the link text from a header", () => {
    const header = makeFakeHeader("README.md");
    expect(getFileHeaderFilename(header)).toBe("README.md");
  });

  it("strips zero-width space prefixes GitHub prepends", () => {
    const header = makeFakeHeader("\u200eCHANGELOG.md");
    expect(getFileHeaderFilename(header)).toBe("CHANGELOG.md");
  });

  it("strips zero-width space suffixes GitHub appends", () => {
    const header = makeFakeHeader("README.md\u200e");
    expect(getFileHeaderFilename(header)).toBe("README.md");
  });

  it("strips zero-width space from both ends", () => {
    const header = makeFakeHeader("\u200edocs/plan.md\u200e");
    expect(getFileHeaderFilename(header)).toBe("docs/plan.md");
  });

  it("returns null when no link exists", () => {
    const header = {
      querySelector: () => null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any as Element;
    expect(getFileHeaderFilename(header)).toBeNull();
  });
});

describe("isMarkdownFileHeader", () => {
  it("returns true for .md files", () => {
    expect(isMarkdownFileHeader(makeFakeHeader("README.md"))).toBe(true);
  });

  it("returns false for non-.md files", () => {
    expect(isMarkdownFileHeader(makeFakeHeader("options.html"))).toBe(false);
    expect(isMarkdownFileHeader(makeFakeHeader("auth.ts"))).toBe(false);
  });
});

describe("findInjectionAnchors", () => {
  it("returns only markdown file headers using resolved selector", () => {
    const headers = [
      makeFakeHeader("README.md"),
      makeFakeHeader("options.html"),
      makeFakeHeader("CHANGELOG.md")
    ];
    const doc = makeFakeDoc(headers);
    // resolveFileHeaderSelector is cached per doc; reset for clean test
    resolveFileHeaderSelector(makeFakeDoc([])); // different doc → no-op on cache
    const result = findInjectionAnchors(doc);
    expect(result).toHaveLength(2);
  });

  it("returns empty array when selector resolves but no markdown files", () => {
    const doc = makeFakeDoc([makeFakeHeader("app.tsx"), makeFakeHeader("test.ts")]);
    expect(findInjectionAnchors(doc)).toHaveLength(0);
  });

  it("returns empty array when no selector matches", () => {
    const doc = makeFakeDoc([]);
    expect(findInjectionAnchors(doc)).toHaveLength(0);
  });
});

describe("fileButtonRootId", () => {
  it("prefixes with BUTTON_ROOT_PREFIX", () => {
    expect(fileButtonRootId("README.md")).toBe("dorv-file-btn-README_md");
  });

  it("sanitises special characters in filenames", () => {
    expect(fileButtonRootId("docs/contributing.md")).toBe("dorv-file-btn-docs_contributing_md");
  });

  it("starts with BUTTON_ROOT_PREFIX constant", () => {
    const id = fileButtonRootId("x.md");
    expect(id.startsWith(BUTTON_ROOT_PREFIX)).toBe(true);
  });
});

describe("hasFileButton", () => {
  it("returns false when the header has no button", () => {
    const header = makeFakeHeader("README.md");
    expect(hasFileButton(header)).toBe(false);
  });

  it("returns true when a button with the expected id exists", () => {
    const id = fileButtonRootId("README.md");
    const header = makeFakeHeader("README.md", id);
    expect(hasFileButton(header)).toBe(true);
  });

  it("returns false when filename is empty", () => {
    const header = makeFakeHeader("");
    expect(hasFileButton(header)).toBe(false);
  });
});
