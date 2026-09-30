/**
 * THE FOUR FIELD ALERTS, AND THE ONE THING THEY ALL REFUSE TO SAY.
 *
 * WHY THIS FILE IS SEPARATE from `alerts.test.ts`. Not size — shape. The
 * eleven older kinds are each about a document or a dollar, and their tests
 * are about dates and money. These four are about rows a CREW produced, and
 * every one of them has the same seam: a record that carries a date, and a
 * record that does not. The interesting assertions are all about the second
 * case, so they read better together than scattered through a file
 * organised by subject.
 *
 * WHAT EACH BUILDER MUST GET RIGHT, and it is the same list four times:
 *
 *   DATED — where a date exists, OVERDUE past it and DUE_SOON inside the
 *   horizon, and SILENT outside it. A bell that rings about everything is a
 *   bell nobody reads.
 *
 *   UNDATED — where no date exists, STANDING after a named chase window and
 *   SILENT before it. Never OVERDUE. This is the assertion that matters
 *   most and the one a careless change would break first: "overdue" against
 *   a date nobody recorded is a claim about a contract this app has never
 *   read, and `operations.prisma` says why in as many words — "a guessed
 *   date is worse than no date, because 'late' would then be measured
 *   against a guess".
 *
 *   QUIET WHEN SETTLED — a delivered order, a punch item somebody marked
 *   ready, equipment that came back, a delay the GC was told about. Each of
 *   those must produce nothing, and each is a separate test, because "it
 *   fires correctly" and "it stops firing" are different properties and
 *   only the first one is obvious.
 *
 * THE KEY IS ASSERTED, NOT ASSUMED. `alertKey` folds in the fact that would
 * change what the alert says, so dating an undated record has to produce a
 * DIFFERENT key — otherwise a dismissal of the vague version silences the
 * specific one, which is the bug `alertKey`'s own header describes.
 */

import { describe, expect, it } from "vitest";
import {
  DELAY_NOTICE_GRACE_DAYS,
  DELIVERY_CHASE_DAYS,
  EQUIPMENT_OUT_DAYS,
  PUNCH_CHASE_DAYS,
  delayNoticeAlerts,
  equipmentOutAlerts,
  materialDeliveryAlerts,
  punchItemAlerts,
  type DelayNoticeAlertSource,
  type EquipmentOutAlertSource,
  type MaterialDeliveryAlertSource,
  type PunchItemAlertSource,
} from "./alerts";

const TODAY = "2026-09-29";

/** A day offset from TODAY, so no test carries a hand-computed date that a
 * reader has to verify with a calendar. */
