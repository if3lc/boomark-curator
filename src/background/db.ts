import { openDB, type DBSchema } from "idb";
import type { BookmarkSnapshot, CurationPlan, LinkCheckResult, OperationLogEntry, RunState } from "../shared/types";

interface CuratorDb extends DBSchema {
  backups: {
    key: string;
    value: BookmarkSnapshot & { id: string };
  };
  plans: {
    key: string;
    value: CurationPlan & { id: string };
  };
  operations: {
    key: string;
    value: { id: string; entries: OperationLogEntry[]; createdAt: string };
  };
  state: {
    key: string;
    value: RunState;
  };
  runs: {
    key: string;
    value: RunState;
  };
  linkResults: {
    key: string;
    value: LinkCheckResult & { runId: string };
    indexes: { "by-run": string };
  };
}

const DB_NAME = "bookmark-curator";
const STATE_KEY = "current";

export const dbPromise = openDB<CuratorDb>(DB_NAME, 2, {
  upgrade(db) {
    if (!db.objectStoreNames.contains("backups")) db.createObjectStore("backups");
    if (!db.objectStoreNames.contains("plans")) db.createObjectStore("plans");
    if (!db.objectStoreNames.contains("operations")) db.createObjectStore("operations");
    if (!db.objectStoreNames.contains("state")) db.createObjectStore("state");
    if (!db.objectStoreNames.contains("runs")) db.createObjectStore("runs");
    if (!db.objectStoreNames.contains("linkResults")) {
      const store = db.createObjectStore("linkResults");
      store.createIndex("by-run", "runId");
    }
  }
});

export async function saveBackup(snapshot: BookmarkSnapshot): Promise<string> {
  const id = `backup-${Date.now()}`;
  const db = await dbPromise;
  await db.put("backups", { ...snapshot, id }, id);
  return id;
}

export async function getBackup(id: string): Promise<(BookmarkSnapshot & { id: string }) | undefined> {
  return (await dbPromise).get("backups", id);
}

export async function savePlan(plan: CurationPlan): Promise<string> {
  const id = `plan-${Date.now()}`;
  await (await dbPromise).put("plans", { ...plan, id }, id);
  return id;
}

export async function getPlan(id: string): Promise<(CurationPlan & { id: string }) | undefined> {
  return (await dbPromise).get("plans", id);
}

export async function saveOperations(entries: OperationLogEntry[]): Promise<string> {
  const id = `operations-${Date.now()}`;
  await (await dbPromise).put("operations", { id, entries, createdAt: new Date().toISOString() }, id);
  await chrome.storage.local.set({ "bookmark-curator-last-operations": id });
  return id;
}

export async function getLastOperations(): Promise<{ id: string; entries: OperationLogEntry[]; createdAt: string } | undefined> {
  const stored = await chrome.storage.local.get("bookmark-curator-last-operations");
  const id = stored["bookmark-curator-last-operations"] as string | undefined;
  return id ? (await dbPromise).get("operations", id) : undefined;
}

export async function saveState(state: RunState): Promise<RunState> {
  const db = await dbPromise;
  await db.put("state", state, STATE_KEY);
  await db.put("runs", state, state.id);
  return state;
}

export async function getState(): Promise<RunState | undefined> {
  return (await dbPromise).get("state", STATE_KEY);
}

export async function getRun(id: string): Promise<RunState | undefined> {
  return (await dbPromise).get("runs", id);
}

export async function listRuns(): Promise<RunState[]> {
  const runs = await (await dbPromise).getAll("runs");
  return runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function pruneRunsExcept(keepRunId: string): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction(["runs", "linkResults"], "readwrite");
  const runs = await tx.objectStore("runs").getAllKeys();
  for (const key of runs) {
    const runId = String(key);
    if (runId !== keepRunId) {
      await tx.objectStore("runs").delete(runId);
      let cursor = await tx.objectStore("linkResults").index("by-run").openCursor(runId);
      while (cursor) {
        await cursor.delete();
        cursor = await cursor.continue();
      }
    }
  }
  await tx.done;
}

export async function saveLinkResult(runId: string, result: LinkCheckResult): Promise<void> {
  await (await dbPromise).put("linkResults", { ...result, runId }, `${runId}:${result.bookmarkId}`);
}

export async function getLinkResults(runId: string): Promise<LinkCheckResult[]> {
  return (await dbPromise).getAllFromIndex("linkResults", "by-run", runId);
}
