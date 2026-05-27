/**
 * Playwright global setup — auto-refreshes the Google access token before real-credential tests.
 *
 * Requires env vars (set in .env.test.local or CI secrets):
 *   DORV_GOOGLE_REFRESH_TOKEN  — long-lived OAuth refresh token
 *   DORV_GOOGLE_CLIENT_ID      — OAuth client ID
 *   DORV_GOOGLE_CLIENT_SECRET  — OAuth client secret
 *
 * On success, writes the fresh token into DORV_GOOGLE_TOKEN so the real/ fixtures
 * pick it up without manual intervention.
 *
 * If any of the three vars are absent this is a no-op — tests fall back to whatever
 * DORV_GOOGLE_TOKEN is already set to (or skip if it's missing).
 */
import fs from "fs";
import os from "os";
import path from "path";

export const GOOGLE_TOKEN_FILE = path.join(os.tmpdir(), "dorv-e2e-google-token");

export default async function globalSetup() {
  const refreshToken = process.env.DORV_GOOGLE_REFRESH_TOKEN;
  const clientId = process.env.DORV_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.DORV_GOOGLE_CLIENT_SECRET;

  const missing = [
    !refreshToken && "DORV_GOOGLE_REFRESH_TOKEN",
    !clientId && "DORV_GOOGLE_CLIENT_ID",
    !clientSecret && "DORV_GOOGLE_CLIENT_SECRET"
  ].filter(Boolean);
  if (missing.length) {
    console.log(`[globalSetup] Skipping token refresh — missing env vars: ${missing.join(", ")}`);
    return;
  }

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    } as Record<string, string>)
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.warn(
      `[globalSetup] Google token refresh failed (${resp.status.toString()}): ${body} — real tests will skip`
    );
    return;
  }

  const { access_token } = (await resp.json()) as { access_token: string };
  // Write to a file — process.env changes in globalSetup don't propagate to Playwright workers
  fs.writeFileSync(GOOGLE_TOKEN_FILE, access_token, "utf8");
  console.log("[globalSetup] Google access token refreshed");
}
