import { describe, expect, it } from "vitest";
import {
  type RevisionData,
  byNewestFirst,
  currentRevision,
  daysBetween,
  daysToReachUs,
  setState,
  stateLabel,
  unreceivedRevisions,
} from "@/components/drawingLabels";

function rev(overrides: Partial<RevisionData> & { label: string; issuedOn: string }): RevisionData {
  return {
    id: `r-${overrides.label}`,
    receivedOn: null,
    description: null,
    fileUrl: null,
    fileName: null,
    ...overrides,
  };
}

describe("currentRevision", () => {
  it("is null when nothing has been issued", () => {
    expect(currentRevision([])).toBeNull();
  });

  // The whole page rests on this. If it ever picked by array position, a
  // crew gets pointed at a superseded sheet — the most expensive thing
  // this feature can get wrong.
  it("picks the latest issue date, not the last item in the array", () => {
    const r1 = rev({ label: "Rev 1", issuedOn: "2026-08-01" });
    const r3 = rev({ label: "Rev 3", issuedOn: "2026-08-20" });
    expect(currentRevision([r1, r3])?.label).toBe("Rev 3");
    expect(currentRevision([r3, r1])?.label).toBe("Rev 3");
  });

  // Issued supersedes received. A revision we haven't got is still the one
  // that governs — that is what makes it dangerous rather than pending.
  it("prefers the newest ISSUED revision even when an older one is the one in hand", () => {
    const held = rev({ label: "Rev 1", issuedOn: "2026-08-01", receivedOn: "2026-08-02" });
    const issuedNotHeld = rev({ label: "Rev 2", issuedOn: "2026-08-20" });
    expect(currentRevision([held, issuedNotHeld])?.label).toBe("Rev 2");
  });

  // Labels are the architect's free text, so they do not sort usefully.
  // "ASI-12" must not lose to "Rev 1" on a string comparison.
  it("does not rely on the label to decide which is newest", () => {
    const a = rev({ label: "ASI-12", issuedOn: "2026-08-20" });
    const b = rev({ label: "Rev 1", issuedOn: "2026-08-01" });
    expect(currentRevision([a, b])?.label).toBe("ASI-12");
    expect(currentRevision([b, a])?.label).toBe("ASI-12");
  });

  // Labelled so the received revision is the alphabetically EARLIER one.
  // It used to be the later one, which meant the label tiebreak and the
  // received-date tiebreak agreed on the answer — and deleting the
  // received-date comparison from byNewestFirst left every test in this
  // file green. A test whose two candidate rules give the same answer
  // pins neither of them.
  it("breaks a same-day tie on the received date, not on the label", () => {
    const notHeld = rev({ label: "Bulletin 5", issuedOn: "2026-08-20" });
    const held = rev({ label: "Bulletin 4", issuedOn: "2026-08-20", receivedOn: "2026-08-25" });
    expect(currentRevision([notHeld, held])?.label).toBe("Bulletin 4");
    expect(currentRevision([held, notHeld])?.label).toBe("Bulletin 4");
  });
});

describe("byNewestFirst", () => {
  it("does not mutate the array it is given", () => {
    const input = [rev({ label: "A", issuedOn: "2026-08-01" }), rev({ label: "B", issuedOn: "2026-08-20" })];
    const before = input.map((r) => r.label);
    byNewestFirst(input);
    expect(input.map((r) => r.label)).toEqual(before);
  });

  it("orders newest issue first", () => {
    const out = byNewestFirst([
      rev({ label: "Rev 1", issuedOn: "2026-08-01" }),
      rev({ label: "Rev 3", issuedOn: "2026-08-20" }),
      rev({ label: "Rev 2", issuedOn: "2026-08-10" }),
    ]);
    expect(out.map((r) => r.label)).toEqual(["Rev 3", "Rev 2", "Rev 1"]);
  });
});

describe("unreceivedRevisions", () => {
  it("is empty when everything issued is in hand", () => {
    expect(
      unreceivedRevisions([rev({ label: "Rev 1", issuedOn: "2026-08-01", receivedOn: "2026-08-03" })]),
    ).toEqual([]);
  });

  it("lists every issue that never reached us, newest first", () => {
    const out = unreceivedRevisions([
      rev({ label: "Rev 1", issuedOn: "2026-08-01", receivedOn: "2026-08-03" }),
      rev({ label: "Rev 2", issuedOn: "2026-08-10" }),
      rev({ label: "Rev 3", issuedOn: "2026-08-20" }),
    ]);
    expect(out.map((r) => r.label)).toEqual(["Rev 3", "Rev 2"]);
  });
});

