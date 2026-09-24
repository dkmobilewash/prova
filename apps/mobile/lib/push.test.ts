import { describe, expect, it } from "vitest";
import { targetFromData } from "./push-target";

/**
 * The payload contract between the two halves of a push — stated here in
 * node, where the lib suite runs, because the routing decision is pure
 * and the two sides must never drift. The send half writes
 * `{ target: "alerts" }` (lib/notification-push.ts on the web) and
 * `{ jobId }` (assignCrewMember). The tap-answering half that READS it
 * is exercised in screens/push.test.tsx, where hooks can render.
 */

describe("targetFromData — the payload contract", () => {
  it("maps the digest push to the alerts screen", () => {
    expect(targetFromData({ target: "alerts" })).toBe("/alerts");
  });

  it("maps an assignment push to its job", () => {
    expect(targetFromData({ jobId: "job_1" })).toBe("/job/job_1");
  });

  it("refuses to navigate for anything it cannot answer", () => {
    expect(targetFromData(null)).toBeNull();
    expect(targetFromData(undefined)).toBeNull();
    expect(targetFromData({})).toBeNull();
    expect(targetFromData({ target: "settings" })).toBeNull();
    expect(targetFromData({ target: "alerts", extra: true })).toBe("/alerts");
    expect(targetFromData({ jobId: 42 })).toBeNull();
    expect(targetFromData({ jobId: "" })).toBeNull();
  });
});
