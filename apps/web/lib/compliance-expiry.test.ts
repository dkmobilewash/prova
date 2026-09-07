import { describe, expect, it } from "vitest";
import {
  RENEWAL_HORIZON_DAYS,
  classifyRenewal,
  daysUntil,
  renewalAlerts,
  renewalCoverage,
  renewalTiming,
  renewalUrgency,
  summarizeRenewals,
  toIsoDate,
  type RenewalSource,
} from "./compliance-expiry";

const TODAY = "2026-08-29";

const source = (over: Partial<RenewalSource> = {}): RenewalSource => ({
  id: "1",
  kind: "COMPLIANCE_DOCUMENT",
  title: "Certificate of insurance",
  detail: "Acme Drywall",
  date: null,
  expectsDate: true,
  href: "/compliance",
  ...over,
});

describe("daysUntil", () => {
  it("counts forward and backward from today", () => {
    expect(daysUntil("2026-09-05", TODAY)).toBe(7);
    expect(daysUntil("2026-08-20", TODAY)).toBe(-9);
    expect(daysUntil(TODAY, TODAY)).toBe(0);
  });

  it("is unaffected by a month or year boundary", () => {
    expect(daysUntil("2026-09-01", "2026-08-31")).toBe(1);
    expect(daysUntil("2027-01-01", "2026-12-31")).toBe(1);
  });
});

describe("renewalUrgency", () => {
  const horizon = RENEWAL_HORIZON_DAYS.COMPLIANCE_DOCUMENT;

  it("treats a date expiring TODAY as due, not expired", () => {
    // Cover runs through the end of its last day. Telling someone their
    // still-valid COI has already lapsed is how a warning stops being read.
    expect(renewalUrgency(TODAY, TODAY, horizon, true)).toBe("DUE_SOON");
  });

  it("is expired from the day after", () => {
    expect(renewalUrgency("2026-08-28", TODAY, horizon, true)).toBe("EXPIRED");
  });

  it("includes the horizon day itself and excludes the one past it", () => {
    expect(renewalUrgency("2026-09-28", TODAY, horizon, true)).toBe("DUE_SOON"); // +30
    expect(renewalUrgency("2026-09-29", TODAY, horizon, true)).toBe("CURRENT"); // +31
  });

  it("only calls a missing date a gap where a date is expected", () => {
    // A lien waiver never expires. Flagging every one of those forever
    // would bury the real warnings.
    expect(renewalUrgency(null, TODAY, horizon, true)).toBe("UNDATED");
    expect(renewalUrgency(null, TODAY, horizon, false)).toBe("CURRENT");
  });

  it("warns further ahead on the things that take longer to renew", () => {
    // A state licence board is not a phone call to a broker.
    const inFortyDays = "2026-10-08";
    expect(renewalUrgency(inFortyDays, TODAY, RENEWAL_HORIZON_DAYS.COMPLIANCE_DOCUMENT, true)).toBe(
      "CURRENT",
    );
    expect(renewalUrgency(inFortyDays, TODAY, RENEWAL_HORIZON_DAYS.LICENSE, true)).toBe("DUE_SOON");
  });
});

describe("classifyRenewal — a record that disagrees with itself", () => {
  it("reports a licence marked active whose date has passed", () => {
    const result = classifyRenewal(
      source({ kind: "LICENSE", date: "2026-01-01", storedStatus: "ACTIVE" }),
      TODAY,
    );
    expect(result.urgency).toBe("EXPIRED");
    expect(result.disagreement).toContain("date has passed");
  });

  it("reports a licence marked expired whose date has not", () => {
    const result = classifyRenewal(
      source({ kind: "LICENSE", date: "2027-01-01", storedStatus: "EXPIRED" }),
      TODAY,
    );
    expect(result.disagreement).toContain("has not passed");
  });

  it("stays quiet when the stored status and the date agree", () => {
    expect(
      classifyRenewal(source({ kind: "LICENSE", date: "2027-01-01", storedStatus: "ACTIVE" }), TODAY)
        .disagreement,
    ).toBeNull();
    expect(
      classifyRenewal(source({ kind: "LICENSE", date: "2026-01-01", storedStatus: "EXPIRED" }), TODAY)
        .disagreement,
    ).toBeNull();
  });

  it("has no opinion about records that store no status", () => {
    expect(classifyRenewal(source({ date: "2026-01-01" }), TODAY).disagreement).toBeNull();
  });
});

