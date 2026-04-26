import { describe, expect, it } from "vitest";
import { findDuplicateGroups, flattenBookmarkTree } from "./bookmarks";

describe("bookmark helpers", () => {
  it("flattens bookmark trees with paths", () => {
    const records = flattenBookmarkTree([
      {
        id: "0",
        title: "",
        children: [
          {
            id: "1",
            title: "Bookmarks Bar",
            children: [{ id: "2", parentId: "1", title: "Example", url: "https://example.com", index: 0 }]
          }
        ]
      }
    ]);

    expect(records.find((record) => record.id === "2")?.path).toEqual(["Bookmarks Bar", "Example"]);
  });

  it("groups duplicates by normalized URL", () => {
    const groups = findDuplicateGroups([
      { id: "1", title: "A", url: "https://example.com/?utm_source=x#top", path: ["A"] },
      { id: "2", title: "B", url: "https://example.com", path: ["B"] },
      { id: "3", title: "C", url: "https://other.test", path: ["C"] }
    ]);

    expect(groups).toEqual([{ normalizedUrl: "https://example.com", bookmarkIds: ["1", "2"] }]);
  });
});
