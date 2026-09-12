import { describe, expect, it } from "vitest";
import {
  alertsStatus,
  assistantStatus,
  closeoutStatus,
  count,
  drawingsStatus,
  listed,
  LISTED,
  materialOrdersStatus,
  messagesStatus,
  rfisStatus,
  safetyStatus,
  submittalsStatus,
} from "./status-sentences";

/**
 * The exact sentences, because #241's whole point is what the line SAYS:
 * quiet on a normal day, and when it speaks, which ones and how late.
 */

describe("the words", () => {
  it("pluralises by count", () => {
    expect(count(1, "order")).toBe("1 order");
    expect(count(2, "order")).toBe("2 orders");
    expect(count(0, "order")).toBe("0 orders");
    expect(count(1, "case")).toBe("1 case");
  });

  it(`lists up to ${LISTED} names, then says how many more`, () => {
    expect(listed(["A", "B"])).toBe("A, B");
    expect(listed(["A", "B", "C", "D"])).toBe("A, B, C, D");
    expect(listed(["A", "B", "C", "D", "E"])).toBe("A, B, C, D and 1 more");
    expect(listed(["A", "B", "C", "D", "E", "F"])).toBe("A, B, C, D and 2 more");
  });
});

describe("material orders", () => {
  it("is one quiet sentence with the old tiles' figures when nothing is late", () => {
    const report = materialOrdersStatus({ late: [], outstanding: 4, delivered: 12 });
    expect(report.problems).toEqual([]);
    expect(report.quiet).toBe("Nothing late. 4 orders outstanding, 12 delivered.");
  });

  it("says nothing is on order rather than 0 outstanding, 0 delivered", () => {
    expect(materialOrdersStatus({ late: [], outstanding: 0, delivered: 0 }).quiet).toBe("Nothing on order yet.");
  });

  it("names the late vendors, latest first, in red", () => {
    const report = materialOrdersStatus({
      late: [
        { vendorName: "ABC Supply", daysLate: 3 },
        { vendorName: "Tighties LLC", daysLate: 9 },
      ],
      outstanding: 2,
      delivered: 5,
    });
    expect(report.problems).toEqual([
      { tone: "red", text: "2 orders past the promised date — Tighties LLC (9 days), ABC Supply (3 days)." },
    ]);
  });

  it("says 1 day, not 1 days", () => {
    const report = materialOrdersStatus({ late: [{ vendorName: "X", daysLate: 1 }], outstanding: 1, delivered: 0 });
    expect(report.problems[0]?.text).toBe("1 order past the promised date — X (1 day).");
  });
});

describe("RFIs", () => {
  it("is quiet with the counts when nothing is overdue", () => {
    expect(rfisStatus({ overdue: [], open: 3, impact: 2 }).quiet).toBe(
      "3 RFIs awaiting an answer, none overdue. 2 answers with cost or schedule impact.",
    );
    expect(rfisStatus({ overdue: [], open: 0, impact: 0 }).quiet).toBe("No open RFIs.");
    expect(rfisStatus({ overdue: [], open: 1, impact: 0 }).quiet).toBe("1 RFI awaiting an answer, none overdue.");
  });

  it("names the overdue ones by number and job, most overdue first", () => {
    const report = rfisStatus({
      overdue: [
        { number: 9, jobName: "Main St", daysOverdue: 2 },
        { number: 12, jobName: "Riverside", daysOverdue: 6 },
      ],
      open: 4,
      impact: 0,
    });
    expect(report.problems).toEqual([
      { tone: "red", text: "2 RFIs past the date we asked for — #12 Riverside (6 days), #9 Main St (2 days)." },
    ]);
  });
});

describe("submittals", () => {
  it("is quiet when nothing waits on us", () => {
    expect(submittalsStatus({ revise: [], overdueWithGc: [], withGc: 2, approved: 5, total: 7 }).quiet).toBe(
      "2 with the GC, 5 approved, nothing waiting on us.",
    );
    expect(submittalsStatus({ revise: [], overdueWithGc: [], withGc: 0, approved: 0, total: 0 }).quiet).toBe(
      "No submittals yet.",
    );
  });

  it("raises amber for work in our court and for a GC past the due-back date, never red", () => {
    const report = submittalsStatus({
      revise: [{ number: 4, jobName: "Riverside" }],
      overdueWithGc: [{ number: 3, jobName: "Main St", daysOverdue: 5 }],
      withGc: 1,
      approved: 2,
      total: 4,
    });
    expect(report.problems).toEqual([
      { tone: "amber", text: "1 submittal back in our court to resubmit — #4 Riverside." },
      { tone: "amber", text: "1 submittal with the GC past the due-back date — #3 Main St (5 days)." },
    ]);
  });
});

