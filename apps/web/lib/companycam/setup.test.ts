import { describe, expect, it } from "vitest";
import { companyCamCallbackMessage, companyCamCardState, companyCamSetup, COMPANYCAM_REQUIRED_ENV } from "./setup";

/**
 * Pure card-state logic — the "not set up on this install" card an owner
 * sees before anyone has added CompanyCam's app keys, and the states after.
 */

describe("companyCamSetup — the missing-config card", () => {
  it("is not configured, and names every missing variable, on a bare environment", () => {
    const result = companyCamSetup({});
    expect(result.configured).toBe(false);
    expect(result.missing.sort()).toEqual([...COMPANYCAM_REQUIRED_ENV].sort());
  });

  it("requires INTEGRATION_TOKEN_KEY too — a Connect button that cannot store the result is broken with extra steps", () => {
    const result = companyCamSetup({
      COMPANYCAM_CLIENT_ID: "id",
      COMPANYCAM_CLIENT_SECRET: "secret",
      COMPANYCAM_REDIRECT_URI: "https://app.cstream.ai/api/companycam/callback",
    });
    expect(result.configured).toBe(false);
    expect(result.missing).toEqual(["INTEGRATION_TOKEN_KEY"]);
  });

  it("blank strings count as missing, not merely absent keys", () => {
    const env = Object.fromEntries(COMPANYCAM_REQUIRED_ENV.map((k) => [k, "   "]));
    expect(companyCamSetup(env).configured).toBe(false);
  });

  it("is configured once every required variable has a real value", () => {
    const env = Object.fromEntries(COMPANYCAM_REQUIRED_ENV.map((k) => [k, "x"]));
    const result = companyCamSetup(env);
    expect(result.configured).toBe(true);
    expect(result.missing).toEqual([]);
  });
});

describe("companyCamCardState", () => {
  it("is not-set-up when the install lacks keys, whatever the connection status says", () => {
    expect(companyCamCardState(false, "CONNECTED")).toBe("not-set-up");
    expect(companyCamCardState(false, null)).toBe("not-set-up");
  });

  it("is connect when configured but never connected", () => {
    expect(companyCamCardState(true, null)).toBe("connect");
    expect(companyCamCardState(true, "NOT_CONNECTED")).toBe("connect");
  });

  it("is connected only on a live CONNECTED status", () => {
    expect(companyCamCardState(true, "CONNECTED")).toBe("connected");
  });

  it("is reconnect on NEEDS_REAUTH or ERROR — a dead credential, not a fresh install", () => {
    expect(companyCamCardState(true, "NEEDS_REAUTH")).toBe("reconnect");
    expect(companyCamCardState(true, "ERROR")).toBe("reconnect");
  });
});

describe("companyCamCallbackMessage", () => {
  it("is null when the callback sent back neither outcome", () => {
    expect(companyCamCallbackMessage(undefined, undefined)).toBeNull();
  });

  it("is ok on connected", () => {
    const result = companyCamCallbackMessage("connected", undefined);
    expect(result?.ok).toBe(true);
  });

  it("maps every known error detail to its own sentence, and an unknown one to a generic retry", () => {
    const known = companyCamCallbackMessage("error", "state_mismatch");
    expect(known?.ok).toBe(false);
    expect(known?.text).toMatch(/check this app sent/);
    const unknown = companyCamCallbackMessage("error", "something_new");
    expect(unknown?.ok).toBe(false);
    expect(unknown?.text).toMatch(/Press Connect and try again/);
  });
});
