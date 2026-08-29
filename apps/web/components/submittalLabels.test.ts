import { describe, expect, it } from "vitest";
import {
  type RevisionData,
  daysBetween,
  isOverdue,
  latestRevision,
  outcomeLabel,
  stateLabel,
  submittalState,
} from "@/components/submittalLabels";

function revision(overrides: Partial<RevisionData> & { revisionNumber: number; sentOn: string }): RevisionData {
  return {
    dueBack: null,
    returnedOn: null,
    outcome: null,
    responseNotes: null,
    ...overrides,
  };
}

describe("latestRevision", () => {
  it("is null when nothing has been sent", () => {
    expect(latestRevision([])).toBeNull();
  });

  // This is the function behind the "Build from revision N" chip. If it
  // ever picked by array position instead of revision number, a crew could
  // be pointed at a superseded drawing — which is the single most
  // expensive thing this page can get wrong.
  it("picks the highest revision number, not the last item in the array", () => {
    const r1 = revision({ revisionNumber: 1, sentOn: "2026-08-10" });
    const r2 = revision({ revisionNumber: 2, sentOn: "2026-08-22" });
    expect(latestRevision([r1, r2])).toBe(r2);
    expect(latestRevision([r2, r1])).toBe(r2);
  });

  it("is not confused by revision numbers above 9", () => {
    const r9 = revision({ revisionNumber: 9, sentOn: "2026-08-10" });
    const r10 = revision({ revisionNumber: 10, sentOn: "2026-08-22" });
    expect(latestRevision([r10, r9])).toBe(r10);
  });
});

describe("submittalState", () => {
  it("is NOT_SENT with no revisions", () => {
    expect(submittalState([])).toBe("NOT_SENT");
  });

  it("is WITH_GC while the latest revision is out", () => {
    expect(submittalState([revision({ revisionNumber: 1, sentOn: "2026-08-10" })])).toBe("WITH_GC");
  });

  it("is APPROVED on a plain approval", () => {
    expect(
      submittalState([
        revision({ revisionNumber: 1, sentOn: "2026-08-10", returnedOn: "2026-08-20", outcome: "APPROVED" }),
      ]),
    ).toBe("APPROVED");
  });

  // "Approved as noted" is still approved — you may build from it. Getting
  // this wrong would park finished submittals in the resubmit pile forever.
  it("treats approved-as-noted as approved", () => {
    expect(
      submittalState([
        revision({
          revisionNumber: 1,
          sentOn: "2026-08-10",
          returnedOn: "2026-08-20",
          outcome: "APPROVED_AS_NOTED",
        }),
      ]),
    ).toBe("APPROVED");
  });

  it("is REVISE on revise-and-resubmit and on rejection", () => {
    for (const outcome of ["REVISE_AND_RESUBMIT", "REJECTED"]) {
      expect(
        submittalState([
          revision({ revisionNumber: 1, sentOn: "2026-08-10", returnedOn: "2026-08-20", outcome }),
        ]),
      ).toBe("REVISE");
    }
  });

  // State follows the LATEST revision only. An approved R1 followed by a
  // sent R2 is back with the GC — reading the wrong one would say "build
  // from this" about a drawing that has since been superseded.
  it("follows the latest revision, not the first", () => {
    const revisions = [
      revision({ revisionNumber: 1, sentOn: "2026-08-10", returnedOn: "2026-08-20", outcome: "APPROVED" }),
      revision({ revisionNumber: 2, sentOn: "2026-08-22" }),
    ];
    expect(submittalState(revisions)).toBe("WITH_GC");
  });

  it("labels every state", () => {
    expect(stateLabel("NOT_SENT")).toBe("Not sent");
    expect(stateLabel("WITH_GC")).toBe("With the GC");
    expect(stateLabel("REVISE")).toBe("Revise and resubmit");
    expect(stateLabel("APPROVED")).toBe("Approved");
  });
});

describe("isOverdue", () => {
  const TODAY = "2026-08-28";

  it("is not overdue with no revisions or no due-back date", () => {
    expect(isOverdue([], TODAY)).toBe(false);
    expect(isOverdue([revision({ revisionNumber: 1, sentOn: "2026-01-01" })], TODAY)).toBe(false);
  });

  it("is overdue when the GC still has it past the date asked for", () => {
    expect(
      isOverdue([revision({ revisionNumber: 1, sentOn: "2026-08-10", dueBack: "2026-08-17" })], TODAY),
    ).toBe(true);
  });

  // Answered is answered. A returned revision is never overdue, however
  // late the answer was — that lateness is the turnaround figure, not a
  // live alert.
  it("is not overdue once the revision has come back", () => {
    expect(
      isOverdue(
        [
          revision({
            revisionNumber: 1,
            sentOn: "2026-08-10",
            dueBack: "2026-08-17",
            returnedOn: "2026-08-25",
            outcome: "APPROVED",
          }),
        ],
        TODAY,
      ),
    ).toBe(false);
  });

  it("is not overdue on the due date itself", () => {
    expect(
      isOverdue([revision({ revisionNumber: 1, sentOn: "2026-08-10", dueBack: TODAY })], TODAY),
    ).toBe(false);
  });
});

describe("outcomeLabel", () => {
  it("renders the stamp in plain language", () => {
    expect(outcomeLabel("APPROVED_AS_NOTED")).toBe("Approved as noted");
    expect(outcomeLabel("REVISE_AND_RESUBMIT")).toBe("Revise and resubmit");
  });

  it("falls back to the raw value rather than rendering nothing", () => {
    expect(outcomeLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });
});

describe("daysBetween", () => {
  it("counts the GC's turnaround in whole days", () => {
    expect(daysBetween("2026-08-10", "2026-08-20")).toBe(10);
    expect(daysBetween("2026-08-10", "2026-08-10")).toBe(0);
  });

  it("is unaffected by a daylight-saving change", () => {
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
  });
});
