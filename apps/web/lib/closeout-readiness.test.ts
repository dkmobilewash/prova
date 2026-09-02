import { describe, expect, it } from "vitest";
import {
  closeoutBlockers,
  closeoutReadiness,
  needsAttention,
  type CloseoutReadinessInput,
} from "./closeout-readiness";

const TODAY = "2026-09-01";

const clean: CloseoutReadinessInput = {
  requiredItemsTotal: 6,
  requiredItemsOutstanding: 0,
  openPunchItems: 0,
  openCallbacks: 0,
  retainageBalance: 0,
  latestSubmission: null,
};

const kinds = (input: CloseoutReadinessInput) => closeoutBlockers(input).map((b) => b.kind);

describe("closeoutBlockers", () => {
  it("has nothing to say about a job with every required item done", () => {
    expect(closeoutBlockers(clean)).toEqual([]);
  });

  it("treats an empty checklist as a blocker, not as a pass", () => {
    // Same rule as isCloseoutComplete: nothing has been asserted about
    // this job, and reporting "ready to submit" for it would be the most
    // dangerous default available.
    expect(kinds({ ...clean, requiredItemsTotal: 0 })).toEqual(["NO_CHECKLIST"]);
  });

  it("does not double-report an empty checklist as outstanding items", () => {
    const blockers = closeoutBlockers({
      ...clean,
      requiredItemsTotal: 0,
      requiredItemsOutstanding: 0,
    });
    expect(blockers).toHaveLength(1);
  });

  it("counts open punch items even when the checklist claims sign-off", () => {
    // The checklist is somebody's assertion; the punch rows are what can
    // contradict it. This is the whole reason readiness reads both.
    expect(kinds({ ...clean, openPunchItems: 6 })).toEqual(["OPEN_PUNCH_ITEMS"]);
    expect(closeoutBlockers({ ...clean, openPunchItems: 6 })[0].count).toBe(6);
  });

  it("orders the paperwork ahead of the field work ahead of the callbacks", () => {
    expect(
      kinds({
        ...clean,
        requiredItemsOutstanding: 2,
        openPunchItems: 6,
        openCallbacks: 1,
      }),
    ).toEqual(["REQUIRED_ITEMS", "OPEN_PUNCH_ITEMS", "OPEN_CALLBACKS"]);
  });
});

describe("closeoutReadiness", () => {
  it("is ready to submit only when nothing is open and nothing has been sent", () => {
    expect(closeoutReadiness(clean, TODAY).stage).toBe("READY_TO_SUBMIT");
  });

  it("is not ready while anything is open", () => {
    expect(closeoutReadiness({ ...clean, openPunchItems: 1 }, TODAY).stage).toBe("NOT_READY");
    expect(closeoutReadiness({ ...clean, requiredItemsTotal: 0 }, TODAY).stage).toBe("NOT_READY");
  });

  it("is with the GC once submitted, and counts the days", () => {
    const r = closeoutReadiness(
      {
        ...clean,
        latestSubmission: { status: "SUBMITTED", submittedOn: "2026-08-11", respondedOn: null },
      },
      TODAY,
    );
    expect(r.stage).toBe("AWAITING_GC");
    expect(r.daysWithGc).toBe(21);
  });

  it("stops the clock at the response, not at today", () => {
    const r = closeoutReadiness(
      {
        ...clean,
        latestSubmission: {
          status: "REJECTED",
          submittedOn: "2026-08-11",
          respondedOn: "2026-08-18",
        },
      },
      TODAY,
    );
    expect(r.stage).toBe("REJECTED");
    expect(r.daysWithGc).toBe(7);
  });

  it("says nothing rather than a negative when the dates are the wrong way round", () => {
    const r = closeoutReadiness(
      {
        ...clean,
        latestSubmission: {
          status: "ACCEPTED",
          submittedOn: "2026-08-18",
          respondedOn: "2026-08-11",
        },
      },
      TODAY,
    );
    expect(r.daysWithGc).toBeNull();
  });

  it("keeps an accepted package accepted when a callback comes in afterwards", () => {
    // A sticking door reported the week after the GC took the package is
    // warranty work. Letting it flip the stage back to NOT_READY would
    // make this column untrustworthy the first time it happened.
    const r = closeoutReadiness(
      {
        ...clean,
        openCallbacks: 1,
        latestSubmission: {
          status: "ACCEPTED",
          submittedOn: "2026-07-01",
          respondedOn: "2026-07-20",
        },
      },
      TODAY,
    );
    expect(r.stage).toBe("ACCEPTED");
    // Still reported, just not deciding the stage.
    expect(r.blockers.map((b) => b.kind)).toEqual(["OPEN_CALLBACKS"]);
  });

  it("reports a rejected package as ours again even with nothing else open", () => {
    const r = closeoutReadiness(
      {
        ...clean,
        latestSubmission: {
          status: "REJECTED",
          submittedOn: "2026-08-01",
          respondedOn: "2026-08-05",
        },
      },
      TODAY,
    );
    expect(r.stage).toBe("REJECTED");
    expect(r.blockers).toEqual([]);
  });

  it("carries the retainage through without folding it into the stage", () => {
    const r = closeoutReadiness({ ...clean, retainageBalance: 13420 }, TODAY);
    // Money held is what the blockers cost, not itself a blocker — a job
    // that is genuinely ready to submit is ready whatever is outstanding.
    expect(r.retainageAtStake).toBe(13420);
    expect(r.stage).toBe("READY_TO_SUBMIT");
    expect(r.blockers).toEqual([]);
  });
});

describe("needsAttention", () => {
  const row = (name: string, input: Partial<CloseoutReadinessInput>) => ({
    name,
    readiness: closeoutReadiness({ ...clean, ...input }, TODAY),
  });

  it("puts the most money first", () => {
    const rows = needsAttention([
      row("small", { requiredItemsOutstanding: 1, retainageBalance: 900 }),
      row("big", { requiredItemsOutstanding: 1, retainageBalance: 42000 }),
      row("middling", { requiredItemsOutstanding: 1, retainageBalance: 5000 }),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["big", "middling", "small"]);
  });

  it("leaves out a job whose package the GC has accepted", () => {
    const rows = needsAttention([
      row("done", {
        retainageBalance: 8000,
        latestSubmission: { status: "ACCEPTED", submittedOn: "2026-07-01", respondedOn: "2026-07-10" },
      }),
    ]);
    // Retainage still outstanding on an accepted package is a payment
    // question, not a closeout one — /cash-flow's problem, not this page's.
    expect(rows).toEqual([]);
  });

  it("leaves out a quiet job with nothing open and nothing at stake", () => {
    expect(
      needsAttention([
        row("quiet", {
          latestSubmission: { status: "SUBMITTED", submittedOn: "2026-08-25", respondedOn: null },
        }),
      ]),
    ).toEqual([]);
  });

  it("keeps a job that is ready to submit even with no money at stake", () => {
    // Nobody has sent it. That is a thing to do today regardless of the
    // balance, and it is the case this whole model was added to name.
    expect(needsAttention([row("ready", {})]).map((r) => r.name)).toEqual(["ready"]);
  });

  it("keeps a rejected package", () => {
    expect(
      needsAttention([
        row("bounced", {
          latestSubmission: { status: "REJECTED", submittedOn: "2026-08-01", respondedOn: "2026-08-05" },
        }),
      ]).map((r) => r.name),
    ).toEqual(["bounced"]);
  });
});
