import { describe, expect, it } from "vitest";
import { getDomain, isHttpUrl, normalizeUrl } from "./url";

describe("url helpers", () => {
  it("normalizes common tracking parameters", () => {
    expect(normalizeUrl("https://Example.com:443/path/?utm_source=x&a=1#section")).toBe("https://example.com/path/?a=1");
  });

  it("checks supported schemes", () => {
    expect(isHttpUrl("https://example.com")).toBe(true);
    expect(isHttpUrl("chrome://extensions")).toBe(false);
  });

  it("extracts domains", () => {
    expect(getDomain("https://Example.com/path")).toBe("example.com");
    expect(getDomain("not a url")).toBe("");
  });
});
