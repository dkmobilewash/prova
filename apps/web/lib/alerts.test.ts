import { describe, expect, it } from "vitest";
import {
  ALERT_CAPABILITY,
  ALERT_HORIZON_DAYS,
  CLOSEOUT_CHASE_DAYS,
  alertKey,
  apprenticeRatioAlerts,
  backchargeAlerts,
  certifiedPayrollAlerts,
  closeoutAlerts,
  contactFollowUpAlerts,
  factDigest,
  partitionAlerts,
  rankAlerts,
  renewalAlert,
  retainageAlerts,
  summarizeAlerts,
  visibleToPrincipal,
  wipAlerts,
  type Alert,
} from "./alerts";
import { classifyRenewal, type RenewalSource } from "./compliance-expiry";

const TODAY = "2026-09-01";

describe("alertKey", () => {
  it("includes the fact that would change what the alert says", () => {
    // This is the whole mechanism. Keyed on the licence alone, a dismissal
    // would silence that licence forever, including the next expiry.
    expect(alertKey("RENEWAL", "lic_1", "2026-11-30")).toBe("RENEWAL:lic_1:2026-11-30");
    expect(alertKey("RENEWAL", "lic_1", "2026-11-30")).not.toBe(
      alertKey("RENEWAL", "lic_1", "2027-11-30"),
    );
  });
});

describe("renewalAlert", () => {
  const source: RenewalSource = {
    id: "lic_1",
    kind: "LICENSE",
    title: "California C-9",
    detail: "State of California",
    date: "2026-08-20",
    expectsDate: true,
    href: "/settings",
  };

  it("carries the expiry decision from compliance-expiry rather than redeciding it", () => {
    const alert = renewalAlert(classifyRenewal(source, TODAY));
    expect(alert.severity).toBe("OVERDUE");
    expect(alert.dueOn).toBe("2026-08-20");
    expect(alert.daysUntil).toBe(-12);
    expect(alert.key).toBe("RENEWAL:lic_1:2026-08-20");
  });

  it("keys an undated record so that dating it clears the dismissal", () => {
    const alert = renewalAlert(
      classifyRenewal({ ...source, date: null, expectsDate: true }, TODAY),
    );
    expect(alert.key).toBe("RENEWAL:lic_1:undated");
  });

  it("uses the licence's 60-day horizon, not a global one", () => {
    // 45 days out is inside a licence's runway and outside a COI's.
    const soon = renewalAlert(classifyRenewal({ ...source, date: "2026-10-16" }, TODAY));
    expect(soon.severity).toBe("DUE_SOON");
    const coi = renewalAlert(
      classifyRenewal(
        { ...source, id: "coi_1", kind: "COMPLIANCE_DOCUMENT", date: "2026-10-16" },
        TODAY,
      ),
    );
    expect(coi.severity).toBe("STANDING");
  });
});

describe("contactFollowUpAlerts", () => {
  const followUp = {
    interactionId: "int_1",
    contactId: "contact_1",
    contactName: "Ferrante Construction",
    followUpOn: "2026-08-25",
    assignedToName: "Jane" as string | null,
  };

  it("raises an overdue follow-up naming who it's assigned to", () => {
    const [alert] = contactFollowUpAlerts([followUp], TODAY);
    expect(alert.severity).toBe("OVERDUE");
    expect(alert.title).toBe("Follow up with Ferrante Construction");
    expect(alert.detail).toBe("Was due 7 days ago. Assigned to Jane.");
    expect(alert.href).toBe("/contacts/contact_1");
    expect(alert.key).toBe("CONTACT_FOLLOW_UP:int_1:2026-08-25");
    expect(alert.amount).toBeNull();
  });

  it("omits the assignment sentence when nobody is assigned", () => {
    const [alert] = contactFollowUpAlerts([{ ...followUp, assignedToName: null }], TODAY);
    expect(alert.detail).toBe("Was due 7 days ago.");
  });

  it("warns inside the 7-day floor and stays quiet outside it", () => {
    const horizon = ALERT_HORIZON_DAYS.CONTACT_FOLLOW_UP as number;
    expect(horizon).toBeGreaterThanOrEqual(7);
    expect(
      contactFollowUpAlerts([{ ...followUp, followUpOn: "2026-09-08" }], TODAY)[0].severity,
    ).toBe("DUE_SOON");
    expect(contactFollowUpAlerts([{ ...followUp, followUpOn: "2026-09-20" }], TODAY)).toEqual([]);
  });

  it("rekeys when the follow-up is rescheduled, so an old dismissal lapses", () => {
    const original = contactFollowUpAlerts([followUp], TODAY)[0].key;
    const rescheduled = contactFollowUpAlerts([{ ...followUp, followUpOn: "2026-09-05" }], TODAY)[0].key;
    expect(original).not.toBe(rescheduled);
  });
});

