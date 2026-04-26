import { createSnapshot } from "./backup";
import { createBookmark, downloadJson } from "./chromeApi";
import { getBackup, getLastOperations, getPlan, getState, saveBackup, saveOperations, savePlan, saveState } from "./db";
import { applyCurationPlan, undoOperations } from "./applyPlan";
import { loadSettings } from "./settings";
import { checkLinks } from "./linkChecker";
import { createCurationPlan } from "./aiClient";
import { findDuplicateGroups, getBookmarkLeaves } from "../shared/bookmarks";
import { IDLE_STATE } from "../shared/defaults";
import type { BookmarkSnapshot, RunState } from "../shared/types";

let activeAbort = false;

export async function currentState(): Promise<RunState> {
  return (await getState()) ?? { ...IDLE_STATE, updatedAt: new Date().toISOString() };
}

export async function startScan(): Promise<RunState> {
  activeAbort = false;
  const settings = await loadSettings();
  const runId = `run-${Date.now()}`;

  await setState({
    id: runId,
    status: "running",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    message: "Creating backup before scan",
    progress: { current: 0, total: 0, phase: "backup" }
  });

  const snapshot = await createSnapshot(settings);
  const backupId = await saveBackup(snapshot);
  const leaves = getBookmarkLeaves(snapshot.records);
  const duplicateGroups = findDuplicateGroups(snapshot.records);

  await setState({
    ...(await currentState()),
    backupId,
    message: "Checking bookmark links",
    progress: { current: 0, total: leaves.length, phase: "links" }
  });

  const linkResults = await checkLinks(leaves, settings, async (done) => {
    if (activeAbort) throw new Error("Scan cancelled");
    await setState({
      ...(await currentState()),
      updatedAt: new Date().toISOString(),
      message: `Checked ${done} of ${leaves.length} links`,
      progress: { current: done, total: leaves.length, phase: "links" }
    });
  });

  await setState({
    ...(await currentState()),
    message: "Requesting AI organization plan",
    progress: { current: leaves.length, total: leaves.length, phase: "ai" }
  });

  const plan = await createCurationPlan({ records: snapshot.records, linkResults, duplicateGroups, settings });
  const planId = await savePlan(plan);

  return setState({
    ...(await currentState()),
    status: "needs-review",
    planId,
    message: `Review ${plan.moves.length} proposed moves, ${plan.brokenBookmarkIds.length} broken links, and ${plan.duplicateGroups.length} duplicate groups.`,
    progress: { current: leaves.length, total: leaves.length, phase: "review" }
  });
}

export async function cancelScan(): Promise<RunState> {
  activeAbort = true;
  return setState({ ...(await currentState()), status: "cancelled", message: "Scan cancelled by user" });
}

export async function pauseScan(): Promise<RunState> {
  return setState({ ...(await currentState()), status: "paused", message: "Pause requested. Current batch will finish first." });
}

export async function resumeScan(): Promise<RunState> {
  return setState({ ...(await currentState()), status: "running", message: "Resume requested. Start a new scan if this run has already stopped." });
}

export async function applyCurrentPlan(): Promise<RunState> {
  const state = await currentState();
  if (!state.planId) throw new Error("No curation plan is ready to apply.");
  const plan = await getPlan(state.planId);
  if (!plan) throw new Error("Saved curation plan was not found.");

  await setState({ ...state, status: "applying", message: "Applying approved bookmark changes", progress: { ...state.progress, phase: "apply" } });
  const operations = await applyCurationPlan(plan);
  await saveOperations(operations);

  return setState({ ...(await currentState()), status: "completed", message: `Applied ${operations.length} bookmark operations.` });
}

export async function undoLastRun(): Promise<RunState> {
  const operations = await getLastOperations();
  if (!operations) throw new Error("No previous operation log was found.");
  await undoOperations(operations.entries);
  return setState({ ...(await currentState()), status: "completed", message: "Last applied run was undone." });
}

export async function downloadLatestBackup(): Promise<number> {
  const state = await currentState();
  if (!state.backupId) throw new Error("No backup exists for the current run.");
  const snapshot = await getBackup(state.backupId);
  if (!snapshot) throw new Error("Saved backup was not found.");
  return downloadJson(`bookmark-curator-backup-${snapshot.createdAt.slice(0, 10)}.json`, snapshot);
}

export async function restoreBackup(_backup: BookmarkSnapshot): Promise<RunState> {
  const folder = await createBookmark({ parentId: "1", title: `Bookmark Curator Restore ${new Date().toISOString().slice(0, 10)}` });
  for (const child of _backup.tree[0]?.children ?? []) {
    await cloneNode(child, folder.id);
  }
  return setState({ ...(await currentState()), status: "completed", message: `Backup restored into folder "${folder.title}".` });
}

async function setState(state: RunState): Promise<RunState> {
  const next = { ...state, updatedAt: new Date().toISOString() };
  await saveState(next);
  return next;
}

async function cloneNode(node: chrome.bookmarks.BookmarkTreeNode, parentId: string): Promise<void> {
  const created = await createBookmark(node.url ? { parentId, title: node.title, url: node.url } : { parentId, title: node.title });
  for (const child of node.children ?? []) {
    await cloneNode(child, created.id);
  }
}
