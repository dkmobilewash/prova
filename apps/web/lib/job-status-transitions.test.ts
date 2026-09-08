import { describe, expect, it } from "vitest";
import {
  allowedJobStatusTransitions,
  canTransitionJobStatus,
  isJobStatus,
  JOB_STATUSES,
  JOB_STATUS_TRANSITIONS,
  jobStatusTransitionRefusal,
  type JobStatusValue,
} from "./job-status-transitions";

/**
 * The job lifecycle policy, executed.
 *
 * Worth executing rather than reading, because the thing this replaces was
 * not a wrong table — it was NO table: `data: { status: "CONTRACTED" }` was
 * the only job-status write in the app, so IN_PROGRESS and COMPLETE were
 * schema values nothing could produce. Every assertion below names the
 * value it demands, so reintroducing the defect makes a specific test go
 * red rather than shifting a count.
 */

describe("which job statuses exist", () => {
  it("is exactly the four the schema declares", () => {
    expect([...JOB_STATUSES]).toEqual(["ESTIMATE", "CONTRACTED", "IN_PROGRESS", "COMPLETE"]);
  });

  it("isJobStatus rejects anything else, including near-misses and non-strings", () => {
    expect(isJobStatus("IN_PROGRESS")).toBe(true);
    expect(isJobStatus("in_progress")).toBe(false);
    expect(isJobStatus("DONE")).toBe(false);
    expect(isJobStatus("")).toBe(false);
    expect(isJobStatus(null)).toBe(false);
    expect(isJobStatus(undefined)).toBe(false);
    expect(isJobStatus(3)).toBe(false);
  });
});

describe("the moves that are allowed", () => {
  it("a contracted job can start work, and that is its only move", () => {
    expect([...allowedJobStatusTransitions("CONTRACTED")]).toEqual(["IN_PROGRESS"]);
    expect(canTransitionJobStatus("CONTRACTED", "IN_PROGRESS")).toBe(true);
  });

  it("an in-progress job can be completed, or put back to contracted", () => {
    expect([...allowedJobStatusTransitions("IN_PROGRESS")]).toEqual(["CONTRACTED", "COMPLETE"]);
    expect(canTransitionJobStatus("IN_PROGRESS", "COMPLETE")).toBe(true);
    expect(canTransitionJobStatus("IN_PROGRESS", "CONTRACTED")).toBe(true);
  });

  it("a complete job can be reopened to in-progress — punch work comes back", () => {
    expect([...allowedJobStatusTransitions("COMPLETE")]).toEqual(["IN_PROGRESS"]);
    expect(canTransitionJobStatus("COMPLETE", "IN_PROGRESS")).toBe(true);
  });

  it("IN_PROGRESS and COMPLETE are both actually reachable — the whole point", () => {
    const reachable = new Set<JobStatusValue>();
    for (const from of JOB_STATUSES) {
      for (const to of JOB_STATUS_TRANSITIONS[from]) reachable.add(to);
    }
    expect(reachable.has("IN_PROGRESS"), "nothing can put a job IN_PROGRESS").toBe(true);
    expect(reachable.has("COMPLETE"), "nothing can put a job COMPLETE").toBe(true);
  });
});

describe("the moves that are refused, and why", () => {
  it("nothing may transition INTO contracted here — that gate lives in markJobContracted", () => {
    for (const from of JOB_STATUSES) {
      if (from === "IN_PROGRESS") continue; // the correction move, deliberate
      expect(
        canTransitionJobStatus(from, "CONTRACTED"),
        `${from} → CONTRACTED would be a second door into billing with no evidence behind it`,
      ).toBe(false);
    }
  });

  it("an estimate cannot be moved by this table at all", () => {
    expect([...allowedJobStatusTransitions("ESTIMATE")]).toEqual([]);
    expect(canTransitionJobStatus("ESTIMATE", "CONTRACTED")).toBe(false);
    expect(canTransitionJobStatus("ESTIMATE", "IN_PROGRESS")).toBe(false);
    expect(canTransitionJobStatus("ESTIMATE", "COMPLETE")).toBe(false);
  });

  it("NOTHING ever goes back to estimate — that would unlock contracted scope", () => {
    for (const from of JOB_STATUSES) {
      expect(canTransitionJobStatus(from, "ESTIMATE"), `${from} → ESTIMATE must stay refused`).toBe(
        false,
      );
    }
  });

  it("a contracted job cannot skip straight to complete", () => {
    expect(canTransitionJobStatus("CONTRACTED", "COMPLETE")).toBe(false);
  });

  it("a complete job cannot jump back to contracted", () => {
    expect(canTransitionJobStatus("COMPLETE", "CONTRACTED")).toBe(false);
  });
});

describe("the refusal sentence", () => {
  it("is null exactly when the move is legal", () => {
    for (const from of JOB_STATUSES) {
      for (const to of JOB_STATUSES) {
        const refusal = jobStatusTransitionRefusal(from, to);
        expect(
          refusal === null,
          `${from} → ${to}: refusal and legality disagree`,
        ).toBe(canTransitionJobStatus(from, to) && from !== to);
      }
    }
  });

  it("says a job is already there rather than refusing cryptically", () => {
    expect(jobStatusTransitionRefusal("IN_PROGRESS", "IN_PROGRESS")).toBe(
      "This job is already in progress.",
    );
  });

  it("explains the estimate gate by naming BOTH routes, not just the e-signature", () => {
    const refusal = jobStatusTransitionRefusal("ESTIMATE", "IN_PROGRESS") ?? "";
    expect(refusal).toContain("still an estimate");
    expect(refusal, "must mention the e-sign route").toContain("signs it in Prova");
    expect(refusal, "must mention the off-platform route").toContain("executed subcontract");
  });

  it("explains why nothing returns to estimate in terms of the consequence", () => {
    const refusal = jobStatusTransitionRefusal("IN_PROGRESS", "ESTIMATE") ?? "";
    expect(refusal).toContain("change order");
  });

  it("names what IS allowed from here when a move is skipped", () => {
    const refusal = jobStatusTransitionRefusal("CONTRACTED", "COMPLETE") ?? "";
    expect(refusal).toContain("Allowed from here: in progress.");
  });

  it("never returns an empty or whitespace-only sentence", () => {
    for (const from of JOB_STATUSES) {
      for (const to of JOB_STATUSES) {
        const refusal = jobStatusTransitionRefusal(from, to);
        if (refusal !== null) expect(refusal.trim().length).toBeGreaterThan(20);
      }
    }
  });
});
