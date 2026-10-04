/**
 * The two apprenticeship-form alerts.
 *
 * WHAT THIS TESTS AND WHAT IT DELIBERATELY DOES NOT. The deadline arithmetic
 * belongs to `das-forms.test.ts` and is not re-asserted here — the ten-day
 * bound, the first-worker bound, and the three-non-weekend-day count back
 * from the day an apprentice is needed all have their own tests, and a second
 * set of expectations for them here is a second opinion free to disagree.
 * What these builders add on top is the decision about WHICH standings are
 * worth telling somebody about, and that is what is asserted: a sent notice
 * raises nothing, a deadline beyond the horizon raises nothing, and an empty
 * committee answer raises something no date-based branch would.
 *
 * Every `latestSendDay` expectation is read from
 * `latestSendDayIgnoringHolidays` rather than typed in, for that same reason.
 * The fixture DATES are chosen against a fixed today so the relationships
 * hold — the comment on each says what relationship it is testing, because a
 * bare date tells the next reader nothing.
 */

import { describe, expect, it } from "vitest";

import {
  ALERT_HORIZON_DAYS,
  das140Alerts,
  das142Alerts,
  type Das140AlertSource,
  type Das142AlertSource,
} from "./alerts";
import { DAS142_LEAD_TIME_CAVEATS, latestSendDayIgnoringHolidays } from "./das-forms";

/** A Wednesday, so a weekend never lands where a fixture did not intend it. */
const TODAY = "2026-09-30";

const notice = (over: Partial<Das140AlertSource> = {}): Das140AlertSource => ({
  id: "n1",
  jobId: "job1",
  jobName: "Riverside Medical Office Building",
  committeeName: "Southern California Drywall/Lathing JATC",
  craftName: "Drywall Installer",
  contractExecutedOn: "2026-09-01",
  sentOn: null,
  firstWorkerOnSiteOn: null,
  ...over,
});

const request = (over: Partial<Das142AlertSource> = {}): Das142AlertSource => ({
  id: "r1",
  jobId: "job1",
  jobName: "Riverside Medical Office Building",
  committeeName: "Southern California Drywall/Lathing JATC",
  craftName: "Drywall Installer",
  apprenticesRequested: 2,
  neededFrom: "2026-10-09",
  requestedOn: null,
  outcome: null,
  ...over,
});

describe("das140Alerts", () => {
  it("raises an overdue notice that was never marked sent", () => {
    // Executed 2026-09-01, so the ten-day bound fell on 2026-09-11.
    const [alert, ...rest] = das140Alerts([notice()], TODAY);
    expect(rest).toEqual([]);
    expect(alert.kind).toBe("DAS140_NOTICE");
    expect(alert.severity).toBe("OVERDUE");
    expect(alert.dueOn).toBe("2026-09-11");
    expect(alert.daysUntil).toBeLessThan(0);
    expect(alert.href).toBe("/jobs/job1/das-140/n1");
    expect(alert.title).toContain("Drywall Installer");
    expect(alert.title).toContain("Riverside Medical Office Building");
    // The bound is named, because "due the 11th" is unarguable and "due ten
    // days after execution" is checkable.
    expect(alert.detail).toContain("ten days after the contract was executed");
    expect(alert.detail).toContain("Southern California Drywall/Lathing JATC");
  });

  it("names the first-worker bound when that is the bound that governs", () => {
    // Executed the 25th (ten-day bound 2026-10-05) but the crew logged hours
    // on the 28th, which closes the window early — and is the whole reason
    // that date is derived from the timesheets rather than typed.
    const [alert] = das140Alerts(
      [notice({ contractExecutedOn: "2026-09-25", firstWorkerOnSiteOn: "2026-09-28" })],
      TODAY,
    );
    expect(alert.dueOn).toBe("2026-09-28");
    expect(alert.severity).toBe("OVERDUE");
    expect(alert.detail).toContain("the first day your crew logged hours");
  });

  it("warns across the whole ten-day window, including the day of execution", () => {
    // Executed today: due in exactly the horizon. A 7-day horizon would have
    // left the first three days of a ten-day statutory window silent.
    const [alert] = das140Alerts([notice({ contractExecutedOn: TODAY })], TODAY);
    expect(ALERT_HORIZON_DAYS.DAS140_NOTICE).toBe(10);
    expect(alert.severity).toBe("DUE_SOON");
    expect(alert.daysUntil).toBe(10);
  });

  it("says nothing about a deadline beyond the horizon", () => {
    // Execution entered a day ahead, so the bound is eleven days out.
    expect(das140Alerts([notice({ contractExecutedOn: "2026-10-01" })], TODAY)).toEqual([]);
  });

  it("says nothing about a notice that was sent, in time or late", () => {
    expect(das140Alerts([notice({ sentOn: "2026-09-05" })], TODAY)).toEqual([]);
    // SENT_LATE is a record of what happened. Sending it again cannot improve
    // it, and a red badge saying so is how a list of real problems becomes
    // furniture — lienDeadlineAlerts' rule, same reasoning.
    expect(das140Alerts([notice({ sentOn: "2026-09-20" })], TODAY)).toEqual([]);
  });

  it("keys on the due day, so a backdated timesheet lapses an old dismissal", () => {
    const [before] = das140Alerts([notice({ contractExecutedOn: "2026-09-25" })], TODAY);
    const [after] = das140Alerts(
      [notice({ contractExecutedOn: "2026-09-25", firstWorkerOnSiteOn: "2026-09-28" })],
      TODAY,
    );
    expect(before.key).not.toBe(after.key);
    expect(after.key).toContain("2026-09-28");
  });

  it("carries no money figure", () => {
    // A DAS 140 records a contract amount, and interpolating it here would
    // put a dollar value on a compliance alert that visibleToPrincipal would
    // then have to strip for a foreman. There is nothing to strip.
    expect(das140Alerts([notice()], TODAY)[0].amount).toBeNull();
  });
});

