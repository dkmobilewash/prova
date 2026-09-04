import { describe, expect, it } from "vitest";

import {
  countOverdue,
  followUpQueue,
  followUpStanding,
  lastContactOn,
  latestActivity,
  occurredBy,
  openFollowUp,
  summarizeLeadActivity,
  type LoggedActivity,
  type SalesActivityType,
} from "./sales-activity";

/** createdAt only ever matters for same-day ties, so it defaults to a
 * stamp derived from the day and is overridden only where a test is
 * actually about the tie. */
const TODAY = "2026-09-04";

function activity(
  id: string,
  type: SalesActivityType,
  occurredOn: string,
  followUpOn: string | null = null,
  createdAt?: string,
): LoggedActivity {
  return { id, type, occurredOn, followUpOn, createdAt: createdAt ?? `${occurredOn}T12:00:00.000Z` };
}

describe("lastContactOn", () => {
  it("is null when nothing is logged — not a date, and not zero", () => {
    expect(lastContactOn([], TODAY)).toBeNull();
  });

  it("ignores a NOTE, even when the note is the most recent thing on file", () => {
    // The failure this pins: a lead last actually called in January, with
    // a note typed in March. Counting the note reads as contact in March
    // and the lead looks warm while nobody has phoned it in two months.
    const activities = [
      activity("a", "CALL", "2026-01-10"),
      activity("b", "NOTE", "2026-03-01"),
    ];
    expect(lastContactOn(activities, TODAY)).toBe("2026-01-10");
  });

  it("is null when every activity is a NOTE", () => {
    expect(lastContactOn([activity("a", "NOTE", "2026-03-01")], TODAY)).toBeNull();
  });

  it("counts a call, an email, a demo and a meeting alike", () => {
    for (const type of ["CALL", "EMAIL", "DEMO", "MEETING"] as const) {
      expect(lastContactOn([activity("a", type, "2026-02-02")], TODAY)).toBe("2026-02-02");
    }
  });
});

describe("latestActivity", () => {
  it("takes the latest day regardless of the order given", () => {
    const activities = [
      activity("old", "CALL", "2026-01-01"),
      activity("new", "CALL", "2026-05-05"),
      activity("mid", "CALL", "2026-03-03"),
    ];
    expect(latestActivity(activities)?.id).toBe("new");
    expect(latestActivity([...activities].reverse())?.id).toBe("new");
  });

  it("breaks a same-day tie on the moment it was logged, latest wins", () => {
    const first = activity("first", "CALL", "2026-04-01", null, "2026-04-01T09:00:00.000Z");
    const second = activity("second", "CALL", "2026-04-01", null, "2026-04-01T17:30:00.000Z");
    expect(latestActivity([first, second])?.id).toBe("second");
    expect(latestActivity([second, first])?.id).toBe("second");
  });

  it("does not mutate the array it was given", () => {
    const activities = [activity("a", "CALL", "2026-01-01"), activity("b", "CALL", "2026-05-05")];
    latestActivity(activities);
    expect(activities.map((a) => a.id)).toEqual(["a", "b"]);
  });
});

describe("openFollowUp", () => {
  it("is null when nothing is logged", () => {
    expect(openFollowUp([], TODAY)).toBeNull();
  });

  it("reads the follow-up off the latest activity", () => {
    const activities = [
      activity("old", "CALL", "2026-01-10"),
      activity("new", "CALL", "2026-02-10", "2026-02-17"),
    ];
    expect(openFollowUp(activities, TODAY)).toEqual({ activityId: "new", dueOn: "2026-02-17" });
  });

  it("is null once a newer activity carries no follow-up — the old one is history", () => {
    // The failure this pins: an implementation that takes ANY followUpOn
    // on the lead. Here January's call promised a follow-up and February's
    // call is the follow-up, logged with nothing further owed. Anything
    // that still returns 2026-01-17 leaves the lead in the queue forever.
    const activities = [
      activity("old", "CALL", "2026-01-10", "2026-01-17"),
      activity("new", "CALL", "2026-02-10", null),
    ];
    expect(openFollowUp(activities, TODAY)).toBeNull();
  });

  it("is null when the superseding activity was logged later the same day", () => {
    const promised = activity("promised", "CALL", "2026-04-01", "2026-04-08", "2026-04-01T09:00:00.000Z");
    const settled = activity("settled", "EMAIL", "2026-04-01", null, "2026-04-01T17:30:00.000Z");
    expect(openFollowUp([promised, settled], TODAY)).toBeNull();
  });

  it("takes a NOTE as the latest activity — a note can carry a follow-up", () => {
    const activities = [
      activity("call", "CALL", "2026-02-10", "2026-02-17"),
      activity("note", "NOTE", "2026-02-12", "2026-03-01"),
    ];
    expect(openFollowUp(activities, TODAY)?.dueOn).toBe("2026-03-01");
  });
});

describe("an activity dated in the future", () => {
  // Found in the browser on 2026-09-04, not by this suite: a note dated
  // tomorrow silently emptied the follow-up queue and marked a real
  // outstanding email "since superseded" for a conversation that had not
  // happened. Supersession was never meant to reach forwards.
  const email = activity("email", "EMAIL", "2026-09-01", "2026-09-10");
  const futureNote = activity("note", "NOTE", "2026-09-05");

  it("does not supersede the follow-up a real activity is carrying", () => {
    expect(openFollowUp([email, futureNote], TODAY)).toEqual({
      activityId: "email",
      dueOn: "2026-09-10",
    });
  });

  it("does not count as contact, even when it is a call", () => {
    const futureCall = activity("call", "CALL", "2026-09-05");
    const realCall = activity("real", "CALL", "2026-08-30");
    expect(lastContactOn([realCall, futureCall], TODAY)).toBe("2026-08-30");
  });

  it("counts once the day arrives", () => {
    // The same two rows, read on the day the note is dated.
    expect(openFollowUp([email, futureNote], "2026-09-05")).toBeNull();
  });

  it("treats an activity dated TODAY as having happened", () => {
    const todayNote = activity("today", "NOTE", TODAY);
    expect(openFollowUp([email, todayNote], TODAY)).toBeNull();
  });

  it("is excluded by occurredBy, which is what the pages filter with", () => {
    expect(occurredBy([email, futureNote], TODAY).map((a) => a.id)).toEqual(["email"]);
  });
});

