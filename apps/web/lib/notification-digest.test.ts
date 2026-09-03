import { describe, expect, it } from "vitest";
import type { Alert } from "@/lib/alerts";
import {
  STANDING_RUNG,
  type DueNotice,
  type Rung,
} from "@/lib/notification-milestones";
import {
  digestBody,
  digestLines,
  digestSubject,
  rungLabel,
} from "@/lib/notification-digest";

function notice(
  over: Partial<Alert> & { key: string },
  rung: Rung = "week",
): DueNotice {
  return {
    alert: {
      kind: "RENEWAL",
      severity: "DUE_SOON",
      title: "General liability certificate",
      detail: "Northwind Insurance — due in 7 days",
      href: "/compliance",
      dueOn: "2026-11-30",
      daysUntil: 7,
      amount: null,
      ...over,
    },
    rung,
    alsoSpent: [],
  };
}

describe("rungLabel", () => {
  it("carries no number, because the horizon differs by kind", () => {
    // "Approaching" is sixty days for a licence and thirty for a COI.
    // Naming a number here would be wrong for one of them, and the exact
    // words are in alert.detail anyway.
    for (const rung of ["standing", "approaching", "week", "due"] as Rung[]) {
      expect(rungLabel(rung)).not.toMatch(/\d/);
    }
    expect(rungLabel("approaching")).toBe("Coming up");
    expect(rungLabel("week")).toBe("This week");
    expect(rungLabel("due")).toBe("Now due");
  });

  it("never claims a thing has expired", () => {
    // The rule this file exists to hold. "Expired" would be a claim about
    // the underlying record, and half the kinds this fires for are not
    // documents that can expire — a job over budget, a backcharge
    // unanswered, an apprentice ratio breached.
    for (const rung of ["standing", "approaching", "week", "due"] as Rung[]) {
      expect(rungLabel(rung).toLowerCase()).not.toContain("expire");
      expect(rungLabel(rung).toLowerCase()).not.toContain("lapsed");
    }
  });

  it("says something neutral for a condition with no deadline", () => {
    expect(rungLabel(STANDING_RUNG)).toBe("Needs attention");
  });
});

describe("digestSubject", () => {
  it("is empty for an empty run, so nothing is sent", () => {
    expect(digestSubject([])).toBe("");
  });

  it("names the single thing when there is only one", () => {
    expect(
      digestSubject([notice({ key: "a", title: "Contractor licence" })]),
    ).toBe("Contractor licence");
  });

  it("names the most urgent thing and counts the rest", () => {
    const subject = digestSubject([
      notice({ key: "a", title: "Contractor licence" }),
      notice({ key: "b", title: "General liability" }),
      notice({ key: "c", title: "Payment bond" }),
    ]);
    expect(subject).toBe("Contractor licence, and 2 others");
  });

  it("singularises one other", () => {
    expect(
      digestSubject([
        notice({ key: "a", title: "Licence" }),
        notice({ key: "b", title: "Bond" }),
      ]),
    ).toBe("Licence, and 1 other");
  });

  it("says how many have already passed their date", () => {
    const subject = digestSubject([
      notice(
        { key: "a", title: "Contractor licence", severity: "OVERDUE" },
        "due",
      ),
      notice(
        { key: "b", title: "General liability", severity: "OVERDUE" },
        "due",
      ),
      notice({ key: "c", title: "Payment bond" }),
    ]);
    expect(subject).toBe("Contractor licence, and 2 others (2 overdue)");
  });

  it("does not say overdue when nothing is", () => {
    expect(
      digestSubject([notice({ key: "a" }), notice({ key: "b" })]),
    ).not.toContain("overdue");
  });
});

describe("digestLines", () => {
  it("passes the engine's own words through, unedited", () => {
    // The rule: this module never composes a sentence about a situation.
    // An undated COI and a job over budget are both STANDING with no date,
    // and nothing in the Alert shape tells them apart — only the detail
    // the engine already wrote does.
    const undated = notice(
      {
        key: "RENEWAL:coi_9:undated",
        title: "Workers comp certificate",
        detail: "Northwind Insurance — no date recorded",
        dueOn: null,
        daysUntil: null,
        severity: "STANDING",
      },
      STANDING_RUNG,
    );

    const [line] = digestLines([undated]);
    expect(line.detail).toBe("Northwind Insurance — no date recorded");
    expect(line.title).toBe("Workers comp certificate");
  });

  it("carries the alert's own link, so the email lands on the fix", () => {
    const [line] = digestLines([
      notice({ key: "a", href: "/jobs/job_1#retainage" }),
    ]);
    expect(line.href).toBe("/jobs/job_1#retainage");
  });
});

describe("digestBody", () => {
  const one = notice({
    key: "a",
    title: "Contractor licence",
    detail: "State board — due in 7 days",
  });

  it("makes every link absolute", () => {
    const body = digestBody([one], "https://app.cstream.ai");
    expect(body).toContain("https://app.cstream.ai/compliance");
  });

  it("tolerates a base URL with a trailing slash", () => {
    // Two slashes in a link in an email somebody forwards to their GC.
    const body = digestBody([one], "https://app.cstream.ai/");
    expect(body).not.toContain("ai//compliance");
    expect(body).toContain("https://app.cstream.ai/compliance");
  });

  it("counts what is in it", () => {
    expect(digestBody([one], "https://x.test")).toContain(
      "One thing needs your attention",
    );
    expect(digestBody([one, notice({ key: "b" })], "https://x.test")).toContain(
      "2 things need your attention",
    );
  });

  it("says how to make it stop, and that it is not a list anyone maintains", () => {
    const body = digestBody([one], "https://x.test");
    expect(body).toContain("Dealing with the thing itself stops the reminders");
    expect(body).toContain("https://x.test/alerts");
  });

  it("contains no sentence this module invented about the record", () => {
    const body = digestBody(
      [
        notice(
          {
            key: "RENEWAL:coi_9:undated",
            title: "Workers comp certificate",
            detail: "Northwind Insurance — no date recorded",
            dueOn: null,
            daysUntil: null,
            severity: "STANDING",
          },
          STANDING_RUNG,
        ),
      ],
      "https://x.test",
    );
    expect(body.toLowerCase()).not.toContain("expired");
    expect(body).toContain("no date recorded");
  });
});