describe("backchargeAlerts", () => {
  const bc = {
    id: "bc_1",
    number: 3,
    jobName: "Mercy Tower",
    status: "RECEIVED",
    claimedAmount: 4200,
    respondByDate: "2026-08-25",
  };

  it("raises an overdue objection deadline with the money on it", () => {
    const [alert] = backchargeAlerts([bc], TODAY);
    expect(alert.severity).toBe("OVERDUE");
    expect(alert.amount).toBe(4200);
    expect(alert.detail).toContain("7 days ago");
    expect(alert.key).toBe("BACKCHARGE_RESPONSE:bc_1:2026-08-25");
  });

  it("warns inside the horizon and stays quiet outside it", () => {
    const horizon = ALERT_HORIZON_DAYS.BACKCHARGE_RESPONSE as number;
    expect(backchargeAlerts([{ ...bc, respondByDate: "2026-09-08" }], TODAY)[0].severity).toBe(
      "DUE_SOON",
    );
    expect(horizon).toBe(10);
    expect(backchargeAlerts([{ ...bc, respondByDate: "2026-10-01" }], TODAY)).toEqual([]);
  });

  it("goes quiet the moment we have answered, however we answered", () => {
    // A late objection is still an objection. Continuing to shout about it
    // buries the ones nobody has touched.
    for (const status of ["DISPUTED", "ACCEPTED", "SETTLED", "WITHDRAWN"]) {
      expect(backchargeAlerts([{ ...bc, status }], TODAY)).toEqual([]);
    }
  });

  it("raises nothing when no deadline was recorded", () => {
    // Not recorded is not the same as no deadline, and inventing a
    // contractual date is the one thing this must never do.
    expect(backchargeAlerts([{ ...bc, respondByDate: null }], TODAY)).toEqual([]);
  });
});

