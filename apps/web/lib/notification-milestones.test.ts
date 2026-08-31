import { describe, expect, it } from "vitest";
import type { Renewal, RenewalKind } from "@/lib/compliance-expiry";
import {
  type DueNotice,
  digestSubject,
  dispatchKey,
  keysConsumed,
  milestoneLabel,
  milestonesFor,
  noticesDue,
} from "@/lib/notification-milestones";

let seq = 0;
function renewal(partial: Partial<Renewal> = {}): Renewal {
  seq += 1;
  return {
    id: `r${seq}`,
    kind: "COMPLIANCE_DOCUMENT" as RenewalKind,
    title: "General liability COI",
    detail: "Western Mutual",
    date: "2026-10-01",
    expectsDate: true,
    urgency: "DUE_SOON",
    daysUntil: 30,
    disagreement: null,
    ...partial,
  };
}

const sent = (...keys: string[]) => new Set(keys);

describe("milestonesFor", () => {
  it("anchors on the kind's own horizon", () => {
    // A licence goes through a state board; a COI is a phone call.
    expect(milestonesFor("LICENSE")).toEqual([60, 7, 0]);
    expect(milestonesFor("COMPLIANCE_DOCUMENT")).toEqual([30, 7, 0]);
    expect(milestonesFor("BOND")).toEqual([60, 7, 0]);
    expect(milestonesFor("INSURANCE_POLICY")).toEqual([30, 7, 0]);
  });

  it("is three rungs, not a fortnightly nag", () => {
    for (const kind of ["LICENSE", "COMPLIANCE_DOCUMENT", "BOND", "INSURANCE_POLICY"] as const) {
      expect(milestonesFor(kind).length).toBeLessThanOrEqual(3);
    }
  });

  it("never offers a negative rung", () => {
    expect(milestonesFor("LICENSE").every((d) => d >= 0)).toBe(true);
  });
});

describe("dispatchKey", () => {
  it("identifies a notice by record and rung, never by date", () => {
    // Keyed on the day sent, every notice would fire again tomorrow.
    expect(dispatchKey("r1", "LICENSE", 7)).toBe("LICENSE:r1:7");
    expect(dispatchKey("r1", "LICENSE", 7)).toBe(dispatchKey("r1", "LICENSE", 7));
  });

  it("keeps rungs on one record distinct", () => {
    expect(dispatchKey("r1", "LICENSE", 60)).not.toBe(dispatchKey("r1", "LICENSE", 7));
  });

  it("keeps the same id under different kinds distinct", () => {
    expect(dispatchKey("1", "LICENSE", 7)).not.toBe(dispatchKey("1", "BOND", 7));
  });
});

