#!/usr/bin/env node
/* eslint-disable */
/**
 * dev-loop — single-command rebuild → reload → verify for dorv debugging.
 *
 * Every agent uses this ONE script so no one accidentally tests a stale
 * .output/ directory.  Prints git SHA + __DORV_CS_BUILD__ stamp together.
 *
 * Usage:  node scripts/dev-loop.mjs [pr-url]
 */

import { execSync, spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

// ── config ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, "..");
const BUILD_DIR = resolve(PROJECT_DIR, ".output", "chrome-mv3");
const PROFILE_DIR = resolve(process.env.HOME, ".dorv-dev-chrome-profile");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TARGET_URL = process.argv[2] ?? "https://github.com/ahnpolished/dorv/pull/6/files";
const CDP_URL = "http://localhost:9222";
const POLL_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 500;
const NAV_WAIT_MS = 6_000;

const RED = "\x1b[0;31m";
const GREEN = "\x1b[0;32m";
const YELLOW = "\x1b[1;33m";
const NC = "\x1b[0m";

// ── helpers ────────────────────────────────────────────────────────────
function log(color, ...args) {
  console.log(`${color}${args.join(" ")}${NC}`);
}

function run(cmd, opts = {}) {
  return execSync(cmd, {
    cwd: PROJECT_DIR,
    stdio: opts.silent ? "pipe" : "inherit",
    encoding: "utf-8",
    ...opts
  });
}

async function fetchJson(url) {
  const resp = await fetch(url);
  return resp.json();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function cdpSend(ws, id, method, params = {}) {
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("CDP timeout")), 10_000);
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === id) {
        clearTimeout(timeout);
        ws.off("message", handler);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
    ws.on("message", handler);
  });
}

// ── pre-flight checks ─────────────────────────────────────────────────
if (!existsSync(resolve(PROJECT_DIR, "node_modules"))) {
  log(YELLOW, "node_modules missing — running pnpm install first...");
  run("pnpm install", { cwd: resolve(PROJECT_DIR, ".."), silent: true });
}

// ── Step 1: Build from HEAD ───────────────────────────────────────────
log(YELLOW, "━━━ dorv dev-loop ━━━");
const gitSha = run("git rev-parse HEAD", { silent: true }).trim();
const gitShort = gitSha.slice(0, 7);
const buildTs = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

log(YELLOW, `[1/4] Building from commit ${gitShort}...`);
run("pnpm run build");

// ── Step 2: Launch Chrome ─────────────────────────────────────────────
log(YELLOW, "[2/4] Launching Chrome...");
run("pkill -9 -f 'Google Chrome' 2>/dev/null || true", { silent: true });
run(`lsof -tiTCP:9222 -sTCP:LISTEN | xargs kill 2>/dev/null || true`, { silent: true });
await sleep(3_000);

spawn(
  CHROME,
  [
    "--remote-debugging-port=9222",
    "--user-data-dir=" + PROFILE_DIR,
    "--profile-directory=Default",
    "--load-extension=" + BUILD_DIR,
    TARGET_URL
  ],
  { stdio: "ignore", detached: true }
).unref();

// Wait for CDP port
const startedAt = Date.now();
let ready = false;
while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
  try {
    const v = await fetchJson(CDP_URL + "/json/version");
    if (v.Browser) {
      ready = true;
      break;
    }
  } catch {
    // CDP port not ready yet — retry
  }
  await sleep(POLL_INTERVAL_MS);
}
if (!ready) {
  log(RED, "ERROR: Chrome did not start on port 9222");
  process.exit(1);
}

// Wait for the PR page to load
await sleep(NAV_WAIT_MS);

// ── Step 3: Find the PR page target ───────────────────────────────────
log(YELLOW, "[3/4] Finding page target...");
const targets = await fetchJson(CDP_URL + "/json");
const pageTarget = targets.find((t) => t.type === "page" && t.url.includes("github.com"));
if (!pageTarget) {
  log(RED, "ERROR: No GitHub page found. Targets:");
  for (const t of targets) {
    console.log(`  [${t.type}] ${t.url}`);
  }
  process.exit(1);
}

log(GREEN, `  Page: ${pageTarget.title?.slice(0, 60) ?? pageTarget.url}`);

// ── Step 4: Verify build stamp ────────────────────────────────────────
log(YELLOW, "[4/4] Verifying build stamp...");
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);

await new Promise((resolve, reject) => {
  ws.on("open", resolve);
  ws.on("error", reject);
  setTimeout(() => reject(new Error("WebSocket connect timeout")), 10_000);
});

await cdpSend(ws, 1, "Runtime.enable");

// Need to wait a moment for content script to inject
let stamp = null;
for (let attempt = 0; attempt < 15; attempt++) {
  const result = await cdpSend(ws, 100 + attempt, "Runtime.evaluate", {
    expression: "(function(){ return document.documentElement.dataset.dorvCsBuild || null; })()",
    returnByValue: true
  });
  if (result.result?.value) {
    stamp = result.result.value;
    break;
  }
  await sleep(500);
}

ws.close();

// ── Report ────────────────────────────────────────────────────────────
log(GREEN, "━━━ Dev Loop Ready ━━━");
console.log("");
console.log(`  Git SHA:         ${gitSha}`);
console.log(`  Short:           ${gitShort}`);
console.log(`  Build time:      ${buildTs}`);
console.log(`  Chrome:          ${CDP_URL}`);
console.log(`  PR page:         ${TARGET_URL}`);
console.log(`  Profile:         ${PROFILE_DIR}`);
console.log(`  CS build stamp:  ${stamp ? GREEN + stamp + NC : RED + "NOT INJECTED" + NC}`);
console.log("");

if (!stamp) {
  log(RED, "  ⚠️  Content script may not be loaded yet.");
  console.log("     1. Go to chrome://extensions");
  console.log('     2. Click "Reload" on the dorv card');
  console.log("     3. Hard-refresh the PR page (Cmd+Shift+R)");
  console.log("");
}

console.log("  Verify freshness via chrome-devtools MCP:");
console.log("    evaluate_script:");
console.log("      () => document.documentElement.dataset.dorvCsBuild");
console.log("");

if (stamp) {
  const reportFile = resolve(PROJECT_DIR, ".agents", "last-verify-report.md");
  const reportDir = dirname(reportFile);
  mkdirSync(reportDir, { recursive: true });
  const report = [
    `# Dev Loop Verification Report`,
    `- **Git SHA:** \`${gitSha}\``,
    `- **Build time:** ${buildTs}`,
    `- **CS stamp:** \`${stamp}\``,
    `- **Target:** ${TARGET_URL}`,
    `- **Verified at:** ${new Date().toISOString()}`,
    ""
  ].join("\n");
  writeFileSync(reportFile, report);
  log(GREEN, `  Report written to .agents/last-verify-report.md`);
}
