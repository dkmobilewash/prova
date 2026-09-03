import { describe, expect, it } from "vitest";
import type { Alert, AlertKind, AlertSeverity } from "@/lib/alerts";
import {
  DATED_RUNGS,
  STANDING_RUNG,
  consumed,
  dispatchKey,
  partitionOwned,
  keysConsumed,
  noticesDue,
} from "@/lib/notification-milestones";

/** An alert as the engine would hand it over. Dates and distances are set
 * together by the caller because that is how `lib/alerts.ts` builds them —
 * a test that let them disagree would be testing a shape that cannot
 * occur, except in the one case below where that IS the point. */
function alert(over: Partial<Alert> & { key: string }): Alert {
  const daysUntil = over.daysUntil === undefined ? null : over.daysUntil;
  const severity: AlertSeverity =
    over.severity ??
    (daysUntil === null ? "STANDING" : daysUntil < 0 ? "OVERDUE" : "DUE_SOON");
  return {
    kind: "RENEWAL" as AlertKind,
    severity,
    title: "General liability certificate",
    detail: "Northwind Insurance — due in 7 days",
    href: "/compliance",
    dueOn: daysUntil === null ? null : "2026-11-30",
    daysUntil,
    amount: null,
    ...over,
  };
}

const nothingSent = new Set<string>();

describe("the ladder", () => {
  it("is three rungs, loosest first", () => {
    expect(DATED_RUNGS).toEqual(["approaching", "week", "due"]);
  });

  it("takes each kind's horizon from the engine rather than a table here", () => {
    // A licence goes DUE_SOON at sixty days and a COI at thirty, because
    // RENEWAL_HORIZON_DAYS says so per RENEWAL kind. `Alert` flattens both
    // to kind "RENEWAL", so nothing in this module could tell them apart —
    // it reads the severity the engine already set.
    const licenceFarOut = alert({
      key: "RENEWAL:lic_1:2026-11-30",
      daysUntil: 55,
      severity: "DUE_SOON",
    });
    const coiFarOut = alert({
      key: "RENEWAL:coi_1:2026-11-30",
      daysUntil: 55,
      severity: "STANDING",
    });

    expect(noticesDue([licenceFarOut], nothingSent)).toHaveLength(1);
    expect(noticesDue([coiFarOut], nothingSent)).toEqual([]);
  });

  it("says nothing about a dated alert the engine has not called due soon", () => {
    // The regression that started this: a numeric ladder off
    // ALERT_HORIZON_DAYS has no RENEWAL entry, falls back to seven, and
    // drops the sixty-day licence warning entirely. Nothing fails — the
    // email simply never goes.
    const current = alert({
      key: "RENEWAL:lic_1:2027-06-01",
      daysUntil: 200,
      severity: "STANDING",
    });
    expect(noticesDue([current], nothingSent)).toEqual([]);
  });
});

describe("dispatchKey", () => {
  it("is built on the alert's key, so a changed fact is a changed key", () => {
    const before = dispatchKey("RENEWAL:lic_1:2026-11-30", "week");
    const after = dispatchKey("RENEWAL:lic_1:2027-11-30", "week");
    expect(before).not.toEqual(after);
  });

  it("separates rungs of the same unchanged fact", () => {
    expect(dispatchKey("RENEWAL:lic_1:2026-11-30", "approaching")).not.toEqual(
      dispatchKey("RENEWAL:lic_1:2026-11-30", "due"),
    );
  });

  it("does not vary with the day it is computed", () => {
    // The failure this whole file exists to prevent: a key carrying the
    // date it was SENT is a new key tomorrow, and the email goes out every
    // morning. The alert key does carry a date — the expiry date, which is
    // the fact — and that one is supposed to be there.
    const alertKey = "RENEWAL:lic_1:2026-11-30";
    expect(dispatchKey(alertKey, "week")).toBe(dispatchKey(alertKey, "week"));
    expect(dispatchKey(alertKey, "week")).toBe("RENEWAL:lic_1:2026-11-30@week");
  });
});

