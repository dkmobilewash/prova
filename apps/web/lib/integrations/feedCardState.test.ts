import { describe, expect, it } from "vitest";
import { feedCardState } from "./feedCardState";

/**
 * The decision itself, tested directly against the shared module rather
 * than through either re-export — lib/procore/setup.test.ts and
 * lib/acc/setup.test.ts both exercise it too, transitively, through their
 * own re-exports; this is the one place it is tested as what it actually
 * is: a pure function with nothing provider-specific in it.
 */
describe("feedCardState", () => {
  it("is not-set-up whenever the install lacks keys — even with a live connection row", () => {
    expect(feedCardState(false, undefined)).toBe("not-set-up");
    expect(feedCardState(false, null)).toBe("not-set-up");
    expect(feedCardState(false, "CONNECTED")).toBe("not-set-up");
  });

  it("offers Connect when configured but nothing has connected yet", () => {
    expect(feedCardState(true, undefined)).toBe("connect");
    expect(feedCardState(true, null)).toBe("connect");
    expect(feedCardState(true, "NOT_CONNECTED")).toBe("connect");
  });

  it("is connected only on the CONNECTED status", () => {
    expect(feedCardState(true, "CONNECTED")).toBe("connected");
  });

  it("offers Reconnect on a dead credential, never a silent fall-through to Connect", () => {
    expect(feedCardState(true, "NEEDS_REAUTH")).toBe("reconnect");
    expect(feedCardState(true, "ERROR")).toBe("reconnect");
  });
});
