import { describe, expect, it } from "vitest";
import { PROVIDERS } from "@/lib/integrations/registry";
import { PROCORE_REQUIRED_ENV, feedCardState, procoreCallbackMessage, procoreSetup } from "./setup";

/**
 * The Procore card with its keys missing must SAY it is not set up and
 * offer nothing to press. These are the pure decisions the Integrations
 * page renders from.
 */

const ALL = {
  PROCORE_CLIENT_ID: "a",
  PROCORE_CLIENT_SECRET: "b",
  PROCORE_REDIRECT_URI: "c",
  INTEGRATION_TOKEN_KEY: "d",
};

describe("procoreSetup", () => {
  it("names every missing variable, including the encryption key; PROCORE_ENVIRONMENT is optional", () => {
    expect(procoreSetup({})).toEqual({ configured: false, missing: [...PROCORE_REQUIRED_ENV] });
    expect(procoreSetup({ ...ALL, INTEGRATION_TOKEN_KEY: " " })).toEqual({ configured: false, missing: ["INTEGRATION_TOKEN_KEY"] });
    expect(procoreSetup(ALL)).toEqual({ configured: true, missing: [] });
    expect(PROCORE_REQUIRED_ENV).not.toContain("PROCORE_ENVIRONMENT");
  });
});

describe("feedCardState", () => {
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
    const entry = PROVIDERS.find((p) => p.provider === "PROCORE");
    expect(entry?.implementation).toEqual({ kind: "feed", startHref: "/api/procore/start", requiredEnv: PROCORE_REQUIRED_ENV });
  });
});

describe("procoreCallbackMessage", () => {
  it("maps fixed codes to sentences and never echoes an unknown one", () => {
    expect(procoreCallbackMessage("connected", undefined)?.ok).toBe(true);
    expect(procoreCallbackMessage("error", "state_mismatch")?.text).toMatch(/same browser tab/);
    expect(procoreCallbackMessage("error", "<script>")?.text).not.toContain("<script>");
    expect(procoreCallbackMessage(undefined, undefined)).toBeNull();
  });
});
