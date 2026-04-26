export async function getBookmarkTree(): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
  return chrome.bookmarks.getTree();
}

export async function createBookmark(bookmark: chrome.bookmarks.BookmarkCreateArg): Promise<chrome.bookmarks.BookmarkTreeNode> {
  return chrome.bookmarks.create(bookmark);
}

export async function moveBookmark(id: string, destination: chrome.bookmarks.BookmarkDestinationArg): Promise<chrome.bookmarks.BookmarkTreeNode> {
  return chrome.bookmarks.move(id, destination);
}

export async function removeTree(id: string): Promise<void> {
  await chrome.bookmarks.removeTree(id);
}

export async function getBookmark(id: string): Promise<chrome.bookmarks.BookmarkTreeNode | undefined> {
  const nodes = await chrome.bookmarks.get(id);
  return nodes[0];
}

export async function downloadJson(filename: string, value: unknown): Promise<number> {
  const json = JSON.stringify(value, null, 2);
  const url = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
  return chrome.downloads.download({ url, filename, saveAs: true });
}

export async function queryActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}
