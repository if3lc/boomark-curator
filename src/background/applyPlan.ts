import { BROKEN_FOLDER, CURATOR_ROOT_FOLDER, DUPLICATE_FOLDER } from "../shared/defaults";
import type { CurationPlan, OperationLogEntry } from "../shared/types";
import { createBookmark, getBookmark, getBookmarkTree, moveBookmark, removeTree } from "./chromeApi";

export async function applyCurationPlan(plan: CurationPlan): Promise<OperationLogEntry[]> {
  const operations: OperationLogEntry[] = [];
  await ensureFolderPath([CURATOR_ROOT_FOLDER]);
  const broken = await ensureFolderPath([CURATOR_ROOT_FOLDER, BROKEN_FOLDER]);
  const duplicates = await ensureFolderPath([CURATOR_ROOT_FOLDER, DUPLICATE_FOLDER]);

  for (const bookmarkId of plan.brokenBookmarkIds) {
    await moveWithLog(bookmarkId, broken.id, operations);
  }

  for (const group of plan.duplicateGroups) {
    for (const bookmarkId of group.bookmarkIds.slice(1)) {
      await moveWithLog(bookmarkId, duplicates.id, operations);
    }
  }

  for (const move of plan.moves) {
    const target = await ensureFolderPath(move.targetPath);
    await moveWithLog(move.bookmarkId, target.id, operations);
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
  }
}

async function moveWithLog(bookmarkId: string, parentId: string, operations: OperationLogEntry[]): Promise<void> {
  const current = await getBookmark(bookmarkId);
  if (!current || current.parentId === parentId) return;
  operations.push({
    type: "move",
    bookmarkId,
    fromParentId: current.parentId,
    fromIndex: current.index,
    toParentId: parentId
  });
  await moveBookmark(bookmarkId, { parentId });
}

async function ensureFolderPath(path: string[]): Promise<chrome.bookmarks.BookmarkTreeNode> {
  const tree = await getBookmarkTree();
  let siblings = tree[0]?.children ?? [];
  let parentId = "1";
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