describe("drawings", () => {
  it("is quiet when every set is current in hand", () => {
    expect(drawingsStatus({ behind: [], inHand: 3, total: 3 }).quiet).toBe("All 3 sets current and in hand.");
    expect(drawingsStatus({ behind: [], inHand: 2, total: 3 }).quiet).toBe("2 of 3 sets current and in hand, none behind.");
    expect(drawingsStatus({ behind: [], inHand: 0, total: 0 }).quiet).toBe("No drawing sets yet.");
  });

  it("names the sets being built from out-of-date paper, in red, most missing first", () => {
    const report = drawingsStatus({
      behind: [
        { name: "A-100", jobName: "Riverside", missing: 1 },
        { name: "S-200", jobName: "Main St", missing: 2 },
      ],
      inHand: 1,
      total: 3,
    });
    expect(report.problems).toEqual([
      {
        tone: "red",
        text: "2 sets being built from paper that is out of date — S-200 on Main St (2 issues not received), A-100 on Riverside (1 issue not received).",
      },
    ]);
  });
});

describe("messages", () => {
  it("is quiet with the delivery rate when nothing bounced", () => {
    expect(messagesStatus({ failed: [], unconfirmed: 0, sent: 10, rate: 90 }).quiet).toBe(
      "Nothing bounced. 90% of what went out is confirmed at the far end.",
    );
    expect(messagesStatus({ failed: [], unconfirmed: 0, sent: 2, rate: null }).quiet).toBe(
      "2 messages sent, nothing bounced, nothing confirmed yet.",
    );
    expect(messagesStatus({ failed: [], unconfirmed: 0, sent: 0, rate: null }).quiet).toBe("Nothing sent yet.");
  });

  it("names a bounce in red and counts the unconfirmed in amber", () => {
    const report = messagesStatus({
      failed: [{ to: "pm@gc.com", subject: "Pay app 3" }],
      unconfirmed: 3,
      sent: 8,
      rate: 60,
    });
    expect(report.problems).toEqual([
      { tone: "red", text: "1 message bounced, refused or flagged as spam — pm@gc.com (Pay app 3)." },
      { tone: "amber", text: "3 messages sent and never confirmed delivered." },
    ]);
  });
});

describe("safety", () => {
  it("never colours: a recordable case is a record, not a deadline", () => {
    const report = safetyStatus({ year: 2026, cases: 3, recordable: 1, daysAway: 1 });
    expect(report.problems).toEqual([]);
    expect(report.quiet).toBe("3 cases logged for 2026: 1 recordable on the 300 log, 1 with days away.");
    expect(safetyStatus({ year: 2026, cases: 0, recordable: 0, daysAway: 0 }).quiet).toBe("No cases logged for 2026.");
  });
});

describe("alerts", () => {
  it("is quiet when nothing is past due", () => {
    expect(alertsStatus({ overdue: 0, dueSoon: 0, standing: 2, amountNamed: "$12,000.00" }).quiet).toBe(
      "Nothing past due. 2 standing conditions with no date. Money named by these alerts: $12,000.00, not a balance.",
    );
    expect(alertsStatus({ overdue: 0, dueSoon: 0, standing: 0, amountNamed: null }).quiet).toBe(
      "Nothing needs attention.",
    );
  });

  it("is red for past due and amber for coming up", () => {
    expect(alertsStatus({ overdue: 3, dueSoon: 5, standing: 0, amountNamed: null }).problems).toEqual([
      { tone: "red", text: "3 alerts past due." },
      { tone: "amber", text: "5 alerts coming up." },
    ]);
  });
});

describe("closeout", () => {
  it("is quiet when nothing is outstanding", () => {
    const report = closeoutStatus({
      outstandingJobs: 0,
      outstandingItems: 0,
      readyToSubmit: 0,
      inWarranty: 4,
      openCallbacks: 0,
      retainage: null,
    });
    expect(report.problems).toEqual([]);
    expect(report.quiet).toBe("Nothing outstanding. 4 jobs still in warranty.");
  });

  it("puts an open callback in red and the outstanding packages in amber, with the money for those who may see it", () => {
    expect(
      closeoutStatus({
        outstandingJobs: 2,
        outstandingItems: 5,
        readyToSubmit: 1,
        inWarranty: 1,
        openCallbacks: 1,
        retainage: "$40,000.00",
      }).problems,
    ).toEqual([
      { tone: "red", text: "1 open callback." },
      { tone: "amber", text: "2 jobs with closeout outstanding, 5 items still owed, $40,000.00 of retainage behind it." },
      { tone: "amber", text: "1 package ready to send today." },
    ]);
  });

  it("leaves the money out for a viewer who may not see it", () => {
    const report = closeoutStatus({
      outstandingJobs: 1,
      outstandingItems: 0,
      readyToSubmit: 0,
      inWarranty: 0,
      openCallbacks: 0,
      retainage: null,
    });
    expect(report.problems).toEqual([{ tone: "amber", text: "1 job with closeout outstanding." }]);
  });
});

describe("assistant", () => {
  it("is a record of cards, never coloured", () => {
    expect(assistantStatus({ proposed: 5, done: 3, notDone: 1 })).toEqual({
      quiet: "5 cards in the last 30 days: 3 done, 1 refused by the app when tapped.",
      problems: [],
    });
    expect(assistantStatus({ proposed: 0, done: 0, notDone: 0 }).quiet).toBe("No cards in the last 30 days.");
  });
});
