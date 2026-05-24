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

// Arc exposes chrome.sidePanel but open() resolves silently without opening a panel.
// Detect Arc by the absence of the "Google Chrome" brand in userAgentData — all
// genuine Chrome builds include it; Arc (and other Chromium forks) do not.
export function isArcBrowser(): boolean {
  // userAgentData is not in older TS lib versions; cast to access it safely.
  const nav = navigator as unknown as {
    userAgentData?: { brands?: { brand: string }[] };
  };
  const brands = nav.userAgentData?.brands ?? [];
  return (
    brands.some((b) => b.brand === "Chromium") && !brands.some((b) => b.brand === "Google Chrome")
  );
}