describe("noticesDue — the anti-nag property", () => {
  it("says nothing on the second run when nothing has changed", () => {
    const alerts = [alert({ key: "RENEWAL:lic_1:2026-11-30", daysUntil: 5 })];

    const first = noticesDue(alerts, nothingSent);
    expect(first).toHaveLength(1);

    const sent = new Set(first.flatMap(keysConsumed));
    expect(noticesDue(alerts, sent)).toEqual([]);
  });

  it("stays silent across many runs of an unchanged situation", () => {
    const alerts = [alert({ key: "RENEWAL:lic_1:2026-11-30", daysUntil: 5 })];
    const sent = new Set<string>();

    let emails = 0;
    for (let run = 0; run < 30; run += 1) {
      const due = noticesDue(alerts, sent);
      emails += due.length;
      due.flatMap(keysConsumed).forEach((key) => sent.add(key));
    }

    expect(emails).toBe(1);
  });

  it("speaks again when the situation tightens to the next rung", () => {
    const key = "RENEWAL:lic_1:2026-11-30";
    const sent = new Set<string>();

    // Sixty days out: the horizon rung.
    const far = noticesDue([alert({ key, daysUntil: 60 })], sent);
    expect(far).toHaveLength(1);
    expect(far[0].rung).toBe("approaching");
    far.flatMap(keysConsumed).forEach((k) => sent.add(k));

    // Thirty days out: between rungs, and correctly quiet.
    expect(noticesDue([alert({ key, daysUntil: 30 })], sent)).toEqual([]);

    // A week out: worth saying again.
    const near = noticesDue([alert({ key, daysUntil: 7 })], sent);
    expect(near).toHaveLength(1);
    expect(near[0].rung).toBe("week");
    near.flatMap(keysConsumed).forEach((k) => sent.add(k));

    // The day it lapses.
    const lapsed = noticesDue([alert({ key, daysUntil: 0 })], sent);
    expect(lapsed).toHaveLength(1);
    expect(lapsed[0].rung).toBe("due");
  });

  it("speaks again when the fact changes, because the key changed", () => {
    const sent = new Set<string>();
    const before = noticesDue(
      [alert({ key: "RENEWAL:lic_1:2026-11-30", daysUntil: 3 })],
      sent,
    );
    before.flatMap(keysConsumed).forEach((k) => sent.add(k));

    // Renewed. New date, new key, and the ladder starts over.
    const after = noticesDue(
      [alert({ key: "RENEWAL:lic_1:2027-11-30", daysUntil: 3 })],
      sent,
    );
    expect(after).toHaveLength(1);
  });
});

describe("noticesDue — a record entered late", () => {
  it("still gets a notice, at the rung that describes it now", () => {
    // Entered five days before it lapses: 60 and 7 both crossed at once.
    const due = noticesDue(
      [alert({ key: "RENEWAL:lic_1:2026-11-30", daysUntil: 5 })],
      nothingSent,
    );

    expect(due).toHaveLength(1);
    expect(due[0].rung).toBe("week");
    expect(due[0].alsoSpent).toEqual(["approaching"]);
  });

  it("burns the rungs it passed, so they cannot fire behind it", () => {
    const key = "RENEWAL:lic_1:2026-11-30";
    const due = noticesDue([alert({ key, daysUntil: 5 })], nothingSent);
    const sent = new Set(due.flatMap(keysConsumed));

    expect(sent).toContain(dispatchKey(key, "week"));
    expect(sent).toContain(dispatchKey(key, "approaching"));

    // Tomorrow, and the day after: nothing more until zero.
    expect(noticesDue([alert({ key, daysUntil: 4 })], sent)).toEqual([]);
    expect(noticesDue([alert({ key, daysUntil: 1 })], sent)).toEqual([]);
    expect(noticesDue([alert({ key, daysUntil: 0 })], sent)).toHaveLength(1);
  });

  it("sends ONE email for a record entered after it already expired", () => {
    // Every rung crossed at once. Three emails in one run would be the
    // worst version of this feature.
    const due = noticesDue(
      [alert({ key: "RENEWAL:lic_1:2026-01-01", daysUntil: -40 })],
      nothingSent,
    );

    expect(due).toHaveLength(1);
    expect(due[0].rung).toBe("due");
    expect(keysConsumed(due[0])).toHaveLength(3);
  });
});

