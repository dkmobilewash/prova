import { describe, expect, it } from "vitest";
import {
  ALERT_CAPABILITY,
  ALERT_HORIZON_DAYS,
  CLOSEOUT_CHASE_DAYS,
  alertKey,
  amountBand,
  apprenticeRatioAlerts,
  backchargeAlerts,
  certifiedPayrollAlerts,
  closeoutAlerts,
  contactFollowUpAlerts,
  factDigest,
  moneyFact,
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
    // The deadline AND the money's band — see "money in an alert key".
    expect(alert.key).toBe(alertKey("BACKCHARGE_RESPONSE", "bc_1", "2026-08-25", moneyFact(4200)));
    expect(alert.key).toContain("2026-08-25");
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
    workIsFinished: false,
    hasCloseoutSubmission: false,
  };

  it("asserts money is collectable only on an accepted closeout package", () => {
    const [alert] = retainageAlerts([{ ...job, closeoutAcceptedOn: "2026-08-15" }], TODAY);
    expect(alert.severity).toBe("OVERDUE");
    expect(alert.amount).toBe(13420);
    expect(alert.detail).toContain("accepted the closeout package");
  });

  /**
   * Issue #109: this used to be OVERDUE the instant acceptance was
   * recorded, so it read "the GC accepted the closeout package 0 days ago
   * and this is still held" and then sorted ABOVE genuinely blown
   * deadlines, because rankAlerts breaks a severity tie on money and
   * retainage carries the biggest number in the app.
   */
  describe("the 14-day chasing threshold", () => {
    const accepted = { ...job, closeoutAcceptedOn: "2026-09-01" };

    it("does not call money accepted today overdue", () => {
      const [alert] = retainageAlerts([accepted], TODAY);
      expect(alert.severity).toBe("DUE_SOON");
      expect(alert.detail).toContain("0 days ago");
      // Never a deadline we were not told about.
      expect(alert.detail).toContain("not recorded here");
    });

    it("still says nothing about a deadline it does not know", () => {
      const [alert] = retainageAlerts([{ ...job, closeoutAcceptedOn: "2026-08-01" }], TODAY);
      expect(alert.severity).toBe("OVERDUE");
      expect(alert.detail).toContain("31 days ago");
      expect(alert.detail).toContain(`past the ${ALERT_HORIZON_DAYS.RETAINAGE_RELEASE} days`);
    });

    it("turns over exactly on the horizon, and reads it from the table", () => {
      const horizon = ALERT_HORIZON_DAYS.RETAINAGE_RELEASE as number;
      expect(horizon).toBe(14);
      // Accepted 14 days ago: the threshold day itself, not yet past.
      const onIt = retainageAlerts([{ ...job, closeoutAcceptedOn: "2026-08-18" }], TODAY);
      expect(onIt[0].severity).toBe("DUE_SOON");
      expect(onIt[0].dueOn).toBe("2026-09-01");
      // Fifteen.
      const past = retainageAlerts([{ ...job, closeoutAcceptedOn: "2026-08-17" }], TODAY);
      expect(past[0].severity).toBe("OVERDUE");
    });
  });

  /**
   * Issue #109, the silent one: money held on a finished job that neither
   * of the other two branches can see. No accepted package, no submission
   * at all, no substantial completion date — so nothing anywhere said a
   * word about the largest sum this app tracks.
   */
  describe("retainage nothing else can see", () => {
    const stranded = { ...job, workIsFinished: true };

    it("raises the held money on a finished job with no anchor at all", () => {
      const [alert] = retainageAlerts([stranded], TODAY);
      expect(alert).toBeDefined();
      expect(alert.kind).toBe("RETAINAGE_RELEASE");
      expect(alert.amount).toBe(13420);
      // No date exists, so none is invented to sort by.
      expect(alert.severity).toBe("STANDING");
      expect(alert.dueOn).toBeNull();
      expect(alert.daysUntil).toBeNull();
      expect(alert.detail).toContain("nothing here can say when");
    });

    it("stays quiet on a job still being built", () => {
      // Retainage held while the work runs is the contract working as
      // written. Alerting on it would make this list furniture.
      expect(retainageAlerts([{ ...stranded, workIsFinished: false }], TODAY)).toEqual([]);
    });

    it("stays quiet on a job whose package is already being chased", () => {
      // closeoutAlerts names that job by itself, carrying the same money.
      expect(retainageAlerts([{ ...stranded, hasCloseoutSubmission: true }], TODAY)).toEqual([]);
    });

    it("does not name the figure in the detail a foreman can read", () => {
      const [alert] = retainageAlerts([stranded], TODAY);
      expect(alert.detail).not.toContain("13420");
      expect(alert.detail).not.toContain("13,420");
    });
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
  const job = {
    jobId: "job_1",
    jobName: "Mercy Tower",
    submittedOn: "2026-08-01",
    retainageBalance: 13420,
    status: "SUBMITTED" as const,
    respondedOn: null,
  };

  it("chases a package the GC has sat on", () => {
    const [alert] = closeoutAlerts([job], TODAY);
    expect(alert.kind).toBe("CLOSEOUT_WITH_GC");
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

  /**
   * Issue #111 item 3. A package the GC REJECTED raised nothing at all:
   * alerts-query only fed through submissions whose status was SUBMITTED,
   * against a three-value enum. The chase vanished at the exact moment the
   * ball came back into our court and the retainage stopped moving.
   */
  describe("a package the GC sent back", () => {
    const rejected = {
      ...job,
      status: "REJECTED" as const,
      submittedOn: "2026-08-01",
      respondedOn: "2026-08-29",
    };

    it("raises its own alert rather than nothing", () => {
      const [alert] = closeoutAlerts([rejected], TODAY);
      expect(alert.kind).toBe("CLOSEOUT_REJECTED");
      expect(alert.amount).toBe(13420);
      // Worded as what happened. "Sent 31 days ago and nothing recorded
      // back" would be a lie about a package they answered.
      expect(alert.detail).toContain("3 days ago");
      expect(alert.title).toContain("Mercy Tower");
    });

    it("hangs on the day they sent it back, not the day we sent it", () => {
      const [alert] = closeoutAlerts([rejected], TODAY);
      expect(alert.dueOn).toBe("2026-08-29");
      expect(alert.key).toBe(
        alertKey("CLOSEOUT_REJECTED", "job_1", "2026-08-29", moneyFact(alert.amount)),
      );
      expect(alert.key).toContain("2026-08-29");
    });

    it("does not wait out the 21-day chase threshold", () => {
      // The threshold is a courtesy to a GC who has not answered yet. A
      // rejection is answered, and ours to act on the same day — /closeout
      // already lists a REJECTED job immediately (needsAttention).
      const sameDay = closeoutAlerts([{ ...rejected, respondedOn: TODAY }], TODAY);
      expect(sameDay).toHaveLength(1);
      expect(sameDay[0].daysUntil).toBe(0);
    });

    it("is covered by the capability table like every other kind", () => {
      expect(ALERT_CAPABILITY.CLOSEOUT_REJECTED).toBe("MANAGE_JOBS");
    });

    it("falls back to the submission date when nobody recorded the response date", () => {
      // status REJECTED with no respondedOn is bad data rather than an
      // impossible one — recordCloseoutResponse requires the date, but a
      // row edited elsewhere could carry it. Silence would be the worst
      // answer, so the alert is raised on what we do have and says so.
      const [alert] = closeoutAlerts([{ ...rejected, respondedOn: null }], TODAY);
      expect(alert.kind).toBe("CLOSEOUT_REJECTED");
      expect(alert.dueOn).toBe("2026-08-01");
    });
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

/* ------------------------------------------------------------ issue #109 */

/**
 * A key must not carry the one figure the capability filter exists to
 * withhold, and it must still lapse a dismissal when the money materially
 * moves. Those two pull in opposite directions, which is why they are
 * tested together: satisfying either one alone is easy and wrong.
 */
describe("money in an alert key", () => {
  const wip = (overrun: number) =>
    wipAlerts([{ jobId: "job_1", jobName: "Mercy Tower", overrun }])[0];

  /** Every plain way a figure could end up in a string. */
  const renderings = (amount: number) => [
    String(amount),
    amount.toFixed(2),
    amount.toFixed(0),
    Math.round(amount).toString(),
    amount.toLocaleString("en-US"),
  ];

  it("keeps the exact overrun out of the WIP key entirely", () => {
    // It used to be the key: `WIP_VARIANCE:job_1:47231.88`. The whole
    // Alert is a prop of the client component AlertRow, so that figure was
    // in the RSC flight payload and in view-source for a foreman whose
    // `amount` the filter had just nulled.
    const alert = wip(47231.88);
    expect(alert.amount).toBe(47231.88);
    for (const rendering of renderings(47231.88)) {
      expect(alert.key, `key leaks ${rendering}`).not.toContain(rendering);
    }
  });

  it("keeps it out of every other money alert's key too", () => {
    const backcharge = backchargeAlerts(
      [
        {
          id: "bc_1",
          number: 4,
          jobName: "Mercy Tower",
          status: "RECEIVED",
          claimedAmount: 42000,
          respondByDate: "2026-09-05",
        },
      ],
      TODAY,
    )[0];
    const retainage = retainageAlerts(
      [
        {
          jobId: "job_1",
          jobName: "Mercy Tower",
          balance: 42000,
          closeoutAcceptedOn: "2026-08-01",
          substantialCompletionDate: null,
          workIsFinished: true,
          hasCloseoutSubmission: true,
        },
      ],
      TODAY,
    )[0];
    const closeout = closeoutAlerts(
      [
        {
          jobId: "job_1",
          jobName: "Mercy Tower",
          submittedOn: "2026-08-01",
          retainageBalance: 42000,
          status: "SUBMITTED" as const,
          respondedOn: null,
        },
      ],
      TODAY,
    )[0];

    for (const alert of [backcharge, retainage, closeout]) {
      expect(alert.amount).toBe(42000);
      for (const rendering of renderings(42000)) {
        expect(alert.key, `${alert.kind} key leaks ${rendering}`).not.toContain(rendering);
      }
    }
  });

  it("does not mint a new key for a $12.40 delivery ticket", () => {
    // The cent-exact key made WIP_VARIANCE undismissable on any job with
    // daily cost entries: every ticket was a new alert.
    expect(wip(47231.88).key).toBe(wip(47244.28).key);
  });

  it("does mint a new key when the money doubles", () => {
    expect(wip(47231.88).key).not.toBe(wip(94463.76).key);
    expect(amountBand(500)).not.toBe(amountBand(42000));
  });

  it("has no band for money that is not there", () => {
    expect(amountBand(null)).toBeNull();
    expect(amountBand(0)).toBeNull();
    expect(moneyFact(null)).toBe(moneyFact(0));
    // A closeout package holding nothing and one holding $42,000 are not
    // the same situation, so they are not the same key.
    expect(moneyFact(null)).not.toBe(moneyFact(42000));
  });
});

/**
 * A dismissal that outlives the fact it dismissed hides a live problem,
 * which is worse than never having offered to dismiss anything.
 *
 * Each of these DISMISSES, then CHANGES THE UNDERLYING FACT, then asserts
 * what happened — a test that only dismisses proves nothing about this.
 * The severity recorded is the alert's own, so escalation can never be the
 * reason something comes back here; the key is the only mechanism under
 * test.
 */
describe("a dismissal against money that has moved", () => {
  const held = (balance: number) =>
    retainageAlerts(
      [
        {
          jobId: "job_1",
          jobName: "Mercy Tower",
          balance,
          closeoutAcceptedOn: "2026-08-01",
          substantialCompletionDate: null,
          workIsFinished: true,
          hasCloseoutSubmission: true,
        },
      ],
      TODAY,
    )[0];

  const dismissed = (alert: Alert) => [
    { alertKey: alert.key, snoozedUntil: null, acknowledgedSeverity: alert.severity },
  ];

  it("comes back when a retainage alert dismissed at $500 is now $42,000", () => {
    const small = held(500);
    const large = held(42000);
    expect(small.severity).toBe(large.severity); // so escalation cannot explain it

    const { visible, silenced } = partitionAlerts([large], dismissed(small), TODAY);
    expect(silenced).toEqual([]);
    expect(visible).toHaveLength(1);
    expect(visible[0].amount).toBe(42000);
  });

  it("stays dismissed while the money has not moved", () => {
    // The control. Without it the test above would pass on an
    // implementation that simply never silences anything.
    const alert = held(42000);
    const { visible, silenced } = partitionAlerts([alert], dismissed(alert), TODAY);
    expect(visible).toEqual([]);
    expect(silenced).toHaveLength(1);
  });

  it("stays dismissed through a $12.40 change on a WIP alert", () => {
    const before = wipAlerts([{ jobId: "job_1", jobName: "Mercy Tower", overrun: 47231.88 }])[0];
    const after = wipAlerts([{ jobId: "job_1", jobName: "Mercy Tower", overrun: 47244.28 }])[0];
    const { silenced } = partitionAlerts([after], dismissed(before), TODAY);
    expect(silenced).toHaveLength(1);
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
  // These are the headline numbers on /alerts, and the old fixture held ONE
  // alert of each of two severities — so inverting all three filters to
  // `!==` counted the complement and got the same answers, and dueSoon was
  // never asserted at all (issue #108). Deliberately asymmetric now: three
  // OVERDUE, two DUE_SOON, two STANDING. No count equals the count of
  // everything that is NOT it, so an inverted filter cannot come out right.
  const at = (severity: Alert["severity"], n: number, amount: number | null): Alert => ({
    key: `${severity}:${n}`,
    kind: "WIP_VARIANCE",
    severity,
    title: `${severity} ${n}`,
    detail: "fixture",
    href: "/alerts",
    dueOn: severity === "STANDING" ? null : "2026-09-05",
    daysUntil: severity === "STANDING" ? null : 4,
    amount,
  });

  const fixture: Alert[] = [
    at("OVERDUE", 1, 4200),
    at("OVERDUE", 2, null),
    at("OVERDUE", 3, 1000),
    at("DUE_SOON", 1, 800),
    at("DUE_SOON", 2, null),
    at("STANDING", 1, 18000),
    at("STANDING", 2, null),
  ];

  it("counts EACH severity, and never the complement of one", () => {
    const summary = summarizeAlerts(fixture);
    expect(summary.overdue).toBe(3);
    expect(summary.dueSoon).toBe(2);
    expect(summary.standing).toBe(2);
    expect(summary.total).toBe(7);
    // The three severities account for every alert — a fourth value
    // appearing would otherwise vanish out of the headline numbers.
    expect(summary.overdue + summary.dueSoon + summary.standing).toBe(summary.total);
  });

  it("sums only what carries a figure, and treats a missing one as nothing", () => {
    expect(summarizeAlerts(fixture).amountNamed).toBe(24000);
  });

  it("counts zero for a severity that is absent rather than borrowing another's", () => {
    const summary = summarizeAlerts([at("DUE_SOON", 1, 500)]);
    expect(summary.overdue).toBe(0);
    expect(summary.dueSoon).toBe(1);
    expect(summary.standing).toBe(0);
    expect(summary.total).toBe(1);
    expect(summary.amountNamed).toBe(500);
  });

  it("still agrees with the alerts the real producers build", () => {
    // Kept from the original: the hand-built fixture above is only worth
    // anything if the severities it uses are the ones real alerts carry.
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
    expect(summary.dueSoon).toBe(0);
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
    [
      {
        jobId: "job_1",
        jobName: "Mercy Tower",
        submittedOn: "2026-08-01",
        retainageBalance: 13420,
        status: "SUBMITTED",
        respondedOn: null,
      },
    ],
    TODAY,
  );
  const closeoutRejected = closeoutAlerts(
    [
      {
        jobId: "job_2",
        jobName: "Harbor Point",
        submittedOn: "2026-08-01",
        retainageBalance: 13420,
        status: "REJECTED",
        respondedOn: "2026-08-29",
      },
    ],
    TODAY,
  );

  it("gives every kind a capability, with no gaps", () => {
    // A kind added without an entry here would fall through the filter as
    // undefined and be shown to everybody, which is the failure mode this
    // whole map exists to close.
    for (const alert of [...backcharge, ...closeout, ...closeoutRejected]) {
      expect(ALERT_CAPABILITY[alert.kind]).toBeTruthy();
    }
  });

  it("keeps a rejected package's money away from a foreman too", () => {
    // Same reasoning as the stuck package below: whose move it is now is
    // operational, what it is holding up is not.
    const [alert] = visibleToPrincipal(closeoutRejected, foreman);
    expect(alert).toBeDefined();
    expect(alert.amount).toBeNull();
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
