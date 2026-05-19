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
        "dorv requires a Chromium-based browser with side panel support (Chrome 114+)."
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
