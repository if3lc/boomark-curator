import { createSnapshot } from "./backup";
import { createBookmark, downloadJson, getBookmarkTree } from "./chromeApi";
import { getBackup, getLastOperations, getLinkResults, getPlan, getRun, getState, listRuns, pruneRunsExcept, saveBackup, saveLinkResult, saveOperations, savePlan, saveState } from "./db";
import { applyCurationPlan, undoOperations } from "./applyPlan";
import { loadSettings } from "./settings";
import { checkLink } from "./linkChecker";
import { createCurationPlan } from "./aiClient";
import { findDuplicateGroups, getBookmarkLeaves } from "../shared/bookmarks";
import { IDLE_STATE, LINK_CHECK_ALARM, LINK_CHECK_BATCH_SIZE } from "../shared/defaults";
import type { BookmarkRecord, BookmarkSnapshot, CurationPlan, LinkCheckResult, RunMode, RunState, Settings } from "../shared/types";
import { getWritableRoot } from "./bookmarkRoots";

let activeAbort = false;
let pauseRequested = false;

export async function currentState(): Promise<RunState> {
  return (await getState()) ?? { ...IDLE_STATE, updatedAt: new Date().toISOString() };
}

export async function recoverableRuns(): Promise<RunState[]> {
  return (await listRuns())
    .filter((run) => ["running", "paused", "failed", "cancelled"].includes(run.status) && Boolean(run.backupId))
    .slice(0, 1);
}

export async function startScan(mode: RunMode = "organize"): Promise<RunState> {
  activeAbort = false;
  pauseRequested = false;
  const settings = await loadSettings();
  const runId = `run-${Date.now()}`;

  await setState({
    id: runId,
    mode,
    status: "running",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    message: mode === "link-cleanup" ? "Creating backup before broken-link cleanup" : "Creating backup before scan",
    progress: { current: 0, total: 0, phase: "backup" },
    log: [{ at: new Date().toISOString(), level: "info", message: "Started scan and backup creation." }]
  });
  await pruneRunsExcept(runId);

  const snapshot = await createSnapshot(settings);
  const backupId = await saveBackup(snapshot);

  await setState({
    ...(await currentState()),
    backupId,
    message: "Backup saved. Checking bookmark links",
    progress: { current: 0, total: getBookmarkLeaves(snapshot.records).length, phase: "links" }
  });
  await addLog(`Backup saved with ${snapshot.records.length} bookmark tree records.`);

  return continueRun(runId);
}

export async function resumeRun(runId?: string): Promise<RunState> {
  activeAbort = false;
  pauseRequested = false;
  await chrome.alarms.clear(LINK_CHECK_ALARM);
  const state = runId ? await getRun(runId) : await currentState();
  if (!state || !state.backupId) {
    throw new Error("No resumable run was found.");
  }
  await setState({ ...state, status: "running", message: `Resuming ${describePhase(state.progress.phase)}` });
  await addLog(`Resuming ${describePhase(state.progress.phase)}.`);
  return continueRun(state.id);
}

