import Bowser from "bowser";

export type BrowserKind = "chrome" | "edge" | "unknown";

export interface CompatResult {
  compatible: boolean;
  warning?: string;
}

export function detectBrowserKind(ua: string = navigator.userAgent): BrowserKind {
  if (/\bEdg\/\d/.test(ua)) return "edge";
  if (/\bChrome\/\d/.test(ua)) return "chrome";
  return "unknown";
}

export function checkSidePanelCompat(
  sidePanelApi: unknown,
  browserKind: BrowserKind
): CompatResult {
  const apiAvailable =
    sidePanelApi !== null &&
    sidePanelApi !== undefined &&
    typeof (sidePanelApi as Record<string, unknown>).setOptions === "function";

  if (!apiAvailable) {
    return {
      compatible: false,
      warning:
        "The Chrome Side Panel API is not available in this browser. " +
        "dorv will open its review surface in a tab instead, but Chrome 114+ offers the best experience."
    };
  }

  if (browserKind === "edge") {
    return {
      compatible: false,
      warning:
        "Microsoft Edge may not fully support Chrome extension side panels. " +
        "Some features may not work as expected. For the best experience, use Google Chrome."
    };
  }

  return { compatible: true };
}

export function isSidePanelSupported(): boolean {
  return typeof chrome !== "undefined" && "sidePanel" in chrome;
}

// Returns true only for genuine Chrome where chrome.sidePanel actually opens a panel.
// Arc, Brave, Opera, Vivaldi and other Chromium forks expose chrome.sidePanel but
// sidePanel.open() either resolves silently or fails — fall back to a tab for all of them.
export function isNativeSidePanelBrowser(): boolean {
  // Client Hints is the most reliable signal: real Chrome always includes the
  // "Google Chrome" brand; Chromium forks (Arc, Brave, …) omit it.
  const nav = navigator as unknown as {
    userAgentData?: { brands?: { brand: string }[] };
  };
  const brands = nav.userAgentData?.brands;
  if (brands) {
    return brands.some((b) => b.brand === "Google Chrome");
  }
  // Older browsers without Client Hints: fall back to UA string parsing.
  // Bowser reliably identifies Chrome vs Opera, Edge, Samsung, Vivaldi, etc.
  return Bowser.getParser(navigator.userAgent).isBrowser("Chrome");
}
