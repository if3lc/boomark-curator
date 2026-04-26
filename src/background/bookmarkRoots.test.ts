import { describe, expect, it } from "vitest";
import { getWritableRoot } from "./bookmarkRoots";

describe("bookmark root selection", () => {
  it("prefers the bookmarks bar when present", () => {
    const root = getWritableRoot([
      {
        id: "0",
        title: "",
        children: [
          { id: "2", title: "Other Bookmarks", children: [] },
          { id: "7", title: "Bookmarks Bar", children: [] }
        ]
      }
    ]);

    expect(root.id).toBe("7");
  });

  it("falls back to the first writable folder", () => {
    const root = getWritableRoot([{ id: "0", title: "", children: [{ id: "5", title: "Mobile Bookmarks", children: [] }] }]);
    expect(root.id).toBe("5");
  });
});
