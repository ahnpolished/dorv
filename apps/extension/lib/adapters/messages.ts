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
        reject(new Error(chrome.runtime.lastError.message ?? "Background message failed."));
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

export function createDocViaBackground(input: CreateDocInput): Promise<CreateDocResult> {
  return sendBackgroundMessage<CreateDocResult>(
    { type: "CREATE_DOC", payload: input },
    "Google Doc creation failed."
  ).then((payload) => {
    if (!payload) {
      throw new Error("Google Doc creation returned no result.");
    }

    return payload;
  });
}