describe("noticesDue — dates", () => {
  it("does not fire a rung the alert has not reached", () => {
    // 90 days out, beyond its horizon, so the engine still calls it
    // STANDING: nothing to say yet.
    expect(
      noticesDue(
        [
          alert({
            key: "RENEWAL:lic_1:2027-01-01",
            daysUntil: 90,
            severity: "STANDING",
          }),
        ],
        nothingSent,
      ),
    ).toEqual([]);
  });

  it("treats an expired alert as having crossed the DUE rung", () => {
    const due = noticesDue(
      [alert({ key: "RENEWAL:lic_1:2026-01-01", daysUntil: -1 })],
      nothingSent,
    );
    expect(due[0].rung).toBe("due");
  });

  it("never fires for a dated alert with no distance computed", () => {
    // `null <= 0` is TRUE in JavaScript. Without the guard this alert
    // crosses the expiry rung and someone is emailed that a live
    // certificate has lapsed.
    const due = noticesDue(
      [
        alert({
          key: "RENEWAL:lic_1:2026-11-30",
          dueOn: "2026-11-30",
          daysUntil: null,
        }),
      ],
      nothingSent,
    );
    expect(due).toEqual([]);
  });
});

describe("noticesDue — standing conditions", () => {
  const standing = alert({
    key: "WIP_VARIANCE:job_1:over",
    kind: "WIP_VARIANCE",
    severity: "STANDING",
    title: "Riverside Tower is forecast over contract value",
    detail: "Forecast $1,240,000 against a $1,180,000 contract",
    href: "/jobs/job_1",
  });

  it("fires once, on its own rung", () => {
    const due = noticesDue([standing], nothingSent);
    expect(due).toHaveLength(1);
    expect(due[0].rung).toBe(STANDING_RUNG);
    expect(due[0].alsoSpent).toEqual([]);
  });

  it("does not repeat while the condition holds", () => {
    const sent = new Set(
      noticesDue([standing], nothingSent).flatMap(keysConsumed),
    );
    expect(noticesDue([standing], sent)).toEqual([]);
  });

  it("returns when the condition changes, because the key carries it", () => {
    const sent = new Set(
      noticesDue([standing], nothingSent).flatMap(keysConsumed),
    );
    const worse = { ...standing, key: "WIP_VARIANCE:job_1:over-again" };
    expect(noticesDue([worse], sent)).toHaveLength(1);
  });

  it("never borrows the dated ladder, not even carrying a date already past", () => {
    // THE FIXTURE IS THE TEST. This assertion used to be made against the
    // WIP_VARIANCE alert above, whose `dueOn` is null — the one STANDING
    // shape that cannot reach the dated branch at all, so it passed
    // whatever the branch did. #126.
    //
    // Three kinds are STANDING and DATED: a closeout package the GC has
    // sat on, retainage past a forecast substantial completion, and a
    // rejected closeout. Every one of them carries a date already behind
    // it. Deciding on `dueOn` rather than on the severity sent all three
    // up the dated ladder, where `days <= 0` fired the DUE rung — so the
    // email said "Now due" about a condition that has no deadline, and it
    // burned `@week` and `@due` instead of `@standing`, which is the one
    // key that alert was ever going to have.
    const satOn = alert({
      key: "CLOSEOUT_WITH_GC:job_1:2026-07-15",
      kind: "CLOSEOUT_WITH_GC",
      severity: "STANDING",
      title: "Closeout package on Riverside Tower has had no response",
      detail: "Sent 49 days ago and nothing recorded back.",
      href: "/closeout",
      dueOn: "2026-07-15",
      daysUntil: -49,
    });

    const due = noticesDue([satOn], nothingSent);
    expect(due).toHaveLength(1);
    expect(due[0].rung).toBe(STANDING_RUNG);
    expect(due[0].alsoSpent).toEqual([]);
    expect(keysConsumed(due[0])).toEqual([`${satOn.key}@${STANDING_RUNG}`]);
  });

  it("says nothing about a standing condition whose date has not arrived", () => {
    // The other side of the same branch, and the reason the fix cannot be
    // "STANDING always fires". A COI 55 days out is STANDING because it is
    // outside its own horizon — nothing has happened yet, and a
    // "Needs attention" email about it would spend the only key it has
    // long before there is anything to say.
    const farOut = alert({
      key: "RENEWAL:coi_1:2026-11-30",
      severity: "STANDING",
      dueOn: "2026-11-30",
      daysUntil: 55,
    });
    expect(noticesDue([farOut], nothingSent)).toEqual([]);
  });

  it("treats an undated renewal as standing, not as expired", () => {
    // The case that makes the wording rule load-bearing: no date recorded
    // looks exactly like a real standing condition from in here.
    const undated = alert({
      key: "RENEWAL:coi_9:undated",
      severity: "STANDING",
      detail: "Northwind Insurance — no date recorded",
    });
    const due = noticesDue([undated], nothingSent);
    expect(due[0].rung).toBe(STANDING_RUNG);
  });
});