describe("retainageAlerts", () => {
  const job = {
    jobId: "job_1",
    jobName: "Mercy Tower",
    balance: 13420,
    closeoutAcceptedOn: null as string | null,
    substantialCompletionDate: null as string | null,
  };

  it("asserts money is collectable only on an accepted closeout package", () => {
    const [alert] = retainageAlerts([{ ...job, closeoutAcceptedOn: "2026-08-15" }], TODAY);
    expect(alert.severity).toBe("OVERDUE");
    expect(alert.amount).toBe(13420);
    expect(alert.detail).toContain("accepted the closeout package");
  });

  it("hedges when the only evidence is a forecast date", () => {
    // Job.substantialCompletionDate records when a job is EXPECTED to
    // reach substantial completion, not that it did. lib/retainage.ts
    // learned that the hard way; asserting money is owed off it would be
    // wrong in front of a GC.
    const [alert] = retainageAlerts([{ ...job, substantialCompletionDate: "2026-08-01" }], TODAY);
    expect(alert.severity).toBe("STANDING");
    expect(alert.detail).toContain("nothing here records that it did");
  });

  it("prefers the accepted package over the forecast when both exist", () => {
    const alerts = retainageAlerts(
      [{ ...job, closeoutAcceptedOn: "2026-08-15", substantialCompletionDate: "2026-08-01" }],
      TODAY,
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("OVERDUE");
  });

  it("says nothing about a forecast date still in the future", () => {
    expect(retainageAlerts([{ ...job, substantialCompletionDate: "2026-12-01" }], TODAY)).toEqual([]);
  });

  it("says nothing when there is no money held", () => {
    expect(
      retainageAlerts([{ ...job, balance: 0, closeoutAcceptedOn: "2026-08-15" }], TODAY),
    ).toEqual([]);
  });
});

describe("closeoutAlerts", () => {
  const job = { jobId: "job_1", jobName: "Mercy Tower", submittedOn: "2026-08-01", retainageBalance: 13420 };

  it("chases a package the GC has sat on", () => {
    const [alert] = closeoutAlerts([job], TODAY);
    expect(alert.detail).toContain("31 days ago");
    expect(alert.severity).toBe("STANDING");
    expect(alert.amount).toBe(13420);
  });

  it("stays quiet inside the chase threshold", () => {
    expect(CLOSEOUT_CHASE_DAYS).toBe(21);
    expect(closeoutAlerts([{ ...job, submittedOn: "2026-08-20" }], TODAY)).toEqual([]);
  });

  it("carries no money figure when none is held", () => {
    expect(closeoutAlerts([{ ...job, retainageBalance: 0 }], TODAY)[0].amount).toBeNull();
  });
});

describe("certifiedPayrollAlerts", () => {
  const week = {
    jobId: "job_1",
    jobName: "Mercy Tower",
    weekStart: "2026-08-17",
    weekEnd: "2026-08-23",
  };

  it("is overdue once the filing window after the week has passed", () => {
    const [alert] = certifiedPayrollAlerts([week], TODAY);
    expect(alert.severity).toBe("OVERDUE");
    // Week ended 23 Aug, 7-day window, so due 30 Aug — two days ago.
    expect(alert.dueOn).toBe("2026-08-30");
    expect(alert.daysUntil).toBe(-2);
    expect(alert.key).toBe("CERTIFIED_PAYROLL:job_1:2026-08-17");
  });

  it("does not chase a week that is still running", () => {
    // The report covers a closed week. Being told off on the Wednesday for
    // not having filed Friday's payroll is how a list gets ignored.
    expect(
      certifiedPayrollAlerts(
        [{ ...week, weekStart: "2026-08-31", weekEnd: "2026-09-06" }],
        TODAY,
      ),
    ).toEqual([]);
  });

  it("uses the jurisdiction's own filing window when one has been recorded", () => {
    // A rule set attached to the job's wage determination replaces the
    // generic horizon. 23 Aug + 10 days is 2 Sep, still ahead of us.
    const [alert] = certifiedPayrollAlerts([{ ...week, filingDueDays: 10 }], TODAY);
    expect(alert.dueOn).toBe("2026-09-02");
    expect(alert.severity).toBe("DUE_SOON");
  });

  it("says which window it used, because the two are different claims", () => {
    // "Due in 7 days" from a citation and "due in 7 days" from our own
    // default are not the same statement, and a payroll clerk acting on
    // one should be able to tell it from the other.
    const [generic] = certifiedPayrollAlerts([week], TODAY);
    expect(generic.detail).toContain("the usual filing window");

    const [recorded] = certifiedPayrollAlerts([{ ...week, filingDueDays: 3 }], TODAY);
    expect(recorded.detail).toContain("this jurisdiction's filing window");
  });

  it("falls back to the generic horizon when no rule set is attached", () => {
    const [alert] = certifiedPayrollAlerts([{ ...week, filingDueDays: null }], TODAY);
    expect(alert.dueOn).toBe("2026-08-30");
  });

  it("is merely due, not overdue, inside the filing window", () => {
    const [alert] = certifiedPayrollAlerts(
      [{ ...week, weekStart: "2026-08-24", weekEnd: "2026-08-30" }],
      TODAY,
    );
    expect(alert.severity).toBe("DUE_SOON");
    expect(alert.dueOn).toBe("2026-09-06");
  });
});

describe("wipAlerts", () => {
  it("raises a standing condition with no date attached", () => {
    const [alert] = wipAlerts([{ jobId: "job_1", jobName: "Mercy Tower", overrun: 18000 }]);
    // Not OVERDUE. It is true today and will be true tomorrow; escalating
    // it with the calendar would invent urgency the data does not have.
    expect(alert.severity).toBe("STANDING");
    expect(alert.dueOn).toBeNull();
    expect(alert.daysUntil).toBeNull();
    expect(alert.amount).toBe(18000);
  });

  it("says nothing about a job forecast under its contract value", () => {
    expect(wipAlerts([{ jobId: "job_1", jobName: "Mercy Tower", overrun: -5000 }])).toEqual([]);
    expect(wipAlerts([{ jobId: "job_1", jobName: "Mercy Tower", overrun: 0 }])).toEqual([]);
  });
});

describe("rankAlerts", () => {
  const alert = (over: Partial<Alert>): Alert => ({
    key: over.key ?? "k",
    kind: "RENEWAL",
    severity: "STANDING",
    title: "t",
    detail: "d",
    href: "/",
    dueOn: null,
    daysUntil: null,
    amount: null,
    ...over,
  });

  it("puts overdue above due-soon above standing", () => {
    const ranked = rankAlerts([
      alert({ key: "c", severity: "STANDING" }),
      alert({ key: "a", severity: "OVERDUE" }),
      alert({ key: "b", severity: "DUE_SOON" }),
    ]);
    expect(ranked.map((a) => a.key)).toEqual(["a", "b", "c"]);
  });

  it("puts the most money first within a severity", () => {
    // Two overdue things are not equally urgent when one holds up $42,000
    // and the other a $400 cleanup charge.
    const ranked = rankAlerts([
      alert({ key: "small", severity: "OVERDUE", amount: 400, daysUntil: -30 }),
      alert({ key: "big", severity: "OVERDUE", amount: 42000, daysUntil: -2 }),
    ]);
    expect(ranked.map((a) => a.key)).toEqual(["big", "small"]);
  });

  it("falls back to soonest when no money is named", () => {
    const ranked = rankAlerts([
      alert({ key: "later", severity: "DUE_SOON", daysUntil: 9 }),
      alert({ key: "sooner", severity: "DUE_SOON", daysUntil: 2 }),
    ]);
    expect(ranked.map((a) => a.key)).toEqual(["sooner", "later"]);
  });
});

describe("partitionAlerts", () => {
  const one: Alert = {
    key: "RENEWAL:lic_1:2026-11-30",
    kind: "RENEWAL",
    severity: "DUE_SOON",
    title: "California C-9",
    detail: "due in 90 days",
    href: "/settings",
    dueOn: "2026-11-30",
    daysUntil: 90,
    amount: null,
  };

  it("hides a dismissed alert but keeps it visible as dismissed", () => {
    // A silenced alert that vanishes entirely is indistinguishable from
    // one that got fixed.
    const { visible, silenced } = partitionAlerts(
      [one],
      [{ alertKey: one.key, snoozedUntil: null, acknowledgedSeverity: "DUE_SOON" }],
      TODAY,
    );
    expect(visible).toEqual([]);
    expect(silenced.map((a) => a.key)).toEqual([one.key]);
  });

  it("brings back a snooze whose date has passed", () => {
    const { visible } = partitionAlerts(
      [one],
      [{ alertKey: one.key, snoozedUntil: "2026-08-20", acknowledgedSeverity: "DUE_SOON" }],
      TODAY,
    );
    expect(visible.map((a) => a.key)).toEqual([one.key]);
  });

  it("keeps a snooze quiet until its date", () => {
    const { silenced } = partitionAlerts(
      [one],
      [{ alertKey: one.key, snoozedUntil: "2026-09-15", acknowledgedSeverity: "DUE_SOON" }],
      TODAY,
    );
    expect(silenced.map((a) => a.key)).toEqual([one.key]);
  });

  it("does not let a dismissal silence the NEXT situation on the same record", () => {
    // The licence was renewed, so the key moved. This is the reason keys
    // carry the fact, and it needs no expiry logic of its own.
    const renewed: Alert = { ...one, key: "RENEWAL:lic_1:2027-11-30" };
    const { visible } = partitionAlerts(
      [renewed],
      [{ alertKey: one.key, snoozedUntil: null, acknowledgedSeverity: "DUE_SOON" }],
      TODAY,
    );
    expect(visible.map((a) => a.key)).toEqual([renewed.key]);
  });

  // ---- issue #110: the severity half of the match ----
  //
  // The key alone cannot express these. `one` and `overdue` below are
  // byte-identical keys: same licence, same expiry date, different day.

  const overdue: Alert = { ...one, severity: "OVERDUE", detail: "expired", daysUntil: -3 };

  it("does NOT stay silent once the same alert escalates past what was seen", () => {
    // The whole of issue #110. Somebody said "seen it" at 90 days out;
    // that is not a statement about the licence having lapsed.
    const { visible, silenced } = partitionAlerts(
      [overdue],
      [{ alertKey: one.key, snoozedUntil: null, acknowledgedSeverity: "DUE_SOON" }],
      TODAY,
    );
    expect(visible.map((a) => a.key)).toEqual([overdue.key]);
    expect(silenced).toEqual([]);
  });

  it("stays silent when the alert gets BETTER than what was seen", () => {
    // A corrected date, not a met one. They already saw the worse version.
    const { visible, silenced } = partitionAlerts(
      [one],
      [{ alertKey: one.key, snoozedUntil: null, acknowledgedSeverity: "OVERDUE" }],
      TODAY,
    );
    expect(silenced.map((a) => a.key)).toEqual([one.key]);
    expect(visible).toEqual([]);
  });

  it("stays silent at exactly the severity that was seen", () => {
    // Equal is not worse. Guards the boundary the comparison turns on.
    const { silenced } = partitionAlerts(
      [one],
      [{ alertKey: one.key, snoozedUntil: null, acknowledgedSeverity: "DUE_SOON" }],
      TODAY,
    );
    expect(silenced.map((a) => a.key)).toEqual([one.key]);
  });

  it("reads a row written before the column existed as DUE_SOON, not as a wildcard", () => {
    // ACK_SEVERITY_WHEN_UNRECORDED. A legacy NULL silences what it was
    // almost certainly made about...
    const stillQuiet = partitionAlerts(
      [one],
      [{ alertKey: one.key, snoozedUntil: null, acknowledgedSeverity: null }],
      TODAY,
    );
    expect(stillQuiet.silenced.map((a) => a.key)).toEqual([one.key]);

    // ...and stops covering the same alert the day it lapses, which is the
    // half that makes NULL a fix for those rows rather than an amnesty.
    const backAgain = partitionAlerts(
      [overdue],
      [{ alertKey: one.key, snoozedUntil: null, acknowledgedSeverity: null }],
      TODAY,
    );
    expect(backAgain.visible.map((a) => a.key)).toEqual([overdue.key]);
  });
});

describe("summarizeAlerts", () => {
  it("counts by severity and sums only what carries a figure", () => {
    const summary = summarizeAlerts([
      ...backchargeAlerts(
        [
          {
            id: "bc_1",
            number: 3,
            jobName: "Mercy Tower",
            status: "RECEIVED",
            claimedAmount: 4200,
            respondByDate: "2026-08-25",
          },
        ],
        TODAY,
      ),
      ...wipAlerts([{ jobId: "job_1", jobName: "Mercy Tower", overrun: 18000 }]),
    ]);
    expect(summary.overdue).toBe(1);
    expect(summary.standing).toBe(1);
    expect(summary.total).toBe(2);
    expect(summary.amountNamed).toBe(22200);
  });
});

describe("visibleToPrincipal", () => {
  const holdsAll = () => true;
  const foreman = (capability: string) =>
    capability === "MANAGE_FIELD" || capability === "MANAGE_JOBS";

  const backcharge = backchargeAlerts(
    [
      {
        id: "bc_1",
        number: 3,
        jobName: "Mercy Tower",
        status: "RECEIVED",
        claimedAmount: 42000,
        respondByDate: "2026-08-25",
      },
    ],
    TODAY,
  );
  const closeout = closeoutAlerts(
    [{ jobId: "job_1", jobName: "Mercy Tower", submittedOn: "2026-08-01", retainageBalance: 13420 }],
    TODAY,
  );

  it("gives every kind a capability, with no gaps", () => {
    // A kind added without an entry here would fall through the filter as
    // undefined and be shown to everybody, which is the failure mode this
    // whole map exists to close.
    for (const alert of [...backcharge, ...closeout]) {
      expect(ALERT_CAPABILITY[alert.kind]).toBeTruthy();
    }
  });

  it("passes everything through for someone unrestricted", () => {
    expect(visibleToPrincipal([...backcharge, ...closeout], holdsAll)).toHaveLength(2);
  });

  it("keeps a $42,000 backcharge away from a foreman entirely", () => {
    // Not merely un-priced — a foreman has no business being told a
    // backcharge exists, and an alert is a summary of the thing it points
    // at, so it needs that thing's permission.
    const visible = visibleToPrincipal(backcharge, foreman);
    expect(visible).toEqual([]);
  });

  it("lets a foreman see the package is stuck, without the money on it", () => {
    const [alert] = visibleToPrincipal(closeout, foreman);
    expect(alert).toBeDefined();
    expect(alert.detail).toContain("31 days ago");
    // The stuck package is operational; what it holds up is a margin
    // conversation.
    expect(alert.amount).toBeNull();
  });

  it("keeps the figure for someone who may see billing", () => {
    const [alert] = visibleToPrincipal(closeout, (c) => c === "MANAGE_JOBS" || c === "MANAGE_BILLING");
    expect(alert.amount).toBe(13420);
  });
});

describe("apprenticeRatioAlerts key length (issue #111)", () => {
  // assertKeyShape() in lib/actions/alerts.ts is the gate every dismissal
  // passes through. It is not exported, so its two rules are restated
  // here rather than imported — a key is KIND:subject:fact, and no longer
  // than 200 characters.
  const MAX_KEY = 200;
  const shapeOk = (key: string) => {
    const parts = key.split(":");
    return key.length <= MAX_KEY && parts.length === 3 && parts.every((p) => p.length > 0);
  };

  // A real cuid, because the length of the subject is part of the budget.
  const jobId = "clx9k2m4p0001qw8h3n7v5t2r";
  const source = (offendingDates: string[]) => ({
    jobId,
    jobName: "Riverside Medical",
    unionLocalLabel: "Local 22",
    offendingDates,
    worstExcessHours: 6,
  });
  const days = (n: number) =>
    Array.from({ length: n }, (_, i) => `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`);

  it("survives a job that is over ratio on many days", () => {
    // The bug: the fact was the joined date list, which has no bound. At
    // ~11 characters a day plus a 25-character cuid, the key crossed 200
    // before the sixteenth day — so "Seen it" answered "That alert
    // reference is not one of ours" on exactly the jobs that were
    // persistently over ratio, and only on those.
    const [alert] = apprenticeRatioAlerts([source(days(20))]);
    expect(alert.key.length).toBeLessThanOrEqual(MAX_KEY);
    expect(shapeOk(alert.key)).toBe(true);
  });

  it("still lapses a dismissal when another day breaches", () => {
    // The property the fact carries, and the whole reason it is in the
    // key. A digest that lost this would silence the alert forever.
    const [before] = apprenticeRatioAlerts([source(days(20))]);
    const [after] = apprenticeRatioAlerts([source(days(21))]);
    expect(after.key).not.toEqual(before.key);
  });

  it("does not depend on the order the days arrive in", () => {
    // Ordering is the caller's, not part of the fact.
    const forwards = days(9);
    const [a] = apprenticeRatioAlerts([source(forwards)]);
    const [b] = apprenticeRatioAlerts([source([...forwards].reverse())]);
    expect(a.key).toEqual(b.key);
  });

  it("separates the days, so a regrouping is a different fact", () => {
    // Without a separator ["ab","c"] and ["a","bc"] digest identically.
    expect(factDigest(["ab", "c"])).not.toEqual(factDigest(["a", "bc"]));
  });
});
