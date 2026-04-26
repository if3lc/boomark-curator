import { BROKEN_FOLDER, CURATOR_ROOT_FOLDER, DUPLICATE_FOLDER } from "../shared/defaults";
import type { CurationPlan, OperationLogEntry } from "../shared/types";
import { createBookmark, getBookmark, getBookmarkTree, moveBookmark, removeTree } from "./chromeApi";
import { getWritableRoot } from "./bookmarkRoots";

export async function applyCurationPlan(plan: CurationPlan, onMove?: (message: string, completed: number, total: number) => Promise<void> | void): Promise<OperationLogEntry[]> {
  const operations: OperationLogEntry[] = [];
  await ensureFolderPath([CURATOR_ROOT_FOLDER]);
  const broken = await ensureFolderPath([CURATOR_ROOT_FOLDER, BROKEN_FOLDER]);
  const duplicates = await ensureFolderPath([CURATOR_ROOT_FOLDER, DUPLICATE_FOLDER]);
  const total = plan.brokenBookmarkIds.length + plan.duplicateGroups.reduce((sum, group) => sum + Math.max(0, group.bookmarkIds.length - 1), 0) + plan.moves.length;
  let completed = 0;

  for (const bookmarkId of plan.brokenBookmarkIds) {
    await onMove?.(`Moving broken bookmark ${bookmarkId} to ${CURATOR_ROOT_FOLDER} / ${BROKEN_FOLDER}`, completed, total);
    const moved = await moveWithLog(bookmarkId, broken.id, operations);
    completed += 1;
    await onMove?.(`${moved ? "Moved" : "Skipped"} broken bookmark ${bookmarkId} to ${CURATOR_ROOT_FOLDER} / ${BROKEN_FOLDER}`, completed, total);
  }

  for (const group of plan.duplicateGroups) {
    for (const bookmarkId of group.bookmarkIds.slice(1)) {
      await onMove?.(`Moving duplicate bookmark ${bookmarkId} to ${CURATOR_ROOT_FOLDER} / ${DUPLICATE_FOLDER}`, completed, total);
      const moved = await moveWithLog(bookmarkId, duplicates.id, operations);
      completed += 1;
      await onMove?.(`${moved ? "Moved" : "Skipped"} duplicate bookmark ${bookmarkId} to ${CURATOR_ROOT_FOLDER} / ${DUPLICATE_FOLDER}`, completed, total);
    }
  }

  for (const move of plan.moves) {
    const target = await ensureFolderPath(move.targetPath);
    await onMove?.(`Moving bookmark ${move.bookmarkId} to ${move.targetPath.join(" / ")}`, completed, total);
    const moved = await moveWithLog(move.bookmarkId, target.id, operations);
    completed += 1;
    await onMove?.(`${moved ? "Moved" : "Skipped"} bookmark ${move.bookmarkId} to ${move.targetPath.join(" / ")} (${Math.round(move.confidence * 100)}%)`, completed, total);
  }

  const removedFolders = await removeEmptyFolders(operations);
  if (removedFolders > 0) {
    await onMove?.(`Removed ${removedFolders} empty folders left after moving bookmarks`, completed, total);
  }

  return operations;
}

export async function undoOperations(entries: OperationLogEntry[]): Promise<void> {
  for (const entry of [...entries].reverse()) {
    if (entry.type === "move" && entry.fromParentId) {
      await moveBookmark(entry.bookmarkId, { parentId: entry.fromParentId, index: entry.fromIndex });
    }
    if (entry.type === "create-folder") {
      try {
        await removeTree(entry.bookmarkId);
      } catch {
        // Folder may contain user-created content or may already be gone.
      }
    }
    if (entry.type === "remove-empty-folder" && entry.title && entry.fromParentId) {
      try {
        await createBookmark({ parentId: entry.fromParentId, index: entry.fromIndex, title: entry.title });
      } catch {
        // Parent may no longer exist; the original backup remains the full restore path.
      }
    }
  }
}

async function moveWithLog(bookmarkId: string, parentId: string, operations: OperationLogEntry[]): Promise<boolean> {
  const current = await getBookmark(bookmarkId);
  if (!current || current.parentId === parentId) return false;
  operations.push({
    type: "move",
    bookmarkId,
    fromParentId: current.parentId,
    fromIndex: current.index,
    toParentId: parentId
  });
  await moveBookmark(bookmarkId, { parentId });
  return true;
}

async function removeEmptyFolders(operations: OperationLogEntry[]): Promise<number> {
  let removed = 0;
  let changed = true;

  while (changed) {
    changed = false;
    const tree = await getBookmarkTree();
    const writableRoot = getWritableRoot(tree);
    const emptyFolders = collectEmptyFolders(writableRoot, [writableRoot.title]).filter((node) => node.id !== writableRoot.id);

    for (const folder of emptyFolders) {
      if (!folder.parentId || isCuratorFolder(folder.path)) continue;
      operations.push({
        type: "remove-empty-folder",
        bookmarkId: folder.id,
        fromParentId: folder.parentId,
        fromIndex: folder.index,
        title: folder.title,
        path: folder.path
      });
      await removeTree(folder.id);
      removed += 1;
      changed = true;
    }
  }

  return removed;
}

function collectEmptyFolders(node: chrome.bookmarks.BookmarkTreeNode, path: string[]): Array<chrome.bookmarks.BookmarkTreeNode & { path: string[] }> {
  const children = node.children ?? [];
  const nested = children.flatMap((child) => collectEmptyFolders(child, [...path, child.title]));
  if (!node.url && children.length === 0) {
    return [{ ...node, path }];
  }
  return nested;
}

function isCuratorFolder(path: string[]): boolean {
  return path.includes(CURATOR_ROOT_FOLDER);
}

async function ensureFolderPath(path: string[]): Promise<chrome.bookmarks.BookmarkTreeNode> {
  const tree = await getBookmarkTree();
  const root = getWritableRoot(tree);
  let siblings = root.children ?? [];
  let parentId = root.id;
  let current: chrome.bookmarks.BookmarkTreeNode | undefined;

  for (const title of path) {
    current = siblings.find((node) => node.title === title && !node.url);
    if (!current) {
      current = await createBookmark({ parentId, title });
    }
    parentId = current.id;
    siblings = current.children ?? [];
  }

  if (!current) {
    throw new Error("Cannot create an empty folder path.");
  }
  return current;
}