describe("setState", () => {
  it("is EMPTY with no revisions", () => {
    expect(setState([])).toBe("EMPTY");
  });

  it("is CURRENT_IN_HAND when the newest issue has been received", () => {
    expect(
      setState([rev({ label: "Rev 2", issuedOn: "2026-08-10", receivedOn: "2026-08-12" })]),
    ).toBe("CURRENT_IN_HAND");
  });

  it("is BEHIND when the newest issue has not been received", () => {
    expect(
      setState([
        rev({ label: "Rev 1", issuedOn: "2026-08-01", receivedOn: "2026-08-02" }),
        rev({ label: "Rev 2", issuedOn: "2026-08-10" }),
      ]),
    ).toBe("BEHIND");
  });

  // Holding an older revision is not the same as being up to date, and
  // this is the case most likely to be got wrong by a naive "do we have
  // any received revisions" check.
  it("is BEHIND even when older revisions are all in hand", () => {
    expect(
      setState([
        rev({ label: "Rev 1", issuedOn: "2026-08-01", receivedOn: "2026-08-02" }),
        rev({ label: "Rev 2", issuedOn: "2026-08-05", receivedOn: "2026-08-06" }),
        rev({ label: "Rev 3", issuedOn: "2026-08-20" }),
      ]),
    ).toBe("BEHIND");
  });

  // "Current set in hand" is a claim about the whole newest issue, and an
  // architect issuing two bulletins on one day is ordinary. The tiebreak
  // in byNewestFirst prefers the revision already held — correct for
  // "which sheet is current", wrong as evidence that nothing is missing —
  // so this read CURRENT_IN_HAND while a sheet of equal authority had
  // never arrived, on the same screen that listed it as not received.
  it("is BEHIND when a revision issued the same day never arrived", () => {
    expect(
      setState([
        rev({ label: "Bulletin 4", issuedOn: "2026-08-20", receivedOn: "2026-08-25" }),
        rev({ label: "Bulletin 5", issuedOn: "2026-08-20" }),
      ]),
    ).toBe("BEHIND");
    // Order must not change the answer either.
    expect(
      setState([
        rev({ label: "Bulletin 5", issuedOn: "2026-08-20" }),
        rev({ label: "Bulletin 4", issuedOn: "2026-08-20", receivedOn: "2026-08-25" }),
      ]),
    ).toBe("BEHIND");
  });

  it("is CURRENT_IN_HAND when every revision of the newest issue arrived", () => {
    expect(
      setState([
        rev({ label: "Bulletin 4", issuedOn: "2026-08-20", receivedOn: "2026-08-25" }),
        rev({ label: "Bulletin 5", issuedOn: "2026-08-20", receivedOn: "2026-08-26" }),
        // An older one never received does not make the CURRENT set
        // missing — it is superseded, and unreceivedRevisions still lists it.
        rev({ label: "Rev 1", issuedOn: "2026-08-01" }),
      ]),
    ).toBe("CURRENT_IN_HAND");
  });

  it("labels every state", () => {
    expect(stateLabel("EMPTY")).toBe("Nothing issued yet");
    expect(stateLabel("CURRENT_IN_HAND")).toBe("Current set in hand");
    expect(stateLabel("BEHIND")).toBe("Newest issue not received");
  });
});

describe("daysToReachUs", () => {
  const TODAY = "2026-08-28";

  it("counts issue to receipt when it arrived", () => {
    expect(
      daysToReachUs(rev({ label: "Rev 1", issuedOn: "2026-08-01", receivedOn: "2026-08-11" }), TODAY),
    ).toBe(10);
  });

  it("counts issue to today while it is still outstanding", () => {
    expect(daysToReachUs(rev({ label: "Rev 2", issuedOn: "2026-08-20" }), TODAY)).toBe(8);
  });

  // A revision dated in the future (an architect post-dating a title
  // block is real) must not render as a negative wait.
  it("is null rather than negative when the issue date is in the future", () => {
    expect(daysToReachUs(rev({ label: "Rev 9", issuedOn: "2026-09-15" }), TODAY)).toBeNull();
  });

  it("is 0 for a same-day delivery, not null", () => {
    expect(
      daysToReachUs(rev({ label: "Rev 1", issuedOn: "2026-08-20", receivedOn: "2026-08-20" }), TODAY),
    ).toBe(0);
  });
});

describe("daysBetween", () => {
  it("counts whole days across month boundaries", () => {
    expect(daysBetween("2026-08-30", "2026-09-02")).toBe(3);
  });

  it("is unaffected by a daylight-saving change", () => {
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
  });
});