function day(offset: number): string {
  return new Date(Date.parse(`${TODAY}T00:00:00.000Z`) + offset * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function order(over: Partial<MaterialDeliveryAlertSource> = {}): MaterialDeliveryAlertSource {
  return {
    id: "mo1",
    number: 7,
    description: "20ga 3-5/8 metal stud",
    jobName: "Riverside",
    vendorName: "Hughes Supply",
    promisedFor: null,
    orderedOn: day(-1),
    isComplete: false,
    ...over,
  };
}

function punch(over: Partial<PunchItemAlertSource> = {}): PunchItemAlertSource {
  return {
    id: "pi1",
    description: "Patch the corridor soffit",
    jobName: "Riverside",
    area: null,
    dueOn: null,
    raisedOn: day(-1),
    ...over,
  };
}

function kit(over: Partial<EquipmentOutAlertSource> = {}): EquipmentOutAlertSource {
  return {
    id: "ea1",
    equipmentName: "Scissor lift #3",
    jobName: "Riverside",
    jobIsFinished: false,
    sentOutOn: day(-1),
    ...over,
  };
}

function delay(over: Partial<DelayNoticeAlertSource> = {}): DelayNoticeAlertSource {
  return {
    id: "de1",
    jobId: "job1",
    jobName: "Riverside",
    date: day(-10),
    description: "Electricians had not pulled out of the third floor",
    hoursLost: 16,
    ...over,
  };
}

describe("materialDeliveryAlerts", () => {
  it("raises OVERDUE on a promised date that has passed, naming the vendor", () => {
    const [alert] = materialDeliveryAlerts([order({ promisedFor: day(-4) })], TODAY);
    expect(alert.severity).toBe("OVERDUE");
    expect(alert.kind).toBe("MATERIAL_DELIVERY_LATE");
    expect(alert.detail).toContain("Hughes Supply");
    expect(alert.detail).toContain("20ga 3-5/8 metal stud");
    expect(alert.daysUntil).toBe(-4);
    expect(alert.href).toBe("/material-orders");
  });

  it("warns inside the horizon and stays quiet outside it", () => {
    expect(materialDeliveryAlerts([order({ promisedFor: day(3) })], TODAY)[0].severity).toBe(
      "DUE_SOON",
    );
    expect(materialDeliveryAlerts([order({ promisedFor: day(90) })], TODAY)).toEqual([]);
  });

  it("goes quiet once a delivery completes the order", () => {
    expect(
      materialDeliveryAlerts([order({ promisedFor: day(-30), isComplete: true })], TODAY),
    ).toEqual([]);
  });

  it("with NO promised date it is STANDING after the chase window, never OVERDUE", () => {
    const [alert] = materialDeliveryAlerts(
      [order({ promisedFor: null, orderedOn: day(-DELIVERY_CHASE_DAYS - 1) })],
      TODAY,
    );
    expect(alert.severity).toBe("STANDING");
    // The sentence has to say what it does NOT know, or a reader takes the
    // silence for a met deadline.
    expect(alert.detail).toContain("no promised date recorded");
  });

  it("with NO promised date it says nothing before the chase window", () => {
    expect(
      materialDeliveryAlerts(
        [order({ promisedFor: null, orderedOn: day(-DELIVERY_CHASE_DAYS + 1) })],
        TODAY,
      ),
    ).toEqual([]);
  });

  it("rekeys when a promised date is finally recorded, so the vague dismissal lapses", () => {
    const vague = materialDeliveryAlerts(
      [order({ promisedFor: null, orderedOn: day(-DELIVERY_CHASE_DAYS - 1) })],
      TODAY,
    )[0];
    const dated = materialDeliveryAlerts([order({ promisedFor: day(-2) })], TODAY)[0];
    expect(dated.key).not.toBe(vague.key);
  });
});

describe("punchItemAlerts", () => {
  it("raises OVERDUE past the due date and names the area when there is one", () => {
    const [alert] = punchItemAlerts([punch({ dueOn: day(-3), area: "West corridor" })], TODAY);
    expect(alert.severity).toBe("OVERDUE");
    expect(alert.title).toContain("West corridor");
    expect(alert.href).toBe("/punch-lists");
  });

  it("omits the area from the title when none is recorded", () => {
    const [alert] = punchItemAlerts([punch({ dueOn: day(-3), area: null })], TODAY);
    expect(alert.title).toContain("Riverside");
    expect(alert.title).not.toContain("—");
  });

  it("warns inside the horizon and stays quiet outside it", () => {
    expect(punchItemAlerts([punch({ dueOn: day(5) })], TODAY)[0].severity).toBe("DUE_SOON");
    expect(punchItemAlerts([punch({ dueOn: day(60) })], TODAY)).toEqual([]);
  });

  it("with NO due date it is STANDING after the chase window and silent before it", () => {
    const [alert] = punchItemAlerts([punch({ raisedOn: day(-PUNCH_CHASE_DAYS - 1) })], TODAY);
    expect(alert.severity).toBe("STANDING");
    expect(alert.detail).toContain("no due date recorded");
    expect(punchItemAlerts([punch({ raisedOn: day(-PUNCH_CHASE_DAYS + 1) })], TODAY)).toEqual([]);
  });
});

describe("equipmentOutAlerts", () => {
  it("is STANDING after the window and never dated, because no return is ever promised", () => {
    const [alert] = equipmentOutAlerts([kit({ sentOutOn: day(-EQUIPMENT_OUT_DAYS - 1) })], TODAY);
    expect(alert.severity).toBe("STANDING");
    expect(alert.detail).toContain("Scissor lift #3".slice(0, 0) + "nothing records it coming back");
  });

  it("says nothing about a recent assignment on a running job", () => {
    expect(equipmentOutAlerts([kit({ sentOutOn: day(-2) })], TODAY)).toEqual([]);
  });

  it("fires IMMEDIATELY on a finished job, with a different sentence", () => {
    // The window is about a lift sitting somewhere it is still needed. On a
    // job nobody is working, one day is already wrong, so the window does
    // not apply and the wording changes to say which fact it is about.
    const [alert] = equipmentOutAlerts([kit({ sentOutOn: day(-1), jobIsFinished: true })], TODAY);
    expect(alert.severity).toBe("STANDING");
    expect(alert.title).toContain("finished job");
    expect(alert.detail).toContain("no longer running");
  });
});

describe("delayNoticeAlerts", () => {
  it("raises a STANDING alert for a delay with no notice recorded", () => {
    const [alert] = delayNoticeAlerts([delay()], TODAY);
    expect(alert.kind).toBe("DELAY_GC_NOT_TOLD");
    expect(alert.severity).toBe("STANDING");
    expect(alert.detail).toContain("Nothing records the GC being told");
    // Job-scoped, because the delay log lives on the job's own field
    // reports tab and a company-wide list would not reach the row.
    expect(alert.href).toBe("/jobs/job1/field-reports");
  });

  it("is NEVER overdue, however old the delay is", () => {
    // The assertion this whole family turns on. A subcontract's notice
    // period is legal advice the app refuses to generate, so a delay from
    // last spring is still STANDING — it is not "late" against anything
    // this app has been told.
    const [alert] = delayNoticeAlerts([delay({ date: day(-400) })], TODAY);
    expect(alert.severity).toBe("STANDING");
    expect(alert.detail).toContain("not one this app can answer");
  });

  it("holds off inside the grace window, so filing a report does not ring the bell", () => {
    expect(delayNoticeAlerts([delay({ date: day(-DELAY_NOTICE_GRACE_DAYS + 1) })], TODAY)).toEqual(
      [],
    );
  });

  it("names the hours lost when there are any, and omits the clause when there are none", () => {
    expect(delayNoticeAlerts([delay({ hoursLost: 16 })], TODAY)[0].detail).toContain(
      "16 crew hours lost",
    );
    expect(delayNoticeAlerts([delay({ hoursLost: null })], TODAY)[0].detail).not.toContain(
      "crew hours lost",
    );
    // Zero is not "no hours" in the data, but it is in the sentence: a delay
    // with 0 recorded reads as a paperwork gap rather than a loss.
    expect(delayNoticeAlerts([delay({ hoursLost: 0 })], TODAY)[0].detail).not.toContain(
      "crew hours lost",
    );
  });

  it("carries no amount, because crew hours are not money", () => {
    // `amount` orders alerts within a severity by money riding on them. An
    // hours figure here would sort a 16-hour delay as though it were $16.
    expect(delayNoticeAlerts([delay()], TODAY)[0].amount).toBeNull();
  });
});