describe("noticesDue", () => {
  it("fires when a rung is reached", () => {
    const due = noticesDue([renewal({ daysUntil: 30 })], sent());
    expect(due).toHaveLength(1);
    expect(due[0].milestone).toBe(30);
  });

  it("says nothing on a day no rung is crossed", () => {
    expect(noticesDue([renewal({ daysUntil: 45 })], sent())).toEqual([]);
  });

  it("SAYS NOTHING THE NEXT DAY — the whole point", () => {
    // Day one: the 30-day rung fires. Day two, at 29 days, the state is
    // still true and there must be silence.
    const r = renewal({ id: "coi", daysUntil: 30 });
    const first = noticesDue([r], sent());
    expect(first).toHaveLength(1);

    const recorded = sent(...keysConsumed(first[0]));
    expect(noticesDue([{ ...r, daysUntil: 29 }], recorded)).toEqual([]);
    expect(noticesDue([{ ...r, daysUntil: 20 }], recorded)).toEqual([]);
    expect(noticesDue([{ ...r, daysUntil: 8 }], recorded)).toEqual([]);
  });

  it("fires again at the next rung down, and only there", () => {
    const r = renewal({ id: "coi", daysUntil: 30 });
    const recorded = sent(...keysConsumed(noticesDue([r], sent())[0]));
    const atSeven = noticesDue([{ ...r, daysUntil: 7 }], recorded);
    expect(atSeven).toHaveLength(1);
    expect(atSeven[0].milestone).toBe(7);
  });

  it("gives a LATE-ADDED record its notice instead of silence", () => {
    // Added five days before it lapses. The 30-day rung passed while nobody
    // had told us the document existed. Silence here would miss exactly the
    // one nobody was watching.
    const due = noticesDue([renewal({ daysUntil: 5 })], sent());
    expect(due).toHaveLength(1);
    expect(due[0].milestone).toBe(7);
  });

  it("sends ONE notice when several rungs are crossed at once, not three", () => {
    const due = noticesDue([renewal({ kind: "LICENSE", daysUntil: 5 })], sent());
    expect(due).toHaveLength(1);
    expect(due[0].milestone).toBe(7);
    expect(due[0].alsoSpent).toEqual([60]);
  });

  it("burns the passed rungs so they can't fire behind it", () => {
    const r = renewal({ id: "lic", kind: "LICENSE", daysUntil: 5 });
    const recorded = sent(...keysConsumed(noticesDue([r], sent())[0]));
    // The 60-day rung must never fire later for this record.
    expect(recorded.has(dispatchKey("lic", "LICENSE", 60))).toBe(true);
    expect(noticesDue([{ ...r, daysUntil: 3 }], recorded)).toEqual([]);
  });

  it("still fires the expiry rung after the 7-day one", () => {
    const r = renewal({ id: "coi", daysUntil: 7 });
    const recorded = sent(...keysConsumed(noticesDue([r], sent())[0]));
    const expired = noticesDue([{ ...r, daysUntil: -1, urgency: "EXPIRED" }], recorded);
    expect(expired).toHaveLength(1);
    expect(expired[0].milestone).toBe(0);
  });

  it("does not nag once something has been reported expired", () => {
    const r = renewal({ id: "coi", daysUntil: -1, urgency: "EXPIRED" });
    const recorded = sent(...keysConsumed(noticesDue([r], sent())[0]));
    expect(noticesDue([{ ...r, daysUntil: -30 }], recorded)).toEqual([]);
  });

  it("never notifies about an undated record", () => {
    // renewalAlerts surfaces these and should. But there is no date to
    // cross a rung, and an alert with no date is one nobody can act on.
    const due = noticesDue(
      [renewal({ daysUntil: null, date: null, urgency: "UNDATED" })],
      sent(),
    );
    expect(due).toEqual([]);
  });

  it("puts the most urgent first", () => {
    const soon = renewal({ id: "a", title: "COI", daysUntil: 30 });
    const gone = renewal({ id: "b", title: "Licence", kind: "LICENSE", daysUntil: -3 });
    expect(noticesDue([soon, gone], sent()).map((n) => n.milestone)).toEqual([0, 30]);
  });

  it("is empty with nothing to report, so a quiet day sends nothing", () => {
    expect(noticesDue([], sent())).toEqual([]);
  });
});

describe("keysConsumed", () => {
  it("returns the rung that fired plus every one it passed", () => {
    const notice = noticesDue([renewal({ id: "x", kind: "LICENSE", daysUntil: 2 })], sent())[0];
    expect(keysConsumed(notice).sort()).toEqual(["LICENSE:x:60", "LICENSE:x:7"].sort());
  });

  it("returns just the one rung when only one was crossed", () => {
    const notice = noticesDue([renewal({ id: "y", daysUntil: 30 })], sent())[0];
    expect(keysConsumed(notice)).toEqual(["COMPLIANCE_DOCUMENT:y:30"]);
  });
});

describe("digestSubject", () => {
  const notice = (over: Partial<Renewal>, milestone: number): DueNotice => ({
    renewal: renewal(over),
    milestone,
    alsoSpent: [],
  });

  it("leads with the expired count when anything has lapsed", () => {
    const s = digestSubject([notice({ daysUntil: -2 }, 0), notice({ daysUntil: 30 }, 30)]);
    expect(s).toContain("1 expired");
  });

  it("names the single item when there is only one", () => {
    const s = digestSubject([notice({ title: "CA licence", daysUntil: 30 }, 30)]);
    expect(s).toContain("CA licence");
    expect(s).toContain("30");
  });

  it("is empty when there is nothing to send", () => {
    expect(digestSubject([])).toBe("");
  });
});

describe("milestoneLabel", () => {
  it("calls the zero rung expired rather than '0 days out'", () => {
    expect(milestoneLabel(0)).toBe("expired");
    expect(milestoneLabel(7)).toBe("7 days out");
  });
});
