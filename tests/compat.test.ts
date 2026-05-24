import { describe, expect, it, vi, afterEach } from "vitest";
import {
  detectBrowserKind,
  checkSidePanelCompat,
  isSidePanelSupported,
  isNativeSidePanelBrowser
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

// Real UA strings for Bowser fallback tests (no userAgentData).
const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const OPERA_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 OPR/110.0.0.0";
const EDGE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";
const VIVALDI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Vivaldi/6.7.3329.35";

describe("isNativeSidePanelBrowser", () => {
  describe("via userAgentData (Client Hints — primary path)", () => {
    it("returns true for genuine Chrome (has Google Chrome brand)", () => {
      vi.stubGlobal("navigator", {
        userAgentData: {
          brands: [{ brand: "Not/A)Brand" }, { brand: "Chromium" }, { brand: "Google Chrome" }]
        },
        userAgent: CHROME_UA
      });
      expect(isNativeSidePanelBrowser()).toBe(true);
    });

    it("returns false for Arc (Chromium fork — no Google Chrome brand)", () => {
      vi.stubGlobal("navigator", {
        userAgentData: { brands: [{ brand: "Not/A)Brand" }, { brand: "Chromium" }] },
        userAgent: CHROME_UA
      });
      expect(isNativeSidePanelBrowser()).toBe(false);
    });

    it("returns false for Brave (has Brave brand, not Google Chrome)", () => {
      vi.stubGlobal("navigator", {
        userAgentData: {
          brands: [{ brand: "Not/A)Brand" }, { brand: "Chromium" }, { brand: "Brave" }]
        },
        userAgent: CHROME_UA
      });
      expect(isNativeSidePanelBrowser()).toBe(false);
    });

    it("returns false for Opera (has Opera brand, not Google Chrome)", () => {
      vi.stubGlobal("navigator", {
        userAgentData: {
          brands: [{ brand: "Not/A)Brand" }, { brand: "Chromium" }, { brand: "Opera" }]
        },
        userAgent: OPERA_UA
      });
      expect(isNativeSidePanelBrowser()).toBe(false);
    });
  });

  describe("via Bowser UA fallback (no userAgentData)", () => {
    it("returns true for Chrome UA", () => {
      vi.stubGlobal("navigator", { userAgent: CHROME_UA });
      expect(isNativeSidePanelBrowser()).toBe(true);
    });

    it("returns false for Opera UA (has OPR/)", () => {
      vi.stubGlobal("navigator", { userAgent: OPERA_UA });
      expect(isNativeSidePanelBrowser()).toBe(false);
    });

    it("returns false for Edge UA (has Edg/)", () => {
      vi.stubGlobal("navigator", { userAgent: EDGE_UA });
      expect(isNativeSidePanelBrowser()).toBe(false);
    });

    it("returns false for Vivaldi UA (has Vivaldi/)", () => {
      vi.stubGlobal("navigator", { userAgent: VIVALDI_UA });
      expect(isNativeSidePanelBrowser()).toBe(false);
    });
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
