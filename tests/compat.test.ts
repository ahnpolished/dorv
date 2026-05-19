import { describe, expect, it, vi, afterEach } from "vitest";
import {
  detectBrowserKind,
  checkSidePanelCompat,
  isSidePanelSupported
} from "../apps/extension/lib/compat.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isSidePanelSupported", () => {
  it("returns true when chrome.sidePanel exists", () => {
    vi.stubGlobal("chrome", { sidePanel: {} });
    expect(isSidePanelSupported()).toBe(true);
  });

  it("returns false when chrome.sidePanel is absent", () => {
    vi.stubGlobal("chrome", {});
    expect(isSidePanelSupported()).toBe(false);
  });

  it("returns false when chrome is undefined", () => {
    vi.stubGlobal("chrome", undefined);
    expect(isSidePanelSupported()).toBe(false);
  });
});

describe("detectBrowserKind", () => {
  it("returns chrome for a standard Chrome UA", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
    expect(detectBrowserKind(ua)).toBe("chrome");
  });

  it("returns edge for a Chromium-based Edge UA", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";
    expect(detectBrowserKind(ua)).toBe("edge");
  });

  it("returns unknown for a non-Chromium UA", () => {
    const ua = "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/115.0";
    expect(detectBrowserKind(ua)).toBe("unknown");
  });

  it("returns unknown when UA is empty string", () => {
    expect(detectBrowserKind("")).toBe("unknown");
  });
});

describe("checkSidePanelCompat", () => {
  it("returns compatible:true when API is present and browser is Chrome", () => {
    const fakeApi = { setOptions: vi.fn() };
    const result = checkSidePanelCompat(fakeApi, "chrome");
    expect(result.compatible).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it("returns compatible:false when API object is absent", () => {
    const result = checkSidePanelCompat(undefined, "chrome");
    expect(result.compatible).toBe(false);
    expect(result.warning).toBeTruthy();
  });

  it("returns compatible:false when API lacks setOptions", () => {
    const result = checkSidePanelCompat({}, "chrome");
    expect(result.compatible).toBe(false);
    expect(result.warning).toBeTruthy();
  });

  it("returns compatible:false with a warning for Edge", () => {
    const fakeApi = { setOptions: vi.fn() };
    const result = checkSidePanelCompat(fakeApi, "edge");
    expect(result.compatible).toBe(false);
    expect(result.warning).toMatch(/edge/i);
  });

  it("returns compatible:true for unknown browser when API exists", () => {
    const fakeApi = { setOptions: vi.fn() };
    const result = checkSidePanelCompat(fakeApi, "unknown");
    expect(result.compatible).toBe(true);
  });
});