describe("noticesDue — order", () => {
  it("puts deadlines before standing conditions", () => {
    const due = noticesDue(
      [
        alert({
          key: "WIP_VARIANCE:job_1:over",
          kind: "WIP_VARIANCE",
          title: "A job over budget",
        }),
        alert({
          key: "RENEWAL:lic_1:2026-11-30",
          daysUntil: 6,
          title: "A licence",
        }),
      ],
      nothingSent,
    );
    expect(due.map((n) => n.alert.title)).toEqual([
      "A licence",
      "A job over budget",
    ]);
  });

  it("puts the tightest rung first", () => {
    const due = noticesDue(
      [
        alert({
          key: "RENEWAL:a:2026-12-30",
          daysUntil: 55,
          title: "Sixty out",
        }),
        alert({ key: "RENEWAL:b:2026-11-30", daysUntil: -2, title: "Lapsed" }),
        alert({
          key: "RENEWAL:c:2026-12-01",
          daysUntil: 5,
          title: "This week",
        }),
      ],
      nothingSent,
    );
    expect(due.map((n) => n.alert.title)).toEqual([
      "Lapsed",
      "This week",
      "Sixty out",
    ]);
  });

  it("breaks a tie on money, largest first", () => {
    const due = noticesDue(
      [
        alert({
          key: "B:1:x",
          kind: "BACKCHARGE_RESPONSE",
          daysUntil: 3,
          title: "Small",
          amount: 900,
        }),
        alert({
          key: "B:2:x",
          kind: "BACKCHARGE_RESPONSE",
          daysUntil: 3,
          title: "Large",
          amount: 42_000,
        }),
      ],
      nothingSent,
    );
    expect(due.map((n) => n.alert.title)).toEqual(["Large", "Small"]);
  });

  it("is a total order, so two runs of one input agree", () => {
    const alerts = [
      alert({ key: "RENEWAL:a:2026-11-30", daysUntil: 3, title: "Bravo" }),
      alert({ key: "RENEWAL:b:2026-11-30", daysUntil: 3, title: "Alpha" }),
    ];
    const once = noticesDue(alerts, nothingSent).map((n) => n.alert.title);
    const twice = noticesDue([...alerts].reverse(), nothingSent).map(
      (n) => n.alert.title,
    );
    expect(once).toEqual(twice);
    expect(once).toEqual(["Alpha", "Bravo"]);
  });
});

describe("keysConsumed", () => {
  it("names every rung the notice passes, not just the one that fired", () => {
    const due = noticesDue(
      [alert({ key: "RENEWAL:lic_1:2026-11-30", daysUntil: 5 })],
      nothingSent,
    );
    expect(keysConsumed(due[0]).sort()).toEqual(
      [
        "RENEWAL:lic_1:2026-11-30@week",
        "RENEWAL:lic_1:2026-11-30@approaching",
      ].sort(),
    );
  });

  it("is what makes a run idempotent", () => {
    const alerts = [
      alert({ key: "RENEWAL:a:2026-11-30", daysUntil: 5 }),
      alert({ key: "WIP_VARIANCE:job_1:over", kind: "WIP_VARIANCE" }),
    ];
    const sent = new Set(noticesDue(alerts, nothingSent).flatMap(keysConsumed));
    expect(noticesDue(alerts, sent)).toEqual([]);
  });
});