async function continueRun(runId: string): Promise<RunState> {
  try {
    const settings = await loadSettings();
    const state = await currentState();
    if (!state.backupId) throw new Error("Run cannot continue without a backup.");
    const snapshot = await getBackup(state.backupId);
    if (!snapshot) throw new Error("Run backup was not found.");
    const leaves = getBookmarkLeaves(snapshot.records);
    const duplicateGroups = findDuplicateGroups(snapshot.records);
    const linkResults = await ensureLinkResults(runId, leaves, settings, LINK_CHECK_BATCH_SIZE);

    if (linkResults.length < leaves.length) {
      await addLog(`Batch complete. ${leaves.length - linkResults.length} links remain; continuing shortly.`);
      await chrome.alarms.create(LINK_CHECK_ALARM, { delayInMinutes: 0.05 });
      return setState({
        ...(await currentState()),
        status: "running",
        continuation: "link-checks",
        message: `Checked ${linkResults.length} of ${leaves.length}. Next batch is scheduled.`,
        progress: { current: linkResults.length, total: leaves.length, phase: "links" }
      });
    }

    if (pauseRequested) {
      return setState({ ...(await currentState()), status: "paused", message: "Paused. Resume will continue from the next unchecked bookmark." });
    }
    if (activeAbort) {
      return setState({ ...(await currentState()), status: "cancelled", message: "Cancelled. Resume will continue from saved link-check progress." });
    }

    if (state.mode === "link-cleanup") {
      const plan = createBrokenLinksOnlyPlan(linkResults);
      const planId = await savePlan(plan);
      await addLog(`Broken-link cleanup plan created: ${plan.brokenBookmarkIds.length} bookmarks will move to review.`);
      return setState({
        ...(await currentState()),
        status: "needs-review",
        planId,
        message: `Review ${plan.brokenBookmarkIds.length} broken or unreachable links before moving them to review.`,
        progress: { current: leaves.length, total: leaves.length, phase: "review" }
      });
    }

    await setState({
      ...(await currentState()),
      message: "Requesting AI organization plan",
      progress: { current: leaves.length, total: leaves.length, phase: "ai" }
    });
    await addLog("Sending checked bookmarks to the selected AI model.");

    const plan = await createCurationPlan({ records: snapshot.records, linkResults, duplicateGroups, settings });
    const planId = await savePlan(plan);
    await addLog(`AI plan created: ${plan.moves.length} moves, ${plan.brokenBookmarkIds.length} broken links, ${plan.duplicateGroups.length} duplicate groups.`);

    return setState({
      ...(await currentState()),
      status: "needs-review",
      planId,
      message: `Review ${plan.moves.length} proposed moves, ${plan.brokenBookmarkIds.length} broken links, and ${plan.duplicateGroups.length} duplicate groups.`,
      progress: { current: leaves.length, total: leaves.length, phase: "review" }
    });
  } catch (error) {
    await addLog(error instanceof Error ? error.message : String(error), "error");
    return setState({
      ...(await currentState()),
      status: activeAbort ? "cancelled" : "failed",
      message: error instanceof Error ? error.message : String(error),
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function cancelScan(): Promise<RunState> {
  activeAbort = true;
  await chrome.alarms.clear(LINK_CHECK_ALARM);
  await addLog("Cancel requested. Current checkpoint will be kept.");
  return setState({ ...(await currentState()), status: "cancelled", message: "Cancel requested. Saved progress can be resumed later." });
}

export async function pauseScan(): Promise<RunState> {
  pauseRequested = true;
  await chrome.alarms.clear(LINK_CHECK_ALARM);
  await addLog("Pause requested. The current bookmark check will finish before stopping.");
  return setState({ ...(await currentState()), status: "paused", message: "Pause requested. Current bookmark check will finish first." });
}

export async function resumeScan(): Promise<RunState> {
  return resumeRun();
}

export async function applyCurrentPlan(): Promise<RunState> {
  const state = await currentState();
  if (!state.planId) throw new Error("No curation plan is ready to apply.");
  const plan = await getPlan(state.planId);
  if (!plan) throw new Error("Saved curation plan was not found.");

  const total = plan.brokenBookmarkIds.length + plan.duplicateGroups.reduce((sum, group) => sum + Math.max(0, group.bookmarkIds.length - 1), 0) + plan.moves.length;
  await setState({ ...state, status: "applying", message: "Applying approved bookmark changes", progress: { current: 0, total, phase: "apply" } });
  await addLog(`Applying approved curation plan with ${total} planned bookmark operations.`);

  try {
    let lastLoggedAt = 0;
    const operations = await applyCurationPlan(plan, async (message, completed, operationTotal) => {
      await setState({
        ...(await currentState()),
        status: "applying",
        message,
        progress: { current: completed, total: operationTotal, phase: "apply" }
      });
      if (completed === 0 || completed === operationTotal || completed - lastLoggedAt >= 10 || message.startsWith("Moving")) {
        lastLoggedAt = completed;
        await addLog(message);
      }
    });
    await saveOperations(operations);
    await addLog(`Apply finished with ${operations.length} bookmark moves.`);

    return setState({ ...(await currentState()), status: "completed", message: `Applied ${operations.length} bookmark moves.` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await addLog(`Apply failed: ${message}`, "error");
    return setState({ ...(await currentState()), status: "failed", message: `Apply failed: ${message}`, error: message });
  }
}

export async function undoLastRun(): Promise<RunState> {
  const operations = await getLastOperations();
  if (!operations) throw new Error("No previous operation log was found.");
  await addLog(`Undoing last run with ${operations.entries.length} operations.`);
  await undoOperations(operations.entries);
  await addLog("Undo completed.");
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
  const root = getWritableRoot(await getBookmarkTree());
  const folder = await createBookmark({ parentId: root.id, title: `Bookmark Curator Restore ${new Date().toISOString().slice(0, 10)}` });
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

async function addLog(message: string, level: "info" | "warning" | "error" = "info"): Promise<void> {
  const state = await currentState();
  const log = [...(state.log ?? []), { at: new Date().toISOString(), level, message }].slice(-120);
  await setState({ ...state, log, message: level === "error" ? message : state.message });
}

async function cloneNode(node: chrome.bookmarks.BookmarkTreeNode, parentId: string): Promise<void> {
  const created = await createBookmark(node.url ? { parentId, title: node.title, url: node.url } : { parentId, title: node.title });
  for (const child of node.children ?? []) {
    await cloneNode(child, created.id);
  }
}

function createBrokenLinksOnlyPlan(linkResults: LinkCheckResult[]): CurationPlan {
  const brokenStatuses = new Set<LinkCheckResult["status"]>(["missing", "timeout", "network-error", "unsupported-scheme"]);
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    taxonomyMode: "hybrid",
    folders: [],
    moves: [],
    brokenBookmarkIds: linkResults.filter((result) => brokenStatuses.has(result.status)).map((result) => result.bookmarkId),
    duplicateGroups: [],
    warnings: []
  };
}

async function ensureLinkResults(runId: string, leaves: BookmarkRecord[], settings: Settings, batchSize: number): Promise<LinkCheckResult[]> {
  const stored = await getLinkResults(runId);
  const byBookmarkId = new Map(stored.map((result) => [result.bookmarkId, result]));
  const pending = leaves.filter((record) => !byBookmarkId.has(record.id)).slice(0, batchSize);
  const totalPending = leaves.length - stored.length;

  await setState({
    ...(await currentState()),
    status: "running",
    message: totalPending ? `Checking links. ${stored.length} already done, ${totalPending} remaining.` : "All links already checked. Continuing to AI planning.",
    progress: { current: stored.length, total: leaves.length, phase: "links" }
  });
  await addLog(totalPending ? `Link check batch: ${stored.length} done, ${totalPending} remaining, processing up to ${pending.length}.` : "All link checks already completed.");

  const queue = [...pending];
  let completed = stored.length;

  async function worker(): Promise<void> {
    while (queue.length && !activeAbort && !pauseRequested) {
      const record = queue.shift();
      if (!record) return;
      const result = await checkLink(record, settings);
      byBookmarkId.set(record.id, result);
      await saveLinkResult(runId, result);
      completed += 1;
      await setState({
        ...(await currentState()),
        status: pauseRequested ? "paused" : "running",
        message: pauseRequested
          ? `Paused after checking ${completed} of ${leaves.length} links.`
          : `Checking links. ${completed} of ${leaves.length} complete. Last: ${record.title || record.url}`,
        progress: { current: completed, total: leaves.length, phase: "links" }
      });
      await addLog(`Link check: ${result.status} - ${record.title || record.url}`);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, settings.linkConcurrency) }, () => worker()));
  const results = [...byBookmarkId.values()];
  await addLog(`Link check finished: ${summarizeLinkResults(results)}.`);
  return results;
}

function summarizeLinkResults(results: LinkCheckResult[]): string {
  const counts = results.reduce<Record<string, number>>((acc, result) => {
    acc[result.status] = (acc[result.status] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .map(([status, count]) => `${count} ${status}`)
    .join(", ");
}

function describePhase(phase: RunState["progress"]["phase"]): string {
  switch (phase) {
    case "backup":
      return "backup creation";
    case "links":
      return "link checking";
    case "ai":
      return "AI planning";
    case "review":
      return "plan review";
    case "apply":
      return "applying bookmark changes";
    case "idle":
      return "scan";
  }
}
