export function getWritableRoot(tree: chrome.bookmarks.BookmarkTreeNode[]): chrome.bookmarks.BookmarkTreeNode {
  const root = tree[0];
  const children = root?.children ?? [];
  const preferred = children.find((node) => !node.url && /bookmarks bar|yer imleri cubugu|yer imleri çubuğu/i.test(node.title));
  const fallback = children.find((node) => !node.url);
  if (!preferred && !fallback) {
    throw new Error("Could not find a writable bookmark root.");
  }
  return preferred ?? fallback!;
}
