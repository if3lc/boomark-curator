import type { BookmarkRecord, DuplicateGroup } from "./types";
import { normalizeUrl } from "./url";

export function flattenBookmarkTree(tree: chrome.bookmarks.BookmarkTreeNode[]): BookmarkRecord[] {
  const records: BookmarkRecord[] = [];

  function visit(node: chrome.bookmarks.BookmarkTreeNode, path: string[]): void {
    const nextPath = node.title ? [...path, node.title] : path;
    records.push({
      id: node.id,
      parentId: node.parentId,
      title: node.title,
      url: node.url,
      index: node.index,
      dateAdded: node.dateAdded,
      dateGroupModified: node.dateGroupModified,
      path: nextPath
    });

    for (const child of node.children ?? []) {
      visit(child, nextPath);
    }
  }

  for (const root of tree) {
    visit(root, []);
  }

  return records;
}

export function getBookmarkLeaves(records: BookmarkRecord[]): BookmarkRecord[] {
  return records.filter((record) => Boolean(record.url));
}

export function findDuplicateGroups(records: BookmarkRecord[]): DuplicateGroup[] {
  const byUrl = new Map<string, string[]>();

  for (const record of records) {
    if (!record.url) continue;
    try {
      const normalized = normalizeUrl(record.url);
      byUrl.set(normalized, [...(byUrl.get(normalized) ?? []), record.id]);
    } catch {
      continue;
    }
  }

  return [...byUrl.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([normalizedUrl, bookmarkIds]) => ({ normalizedUrl, bookmarkIds }));
}

export function pathToLabel(path: string[]): string {
  return path.filter(Boolean).join(" / ");
}
