import { flattenBookmarkTree } from "../shared/bookmarks";
import { checksum } from "../shared/checksum";
import type { BookmarkSnapshot, Settings } from "../shared/types";
import { getBookmarkTree } from "./chromeApi";

export async function createSnapshot(settings: Settings): Promise<BookmarkSnapshot> {
  const tree = await getBookmarkTree();
  const records = flattenBookmarkTree(tree);
  const createdAt = new Date().toISOString();
  return {
    version: 1,
    createdAt,
    checksum: await checksum({ tree, settings, createdAt }),
    tree,
    records,
    settings
  };
}
