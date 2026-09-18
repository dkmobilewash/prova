import { describe, expect, it } from "vitest";
import { PROVIDERS } from "@/lib/integrations/registry";
import { JOBBER_REQUIRED_ENV, importCardState, jobberCallbackMessage, jobberSetup } from "./setup";

/**
 * The Jobber card with its keys missing must SAY it is not set up, and offer
 * nothing to press — not a Connect button that fails after the consent
 * screen. These are the pure decisions the Integrations page renders from.
 */

const ALL = {
  JOBBER_CLIENT_ID: "a",
  JOBBER_CLIENT_SECRET: "b",
  JOBBER_REDIRECT_URI: "c",
  INTEGRATION_TOKEN_KEY: "d",
};

describe("jobberSetup", () => {
  it("names every missing variable, including the encryption key", () => {
    expect(jobberSetup({})).toEqual({ configured: false, missing: [...JOBBER_REQUIRED_ENV] });
    expect(jobberSetup({ ...ALL, INTEGRATION_TOKEN_KEY: "  " })).toEqual({
      configured: false,
      missing: ["INTEGRATION_TOKEN_KEY"],
    });
    expect(jobberSetup(ALL)).toEqual({ configured: true, missing: [] });
  });
});

describe("importCardState", () => {
  it("is not-set-up whenever the install lacks keys — even for a company with a live connection row", () => {
    expect(importCardState(false, undefined)).toBe("not-set-up");
    expect(importCardState(false, "CONNECTED")).toBe("not-set-up");
  });

  it("offers Connect, the import, or Reconnect once set up", () => {
    expect(importCardState(true, undefined)).toBe("connect");
    expect(importCardState(true, "NOT_CONNECTED")).toBe("connect");
    expect(importCardState(true, "CONNECTED")).toBe("connected");
    expect(importCardState(true, "NEEDS_REAUTH")).toBe("reconnect");
  });
});

describe("the registry entry", () => {
  it("is an import provider that requires exactly these variables", () => {
    const entry = PROVIDERS.find((p) => p.provider === "JOBBER");
    expect(entry?.implementation).toEqual({
      kind: "import",
      startHref: "/api/jobber/start",
      requiredEnv: JOBBER_REQUIRED_ENV,
    });
  });
});

describe("callback outcome on the page", () => {
  it("renders only fixed sentences, never the detail text itself", () => {
    expect(jobberCallbackMessage("connected", undefined)?.ok).toBe(true);
    const odd = jobberCallbackMessage("error", "<script>alert(1)</script>");
    expect(odd?.text).not.toContain("script");
    expect(jobberCallbackMessage(undefined, undefined)).toBeNull();
  });
});
