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
  storageSnapshot?: Record<string, unknown>;
  prStates?: Record<string, RealE2EState>;
}

function prStateId(repo: string, prNumber: number): string {
  return `${repo}#${prNumber.toString()}`;
}

function isStateForPr(state: RealE2EState, repo: string, prNumber: number): boolean {
  const mapping = state.docMapping;
  return (
    typeof mapping?.repo === "string" &&
    mapping.repo === repo &&
    typeof mapping.prNumber === "number" &&
    mapping.prNumber === prNumber
  );
}

export function readState(): RealE2EState {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as RealE2EState;
  } catch {
    return {};
  }
}

export function readStateForPr(repo: string, prNumber: number): RealE2EState {
  const current = readState();
  const scoped = current.prStates?.[prStateId(repo, prNumber)];
  if (scoped) {
    return scoped;
  }

  if (isStateForPr(current, repo, prNumber)) {
    return current;
  }

  return {};
}

export function writeState(update: Partial<RealE2EState>): void {
  const current = readState();
  fs.writeFileSync(STATE_FILE, JSON.stringify({ ...current, ...update }, null, 2));
}

export function writeStateForPr(
  repo: string,
  prNumber: number,
  update: Partial<RealE2EState>
): void {
  const current = readState();
  const key = prStateId(repo, prNumber);
  const nextScoped = { ...(current.prStates?.[key] ?? {}), ...update };
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify(
      {
        ...current,
        prStates: {
          ...(current.prStates ?? {}),
          [key]: nextScoped
        }
      },
      null,
      2
    )
  );
}

export function clearState(): void {
  try {
    fs.unlinkSync(STATE_FILE);
  } catch {
    // file may not exist
  }
}
