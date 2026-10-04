import { describe, expect, it } from "vitest";
import { isServerActionPost } from "./journey";

/**
 * The predicate `settleAction` waits on.
 *
 * **This test exists because the bug it covers was undetectable for weeks.**
 * The decision used to live inside a Playwright callback — `(response) =>
 * response.request().method() === "POST"` — where nothing in this repo could
 * reach it, so a wait that resolved on Clerk's own posts instead of ours read
 * as four flaky specs rather than as one wrong line.
 *
 * Same shape as the cold-start header bug of the same week: a decision put
 * somewhere no instrument can see it stays wrong for as long as it takes
 * somebody to notice by hand. Pulling it into a pure function is the entire
 * point; the assertions below are almost trivial, and that is the argument
 * for them, not against.
 *
 * The real-world shapes are taken from what a signed-in page actually emits:
 * Clerk's FAPI posts to `striking-jaybird-4695.clerk.accounts.dev` throughout
 * a session, and those are what the old predicate was resolving on.
 */

function request(method: string, headers: Record<string, string> = {}) {
  return { method: () => method, headers: () => headers };
}

describe("the post settleAction is waiting for", () => {
  it("accepts a Server Action post", () => {
    // `next-action` carries the action id; only its PRESENCE matters here.
    expect(isServerActionPost(request("POST", { "next-action": "7f3a1c" }))).toBe(true);
  });

  it("ignores a POST with no action header — this is the bug that shipped", () => {
    // Clerk's FAPI traffic. The old predicate resolved on exactly this, which
    // returned the wait before OUR action had answered and let `page.reload()`
    // navigate out from under the write.
    expect(
      isServerActionPost(request("POST", { "content-type": "application/json" })),
      "resolved on a non-action POST — that is the race that made four specs flaky",
    ).toBe(false);
  });

  it("ignores a POST with no headers at all", () => {
    expect(isServerActionPost(request("POST"))).toBe(false);
  });

  it("ignores a GET, even one carrying the action header", () => {
    // Belt and braces: an RSC navigation is not the write we are waiting on.
    expect(isServerActionPost(request("GET", { "next-action": "7f3a1c" }))).toBe(false);
  });

  it("is not satisfied by a header that merely contains the name", () => {
    // A substring match would pass here and must not. This pins that the
    // lookup is by KEY rather than by scanning the header blob.
    expect(isServerActionPost(request("POST", { "x-next-action-id": "7f3a1c" }))).toBe(false);
  });
});
