import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BASE_PATH } from "./site";

describe("the base path", () => {
  it("is the same in next.config and in the fetch() prefix", () => {
    // A bare fetch() is the one thing Next does not prefix. If these drift,
    // every download and sign-up POSTs to a path that does not exist.
    const config = readFileSync(new URL("../next.config.mjs", import.meta.url), "utf8");
    expect(config.match(/basePath:\s*"([^"]+)"/)?.[1]).toBe(BASE_PATH);
  });
});
