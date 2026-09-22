import { describe, expect, it } from "vitest";
import { PROVIDERS } from "@/lib/integrations/registry";
import { ACC_REQUIRED_ENV, accCallbackMessage, accSetup, feedCardState } from "./setup";

/**
 * The ACC card with its keys missing must SAY it is not set up and offer
 * nothing to press. Same shape as lib/procore/setup.test.ts.
 */

const ALL = {
  ACC_CLIENT_ID: "a",
  ACC_CLIENT_SECRET: "b",
  ACC_REDIRECT_URI: "c",
  INTEGRATION_TOKEN_KEY: "d",
};

describe("accSetup", () => {
  it("names every missing variable, including the encryption key", () => {
    expect(accSetup({})).toEqual({ configured: false, missing: [...ACC_REQUIRED_ENV] });
    expect(accSetup({ ...ALL, INTEGRATION_TOKEN_KEY: " " })).toEqual({ configured: false, missing: ["INTEGRATION_TOKEN_KEY"] });
    expect(accSetup(ALL)).toEqual({ configured: true, missing: [] });
  });
});

describe("feedCardState (reused from lib/integrations/feedCardState.ts)", () => {
  it("is not-set-up whenever the install lacks keys — even with a live connection row", () => {
    expect(feedCardState(false, undefined)).toBe("not-set-up");
    expect(feedCardState(false, "CONNECTED")).toBe("not-set-up");
  });

  it("offers Connect, the links, or Reconnect once set up", () => {
    expect(feedCardState(true, undefined)).toBe("connect");
    expect(feedCardState(true, "NOT_CONNECTED")).toBe("connect");
    expect(feedCardState(true, "CONNECTED")).toBe("connected");
    expect(feedCardState(true, "NEEDS_REAUTH")).toBe("reconnect");
    expect(feedCardState(true, "ERROR")).toBe("reconnect");
  });
});

describe("the registry entry", () => {
  it("is a real feed, not a planned card, and names exactly the variables setup checks", () => {
    const entry = PROVIDERS.find((p) => p.provider === "ACC");
    expect(entry?.implementation).toEqual({ kind: "feed", startHref: "/api/acc/start", requiredEnv: ACC_REQUIRED_ENV });
  });
});

describe("accCallbackMessage", () => {
  it("maps fixed codes to sentences and never echoes an unknown one", () => {
    expect(accCallbackMessage("connected", undefined)?.ok).toBe(true);
    expect(accCallbackMessage("error", "state_mismatch")?.text).toMatch(/same browser tab/);
    expect(accCallbackMessage("error", "<script>")?.text).not.toContain("<script>");
    expect(accCallbackMessage(undefined, undefined)).toBeNull();
  });
});
