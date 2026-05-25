/**
 * Cross-file shared state for real-credential E2E tests.
 *
 * doc-lifecycle.spec.ts writes the created doc mapping here.
 * sync.spec.ts and push.spec.ts read it to seed extension storage.
 *
 * State is stored in a temp file so it survives worker restarts between spec files.
 */
import fs from "fs";
import os from "os";
import path from "path";

const STATE_FILE = path.join(os.tmpdir(), "dorv-real-e2e-state.json");

export interface RealE2EState {
  docId?: string;
  docUrl?: string;
  docStoreKey?: string;
  docMapping?: Record<string, unknown>;
  ghCommentIds?: number[];
}

export function readState(): RealE2EState {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as RealE2EState;
  } catch {
    return {};
  }
}

export function writeState(update: Partial<RealE2EState>): void {
  const current = readState();
  fs.writeFileSync(STATE_FILE, JSON.stringify({ ...current, ...update }, null, 2));
}

export function clearState(): void {
  try {
    fs.unlinkSync(STATE_FILE);
  } catch {
    // file may not exist
  }
}
