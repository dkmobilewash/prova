import { describe, expect, it } from "vitest";
import { bluebeamCallbackMessage, bluebeamCardState, bluebeamSetup, BLUEBEAM_REQUIRED_ENV } from "./setup";

/**
 * Pure card-state logic — the "not set up on this install" card an owner
 * sees before anyone has added Bluebeam's app keys, and the states after.
 */

describe("bluebeamSetup — the missing-config card", () => {
  it("is not configured, and names every missing variable, on a bare environment", () => {
    const result = bluebeamSetup({});
    expect(result.configured).toBe(false);
    expect(result.missing.sort()).toEqual([...BLUEBEAM_REQUIRED_ENV].sort());
  });

  it("requires INTEGRATION_TOKEN_KEY too — a Connect button that cannot store the result is broken with extra steps", () => {
    const result = bluebeamSetup({
      BLUEBEAM_CLIENT_ID: "id",
      BLUEBEAM_CLIENT_SECRET: "secret",
      BLUEBEAM_REDIRECT_URI: "https://app.cstream.ai/api/bluebeam/callback",
    });
    expect(result.configured).toBe(false);
    expect(result.missing).toEqual(["INTEGRATION_TOKEN_KEY"]);
  });

  it("blank strings count as missing, not merely absent keys", () => {
    const env = Object.fromEntries(BLUEBEAM_REQUIRED_ENV.map((k) => [k, "   "]));
    expect(bluebeamSetup(env).configured).toBe(false);
  });

  it("is configured once every required variable has a real value, with no BLUEBEAM_REGION set", () => {
    const env = Object.fromEntries(BLUEBEAM_REQUIRED_ENV.map((k) => [k, "x"]));
    const result = bluebeamSetup(env);
    expect(result.configured).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("accepts a real region, case-insensitively", () => {
    const env = Object.fromEntries(BLUEBEAM_REQUIRED_ENV.map((k) => [k, "x"]));
    expect(bluebeamSetup({ ...env, BLUEBEAM_REGION: "de" }).configured).toBe(true);
    expect(bluebeamSetup({ ...env, BLUEBEAM_REGION: "UK" }).configured).toBe(true);
  });

  it("treats a region outside the five Bluebeam serves as not set up, not as a guess", () => {
    const env = Object.fromEntries(BLUEBEAM_REQUIRED_ENV.map((k) => [k, "x"]));
    const result = bluebeamSetup({ ...env, BLUEBEAM_REGION: "CA" });
    expect(result.configured).toBe(false);
    expect(result.missing).toEqual(["BLUEBEAM_REGION"]);
  });
});

describe("bluebeamCardState", () => {
  it("is not-set-up when the install lacks keys, whatever the connection status says", () => {
    expect(bluebeamCardState(false, "CONNECTED")).toBe("not-set-up");
    expect(bluebeamCardState(false, null)).toBe("not-set-up");
  });

  it("is connect when configured but never connected", () => {
    expect(bluebeamCardState(true, null)).toBe("connect");
    expect(bluebeamCardState(true, "NOT_CONNECTED")).toBe("connect");
  });

  it("is connected only on a live CONNECTED status", () => {
    expect(bluebeamCardState(true, "CONNECTED")).toBe("connected");
  });

  it("is reconnect on NEEDS_REAUTH or ERROR", () => {
    expect(bluebeamCardState(true, "NEEDS_REAUTH")).toBe("reconnect");
    expect(bluebeamCardState(true, "ERROR")).toBe("reconnect");
  });
});

describe("bluebeamCallbackMessage", () => {
  it("is null with no outcome in the query string", () => {
    expect(bluebeamCallbackMessage(undefined, undefined)).toBeNull();
  });

  it("is a fixed success sentence on connected", () => {
    const message = bluebeamCallbackMessage("connected", undefined);
    expect(message?.ok).toBe(true);
  });

  it("maps a known error detail to its own sentence", () => {
    const message = bluebeamCallbackMessage("error", "state_mismatch");
    expect(message?.ok).toBe(false);
    expect(message?.text).toMatch(/state_mismatch|check this app sent/);
  });

  it("falls back to a generic sentence for an unrecognised detail — never echoing the URL", () => {
    const message = bluebeamCallbackMessage("error", "<script>alert(1)</script>");
    expect(message?.ok).toBe(false);
    expect(message?.text).not.toContain("<script>");
  });
});
