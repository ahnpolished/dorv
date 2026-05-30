import type { CreateDocInput, CreateDocResult } from "./types.js";

interface BackgroundResponse<T> {
  success: boolean;
  payload?: T;
  error?: string;
}

function sendBackgroundMessage<T>(
  message: Record<string, unknown>,
  fallbackError: string
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: BackgroundResponse<T> | undefined) => {
      if (chrome.runtime.lastError) {
        // The message channel may have closed (e.g. sender tab navigated away).
        // This is not an application error — resolve silently as undefined.
        resolve(undefined);
        return;
      }

      if (!response?.success) {
        reject(new Error(response?.error ?? fallbackError));
        return;
      }

      resolve(response.payload);
    });
  });
}

export async function openSidePanelViaBackground(): Promise<void> {
  await sendBackgroundMessage<undefined>({ type: "OPEN_SIDE_PANEL" }, "Side panel open failed.");
}

export async function closeSidePanelViaBackground(): Promise<void> {
  await sendBackgroundMessage<undefined>({ type: "CLOSE_SIDE_PANEL" }, "Side panel close failed.");
}

export async function syncNowViaBackground(): Promise<void> {
  await sendBackgroundMessage<undefined>({ type: "SYNC_NOW" }, "Manual sync failed.");
}

export async function createDocViaBackground(input: CreateDocInput): Promise<CreateDocResult> {
  const payload = await sendBackgroundMessage<CreateDocResult>(
    { type: "CREATE_DOC", payload: input },
    "Google Doc creation failed."
  );

  if (!payload) {
    throw new Error("Google Doc creation returned no result.");
  }

  return payload;
}