describe("consumed", () => {
  /** The bug this pins: every row used to carry the rung that FIRED, so a
   * burned `@approaching` was recorded as a `week`. `dispatchKey` is the
   * only column matched on, so nothing sent wrong — which is why the suite
   * was green through it. What broke was the column that exists to answer
   * "why did this person get this email" without parsing keys apart. */
  it("gives each key the rung that key names, not the one that fired", () => {
    const due = noticesDue(
      [alert({ key: "RENEWAL:lic_1:2026-11-30", daysUntil: 5 })],
      nothingSent,
    );
    // A licence entered five days out crosses approaching and week at once,
    // fires week, and burns approaching.
    expect(due[0].rung).toBe("week");
    expect(consumed(due[0]).sort((a, b) => a.rung.localeCompare(b.rung))).toEqual([
      {
        dispatchKey: "RENEWAL:lic_1:2026-11-30@approaching",
        rung: "approaching",
      },
      { dispatchKey: "RENEWAL:lic_1:2026-11-30@week", rung: "week" },
    ]);
  });

  it("agrees with its own keys for every notice, dated or standing", () => {
    const due = noticesDue(
      [
        alert({ key: "RENEWAL:lic_1:2026-11-30", daysUntil: 5 }),
        alert({ key: "RENEWAL:lic_2:2026-09-01", daysUntil: -3 }),
        alert({ key: "WIP_VARIANCE:job_1:over", kind: "WIP_VARIANCE" }),
      ],
      nothingSent,
    );
    // Whatever the ladder does, a row must never describe itself as a rung
    // its own key does not name — that is the only invariant the `rung`
    // column has to hold to be worth storing.
    for (const notice of due) {
      for (const row of consumed(notice)) {
        expect(row.dispatchKey).toBe(dispatchKey(notice.alert.key, row.rung));
      }
    }
    expect(due.flatMap(consumed).length).toBeGreaterThan(due.length);
  });

  it("still yields exactly the keys keysConsumed does", () => {
    const due = noticesDue(
      [alert({ key: "RENEWAL:lic_1:2026-11-30", daysUntil: -1 })],
      nothingSent,
    );
    expect(consumed(due[0]).map((row) => row.dispatchKey)).toEqual(
      keysConsumed(due[0]),
    );
  });
});

describe("partitionOwned — who sends when two runs overlap", () => {
  /** The scenario, which needs no new record to happen: two runs for one
   * person read a moment apart across a rung boundary.
   *
   *   run B reads at 8 days → crosses [approaching] → claims @approaching
   *   run A reads at 7 days → crosses [approaching, week], fires week
   *
   * A wins only @week. Counting that as ownership is what sent two emails
   * about one licence seconds apart. */
  it("does not let a run send a notice whose burned rung another run took", () => {
    const due = noticesDue(
      [alert({ key: "RENEWAL:lic_1:2026-11-30", daysUntil: 7 })],
      nothingSent,
    );
    expect(due[0].rung).toBe("week");

    // Everything this notice consumes except the rung the other run took.
    const won = new Set(["RENEWAL:lic_1:2026-11-30@week"]);
    const { ours, theirs } = partitionOwned(due, won);

    expect(ours).toEqual([]);
    expect(theirs).toEqual(due);
  });

  it("sends the notice when it won every key that notice consumes", () => {
    const due = noticesDue(
      [alert({ key: "RENEWAL:lic_1:2026-11-30", daysUntil: 7 })],
      nothingSent,
    );
    const won = new Set(keysConsumed(due[0]));
    const { ours, theirs } = partitionOwned(due, won);

    expect(ours).toEqual(due);
    expect(theirs).toEqual([]);
  });

  it("splits per notice — losing one alert does not silence the others", () => {
    const due = noticesDue(
      [
        alert({ key: "RENEWAL:lic_1:2026-11-30", daysUntil: 7 }),
        alert({ key: "WIP_VARIANCE:job_1:over", kind: "WIP_VARIANCE" }),
      ],
      nothingSent,
    );
    const lost = due.find((n) => n.alert.key.startsWith("RENEWAL:"))!;
    const kept = due.find((n) => n.alert.key.startsWith("WIP_VARIANCE:"))!;

    const won = new Set([
      ...keysConsumed(kept),
      // only the fired rung of the one we lost
      dispatchKey(lost.alert.key, lost.rung),
    ]);
    const { ours, theirs } = partitionOwned(due, won);

    expect(ours).toEqual([kept]);
    expect(theirs).toEqual([lost]);
  });

  it("owns everything when nothing is contended", () => {
    const due = noticesDue(
      [
        alert({ key: "RENEWAL:lic_1:2026-11-30", daysUntil: -2 }),
        alert({ key: "WIP_VARIANCE:job_1:over", kind: "WIP_VARIANCE" }),
      ],
      nothingSent,
    );
    const won = new Set(due.flatMap(keysConsumed));
    expect(partitionOwned(due, won).ours).toEqual(due);
    expect(partitionOwned(due, won).theirs).toEqual([]);
  });
});