describe("followUpStanding", () => {
  it("counts a follow-up due today as due, not late", () => {
    expect(followUpStanding("2026-09-04", "2026-09-04")).toBe("DUE_TODAY");
  });

  it("is OVERDUE the day after", () => {
    expect(followUpStanding("2026-09-03", "2026-09-04")).toBe("OVERDUE");
  });

  it("is UPCOMING the day before", () => {
    expect(followUpStanding("2026-09-05", "2026-09-04")).toBe("UPCOMING");
  });
});

describe("summarizeLeadActivity", () => {
  const lead = (activities: LoggedActivity[]) => ({
    leadId: "lead-1",
    companyName: "Acme Drywall",
    activities,
  });

  it("reports nulls, not zeroes, for a lead nobody has logged anything on", () => {
    const summary = summarizeLeadActivity(lead([]), "2026-09-04");
    expect(summary.lastContactOn).toBeNull();
    expect(summary.daysSinceContact).toBeNull();
    expect(summary.followUpOn).toBeNull();
    expect(summary.followUpStanding).toBeNull();
    expect(summary.daysOverdue).toBeNull();
    expect(summary.activityCount).toBe(0);
  });

  it("distinguishes contacted-today from never-logged", () => {
    // Both would render as "0" if daysSinceContact defaulted to zero, and
    // one of them means the opposite of the other.
    const today = summarizeLeadActivity(lead([activity("a", "CALL", "2026-09-04")]), "2026-09-04");
    const never = summarizeLeadActivity(lead([]), "2026-09-04");
    expect(today.daysSinceContact).toBe(0);
    expect(never.daysSinceContact).toBeNull();
  });

  it("counts whole days since the last contact", () => {
    const summary = summarizeLeadActivity(lead([activity("a", "CALL", "2026-08-25")]), "2026-09-04");
    expect(summary.daysSinceContact).toBe(10);
  });

  it("reports daysOverdue as a positive number, and null when not overdue", () => {
    const late = summarizeLeadActivity(
      lead([activity("a", "CALL", "2026-08-20", "2026-08-28")]),
      "2026-09-04",
    );
    expect(late.followUpStanding).toBe("OVERDUE");
    expect(late.daysOverdue).toBe(7);

    const soon = summarizeLeadActivity(
      lead([activity("a", "CALL", "2026-09-01", "2026-09-10")]),
      "2026-09-04",
    );
    expect(soon.followUpStanding).toBe("UPCOMING");
    expect(soon.daysOverdue).toBeNull();
  });

  it("counts every activity, notes included", () => {
    const summary = summarizeLeadActivity(
      lead([activity("a", "CALL", "2026-01-01"), activity("b", "NOTE", "2026-01-02")]),
      "2026-09-04",
    );
    expect(summary.activityCount).toBe(2);
    expect(summary.lastContactOn).toBe("2026-01-01");
  });
});

describe("followUpQueue", () => {
  const sources = [
    {
      leadId: "later",
      companyName: "Later Framing",
      activities: [activity("a", "CALL", "2026-09-01", "2026-09-20")],
    },
    {
      leadId: "owes-nothing",
      companyName: "Settled Plaster",
      activities: [activity("b", "CALL", "2026-09-02", null)],
    },
    {
      leadId: "overdue",
      companyName: "Overdue EIFS",
      activities: [activity("c", "DEMO", "2026-08-01", "2026-08-15")],
    },
    { leadId: "silent", companyName: "Silent Ceilings", activities: [] },
  ];

  it("lists only the leads that owe something, soonest first", () => {
    const queue = followUpQueue(sources, "2026-09-04");
    expect(queue.map((row) => row.leadId)).toEqual(["overdue", "later"]);
  });

  it("counts the overdue ones", () => {
    expect(countOverdue(followUpQueue(sources, "2026-09-04"))).toBe(1);
  });

  it("is empty when nobody owes anything, rather than listing everyone", () => {
    const queue = followUpQueue(
      [
        { leadId: "a", companyName: "A", activities: [activity("x", "CALL", "2026-09-01")] },
        { leadId: "b", companyName: "B", activities: [] },
      ],
      "2026-09-04",
    );
    expect(queue).toEqual([]);
    expect(countOverdue(queue)).toBe(0);
  });

  it("breaks a same-date tie alphabetically so the order is stable", () => {
    const sameDay = [
      { leadId: "z", companyName: "Zenith", activities: [activity("a", "CALL", "2026-09-01", "2026-09-10")] },
      { leadId: "a", companyName: "Apex", activities: [activity("b", "CALL", "2026-09-01", "2026-09-10")] },
    ];
    expect(followUpQueue(sameDay, "2026-09-04").map((r) => r.leadId)).toEqual(["a", "z"]);
    expect(followUpQueue([...sameDay].reverse(), "2026-09-04").map((r) => r.leadId)).toEqual(["a", "z"]);
  });
});