describe("das142Alerts", () => {
  it("calls a request that is still unsent past its send day already short notice", () => {
    // Needed 2026-10-02, so the latest send day was yesterday — the day it is
    // wanted has NOT passed, which is what separates this from the branch
    // below.
    const [alert, ...rest] = das142Alerts([request({ neededFrom: "2026-10-02" })], TODAY);
    expect(rest).toEqual([]);
    expect(alert.severity).toBe("OVERDUE");
    expect(alert.dueOn).toBe(latestSendDayIgnoringHolidays("2026-10-02"));
    expect(alert.detail).toContain("already short notice");
    expect(alert.href).toBe("/jobs/job1/das-142/r1");
    // The one-way error, in the alert itself: a holiday can only make the
    // real cut-off earlier, so "send it sooner" is always safe.
    expect(alert.detail).toContain("earlier than this, never later");
  });

  it("stops calling it a deadline once the day it was needed has gone", () => {
    const [alert] = das142Alerts([request({ neededFrom: "2026-09-25" })], TODAY);
    expect(alert.severity).toBe("OVERDUE");
    expect(alert.title).toContain("No DAS 142 was sent");
    expect(alert.detail).toContain("That day has gone");
    // A record to correct, not a request to hurry.
    expect(alert.detail).not.toContain("short notice");
  });

  it("warns ahead of the send day, inside the horizon", () => {
    // Latest send day is six days out, inside the seven-day horizon.
    const [alert] = das142Alerts([request({ neededFrom: "2026-10-09" })], TODAY);
    expect(alert.severity).toBe("DUE_SOON");
    expect(alert.daysUntil).toBe(6);
    expect(alert.detail).toContain("counting whole days");
  });

  it("says nothing about a send day beyond the horizon", () => {
    // Fifteen days out against a horizon of seven.
    expect(ALERT_HORIZON_DAYS.DAS142_DISPATCH).toBe(7);
    expect(das142Alerts([request({ neededFrom: "2026-10-20" })], TODAY)).toEqual([]);
  });

  it("says nothing about a request that went out and was answered", () => {
    expect(
      das142Alerts(
        [request({ neededFrom: "2026-09-25", requestedOn: "2026-09-20", outcome: "DISPATCHED" })],
        TODAY,
      ),
    ).toEqual([]);
  });

  it("raises a standing alert when the request went out and no answer was recorded", () => {
    const [alert, ...rest] = das142Alerts(
      [request({ neededFrom: "2026-09-25", requestedOn: "2026-09-20" })],
      TODAY,
    );
    expect(rest).toEqual([]);
    // STANDING, not overdue: the committee's answer has no date this app was
    // ever told, so there is nothing to be late against.
    expect(alert.severity).toBe("STANDING");
    expect(alert.dueOn).toBeNull();
    expect(alert.daysUntil).toBeNull();
    expect(alert.title).toContain("No answer recorded");
    // It names all three answers rather than implying the bad one.
    expect(alert.detail).toContain("unable to dispatch");
    expect(alert.detail).toContain("no response at all");
  });

  it("treats a recorded no-response as an answer, because it is one", () => {
    expect(
      das142Alerts(
        [request({ neededFrom: "2026-09-25", requestedOn: "2026-09-20", outcome: "NO_RESPONSE" })],
        TODAY,
      ),
    ).toEqual([]);
  });

  it("does not ask for an answer before the day the apprentice was needed", () => {
    expect(
      das142Alerts([request({ neededFrom: "2026-10-09", requestedOn: "2026-09-29" })], TODAY),
    ).toEqual([]);
  });

  it("keys the unsent branch and the no-answer branch differently", () => {
    const [unsent] = das142Alerts([request({ neededFrom: "2026-09-25" })], TODAY);
    const [unanswered] = das142Alerts(
      [request({ neededFrom: "2026-09-25", requestedOn: "2026-09-20" })],
      TODAY,
    );
    // Same row, same kind, two different situations. A dismissal of one must
    // not silence the other.
    expect(unsent.key).not.toBe(unanswered.key);
  });

  it("says an apprentice singular when one was requested", () => {
    const [one] = das142Alerts(
      [request({ neededFrom: "2026-10-09", apprenticesRequested: 1 })],
      TODAY,
    );
    expect(one.detail).toContain("an apprentice");
    const [many] = das142Alerts(
      [request({ neededFrom: "2026-10-09", apprenticesRequested: 3 })],
      TODAY,
    );
    expect(many.detail).toContain("3 apprentices");
  });
});

describe("the holiday caveat still runs the way the alert wording assumes", () => {
  it("says the real cut-off is EARLIER, never later", () => {
    // das142Alerts tells people a holiday makes the cut-off earlier than the
    // day it computed. That is only safe because the app's missing holiday
    // calendar can err in exactly one direction. If this caveat is ever
    // rewritten the other way, the alert sentence becomes a promise of time
    // somebody does not have — so it fails here rather than on a jobsite.
    const holidays = DAS142_LEAD_TIME_CAVEATS.find((line) => line.includes("Holidays"));
    expect(holidays, "a caveat about holidays").toBeTruthy();
    expect(holidays).toContain("EARLIER");
    expect(holidays).toContain("never later");
  });
});
