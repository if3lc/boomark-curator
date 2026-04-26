import { describe, expect, it, vi } from "vitest";
import { checkLink } from "./linkChecker";
import { DEFAULT_SETTINGS } from "../shared/defaults";

describe("linkChecker", () => {
  it("uses an opaque restricted probe for Chrome Web Store URLs", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 0 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkLink(
      {
        id: "1",
        title: "Chrome Web Store item",
        url: "https://chromewebstore.google.com/detail/example/abc",
        path: ["Bookmarks Bar"]
      },
      DEFAULT_SETTINGS
    );

    expect(result.status).toBe("restricted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://chromewebstore.google.com/detail/example/abc",
      expect.objectContaining({ mode: "no-cors", method: "GET" })
    );

    vi.unstubAllGlobals();
  });
});
