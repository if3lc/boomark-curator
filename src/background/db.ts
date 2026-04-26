import { openDB, type DBSchema } from "idb";
import type { BookmarkSnapshot, CurationPlan, OperationLogEntry, RunState } from "../shared/types";

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
}

const DB_NAME = "bookmark-curator";
const STATE_KEY = "current";

export const dbPromise = openDB<CuratorDb>(DB_NAME, 1, {
  upgrade(db) {
    db.createObjectStore("backups");
    db.createObjectStore("plans");
    db.createObjectStore("operations");
    db.createObjectStore("state");
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
  await (await dbPromise).put("state", state, STATE_KEY);
  return state;
}

export async function getState(): Promise<RunState | undefined> {
  return (await dbPromise).get("state", STATE_KEY);
}
