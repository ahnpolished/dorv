/**
 * Standalone sidepanel debugger — attaches to a running Chrome via CDP.
 *
 * Usage:
 *   # Start Chrome with remote debugging (do this once):
 *   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
 *     --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug
 *
 *   # Run the debugger:
 *   npx tsx tests/e2e/debug-sidepanel.ts [cdp-url]
 *
 *   # Default CDP URL: http://127.0.0.1:9222
 *   # Override:        npx tsx tests/e2e/debug-sidepanel.ts http://127.0.0.1:50881
 *
 * What it does:
 *   1. Connects to the running Chrome via CDP
 *   2. Lists all open pages (including extension pages)
 *   3. Finds the dorv sidepanel page
 *   4. Takes a screenshot → /tmp/sidepanel-debug.png
 *   5. Dumps the rendered text, GDoc comments state, and storage snapshot
 */

import { chromium } from "@playwright/test";

const CDP_URL = process.argv[2] ?? "http://127.0.0.1:9222";
const SCREENSHOT_PATH = "/tmp/sidepanel-debug.png";

async function main() {
  console.log(`Connecting to Chrome at ${CDP_URL} …`);
  const browser = await chromium.connectOverCDP(CDP_URL);

  // List all pages across all contexts
  const allPages = browser.contexts().flatMap((ctx) => ctx.pages());
  console.log(`\nOpen pages (${allPages.length.toString()}):`);
  for (const p of allPages) {
    console.log(`  ${p.url()}`);
  }

  // Find the dorv sidepanel
  const sidepanel = allPages.find((p) => p.url().includes("sidepanel.html"));
  if (!sidepanel) {
    console.error("\nSidepanel not found. Open the dorv sidepanel in Chrome, then re-run.");
    await browser.close();
    process.exit(1);
  }

  console.log(`\nFound sidepanel: ${sidepanel.url()}`);

  // Screenshot
  await sidepanel.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
  console.log(`Screenshot saved to ${SCREENSHOT_PATH}`);

  // Rendered text
  const text = await sidepanel.evaluate(() => document.body.innerText);
  console.log("\n── Rendered text ──────────────────────────────────────");
  console.log(text.slice(0, 800));

  // GDoc comments state from React state via DOM
  const gdocState = await sidepanel.evaluate(() => {
    const heading = document.querySelector("h3");
    const cards = Array.from(document.querySelectorAll(".comment-card.gdoc")).map((card) => ({
      author: card.querySelector(".author")?.textContent ?? "",
      body: card.querySelector(".comment-body")?.textContent.slice(0, 120) ?? "",
      hasQuote: !!card.querySelector(".quote"),
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      pushDisabled: (card.querySelector(".push-btn") as HTMLButtonElement | null)?.disabled ?? true
    }));
    return { heading: heading?.textContent ?? null, comments: cards };
  });

  console.log("\n── GDoc tab state ─────────────────────────────────────");
  console.log(JSON.stringify(gdocState, null, 2));

  // Storage snapshot from the extension service worker in the same context
  const ctx = sidepanel.context();
  const sw = ctx.serviceWorkers()[0];
  if (sw) {
    const storage = await sw.evaluate(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          chrome.storage.local.get(null, resolve);
        })
    );

    const keys = Object.keys(storage);
    const mappingKeys = keys.filter((k) => k.startsWith("mappingStore:pr:"));
    const docKeys = keys.filter((k) => k.startsWith("docStore:"));

    console.log("\n── Extension storage ──────────────────────────────────");
    console.log(`  Total keys: ${keys.length.toString()}`);
    console.log(`  Doc mappings: ${docKeys.join(", ") || "(none)"}`);
    console.log(`  Comment mappings: ${mappingKeys.join(", ") || "(none)"}`);

    if (mappingKeys.length > 0) {
      for (const k of mappingKeys) {
        const mappings = storage[k] as unknown[];
        console.log(`  ${k}: ${mappings.length.toString()} entries`);
      }
    }

    // Cache snapshot — show gdoc comment count
    const snapshot = storage.sidepanel_query_cache_snapshot as
      | { entries: { data: unknown }[] }
      | undefined;
    if (snapshot?.entries) {
      console.log(
        `  Cache entries: ${snapshot.entries.length.toString()} (gdoc comments: ${
          (snapshot.entries[1]?.data as unknown[] | undefined)?.length.toString() ?? "?"
        })`
      );
    }
  } else {
    console.log("\n(No service worker found in this context — storage unavailable)");
  }

  // Live Drive API call to confirm what the API returns
  if (sw) {
    const driveResult = await sw.evaluate(async () => {
      const token = await new Promise<string | undefined>((resolve) => {
        chrome.identity.getAuthToken({ interactive: false }, (t) => {
          resolve(t as string);
        });
      });
      if (!token) return { error: "no google token" };

      const data = await chrome.storage.local.get(null);
      const docKey = Object.keys(data).find((k) => k.startsWith("docStore:"));
      if (!docKey) return { error: "no docStore entry" };

      const mapping = data[docKey] as { docId: string } | undefined;
      if (!mapping?.docId) return { error: "no docId" };

      const url = `https://www.googleapis.com/drive/v3/files/${mapping.docId}/comments?pageSize=100&fields=nextPageToken,comments(id,content,resolved)`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const body = (await resp.json()) as {
        comments?: { id: string; content: string; resolved: boolean }[];
        error?: unknown;
      };
      return {
        status: resp.status,
        commentCount: body.comments?.length ?? 0,
        comments:
          body.comments?.map((c) => ({
            id: c.id,
            content: c.content.slice(0, 80),
            resolved: c.resolved
          })) ?? [],
        error: body.error ?? null
      };
    });

    console.log("\n── Live Drive API ──────────────────────────────────────");
    console.log(JSON.stringify(driveResult, null, 2));
  }

  await browser.close();
  console.log("\nDone. Open the screenshot:");
  console.log(`  open ${SCREENSHOT_PATH}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