describe("renewalAlerts", () => {
  it("leaves out what is fine, so the list is only what needs doing", () => {
    const alerts = renewalAlerts(
      [source({ id: "fine", date: "2027-06-01" }), source({ id: "late", date: "2026-08-01" })],
      TODAY,
    );
    expect(alerts.map((a) => a.id)).toEqual(["late"]);
  });

  it("keeps a self-contradicting record even when its date looks fine", () => {
    // One of the two facts is wrong and no other page shows the conflict.
    const alerts = renewalAlerts(
      [source({ id: "conflict", kind: "LICENSE", date: "2027-01-01", storedStatus: "EXPIRED" })],
      TODAY,
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].urgency).toBe("CURRENT");
  });

  it("puts expired before due, and longest-lapsed before both", () => {
    const alerts = renewalAlerts(
      [
        source({ id: "due-later", date: "2026-09-20" }),
        source({ id: "expired-recent", date: "2026-08-25" }),
        source({ id: "due-soon", date: "2026-09-01" }),
        source({ id: "expired-long", date: "2026-02-01" }),
        source({ id: "undated", date: null }),
      ],
      TODAY,
    );
    expect(alerts.map((a) => a.id)).toEqual([
      "expired-long",
      "expired-recent",
      "due-soon",
      "due-later",
      "undated",
    ]);
  });

  it("breaks a tie by title so the order never shuffles between renders", () => {
    const alerts = renewalAlerts(
      [
        source({ id: "b", title: "Zebra", date: "2026-09-01" }),
        source({ id: "a", title: "Apple", date: "2026-09-01" }),
      ],
      TODAY,
    );
    expect(alerts.map((a) => a.title)).toEqual(["Apple", "Zebra"]);
  });

  it("has nothing to say when everything is in order", () => {
    expect(renewalAlerts([source({ date: "2027-01-01" })], TODAY)).toEqual([]);
    expect(renewalAlerts([], TODAY)).toEqual([]);
  });
});

describe("summarizeRenewals", () => {
  it("counts each state separately", () => {
    const alerts = renewalAlerts(
      [
        source({ id: "1", date: "2026-08-01" }),
        source({ id: "2", date: "2026-09-01" }),
        source({ id: "3", date: null }),
        source({ id: "4", kind: "LICENSE", date: "2027-01-01", storedStatus: "EXPIRED" }),
      ],
      TODAY,
    );
    expect(summarizeRenewals(alerts)).toEqual({
      expired: 1,
      dueSoon: 1,
      undated: 1,
      disagreeing: 1,
      total: 4,
    });
  });
});

describe("renewalTiming", () => {
  const timing = (date: string | null) => renewalTiming(classifyRenewal(source({ date }), TODAY));

  it("words each state the way a person would say it", () => {
    expect(timing("2026-08-20")).toBe("expired 9 days ago");
    expect(timing("2026-08-28")).toBe("expired 1 day ago");
    expect(timing(TODAY)).toBe("due today");
    expect(timing("2026-08-30")).toBe("due in 1 day");
    expect(timing("2026-09-05")).toBe("due in 7 days");
    expect(timing(null)).toBe("no date recorded");
  });
});

describe("toIsoDate", () => {
  it("reads the date a UTC-midnight timestamp represents", () => {
    // Dates are stored at UTC midnight and rendered in UTC throughout.
    expect(toIsoDate(new Date("2026-08-29T00:00:00.000Z"))).toBe("2026-08-29");
    expect(toIsoDate(null)).toBeNull();
    expect(toIsoDate(undefined)).toBeNull();
  });
});

describe("renewalCoverage", () => {
  const current = source({ date: "2027-01-01" });

  // The finding. `renewalAlerts` drops everything CURRENT, so an empty
  // result says nothing about why it is empty — and the whole compliance
  // system reads EXISTING rows, so a company that never filed a COI
  // produces the same empty array as one whose COI is in date. /compliance
  // printed "Certificates, licences, policies and bonds are all current."
  // about forty pixels above "No compliance documents yet."
  it("does not report all-current when nothing is on file", () => {
    expect(renewalCoverage([], 0)).toBe("NOTHING_TRACKED");
    expect(renewalCoverage([], 0)).not.toBe("ALL_CURRENT");
  });

  it("reports all-current only when something was actually checked", () => {
    expect(renewalCoverage(renewalAlerts([current], TODAY), 1)).toBe("ALL_CURRENT");
  });

  it("reports alerts whenever there are any", () => {
    const expired = renewalAlerts([source({ date: "2026-08-01" })], TODAY);
    expect(expired.length).toBe(1);
    expect(renewalCoverage(expired, 1)).toBe("HAS_ALERTS");
    // Even a tracked count of zero cannot silence a real alert.
    expect(renewalCoverage(expired, 0)).toBe("HAS_ALERTS");
  });
});
