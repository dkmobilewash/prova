import { describe, expect, it } from "vitest";
import {
  CERTIFICATION_HORIZON_DAYS,
  CERTIFICATION_KINDS,
  certificationKey,
  certificationTitle,
  governingCertification,
  jobCrewStanding,
  rosterStanding,
  standingOf,
  standingTiming,
  summarizeRoster,
  type CertificationRecord,
  type CertificationStanding,
  type Holding,
  type RequirementRecord,
} from "./certifications";

const TODAY = "2026-09-03";

function card(over: Partial<CertificationRecord> & { id: string }): CertificationRecord {
  return {
    kind: "OSHA_10",
    otherLabel: null,
    issuer: null,
    referenceNumber: null,
    issuedOn: null,
    expiresOn: null,
    notes: null,
    documentUrl: null,
    documentLabel: null,
    ...over,
  };
}

function held(holderUserId: string, over: Partial<CertificationRecord> & { id: string }) {
  return { ...card(over), holderUserId };
}

const requires = (kind: RequirementRecord["kind"], otherLabel = ""): RequirementRecord => ({
  id: `req-${kind}-${otherLabel}`,
  kind,
  otherLabel,
  notes: null,
});

describe("standingOf", () => {
  it("reads a past date as expired", () => {
    expect(standingOf("2026-09-02", TODAY, 30)).toBe("EXPIRED");
  });

  it("treats the expiry day itself as still valid, not expired", () => {
    // The same boundary compliance-expiry.ts draws for a COI: cover runs
    // through the end of its last day, and telling someone their valid card
    // has lapsed is how people learn to ignore the page.
    expect(standingOf(TODAY, TODAY, 30)).toBe("EXPIRING");
  });

  it("warns inside the horizon and stays quiet outside it", () => {
    expect(standingOf("2026-10-03", TODAY, 30)).toBe("EXPIRING");
    expect(standingOf("2026-10-04", TODAY, 30)).toBe("CURRENT");
  });

  it("NEVER reads a blank expiry as current", () => {
    // The whole point: a card nobody dated is unchecked, not valid. If this
    // ever returns CURRENT, an undated lapsed card sits on a green screen.
    expect(standingOf(null, TODAY, 30)).toBe("UNDATED");
  });
});

describe("horizons", () => {
  it("covers every kind, so no kind silently falls back to zero days", () => {
    for (const kind of CERTIFICATION_KINDS) {
      expect(CERTIFICATION_HORIZON_DAYS[kind]).toBeGreaterThan(0);
    }
  });

  it("gives a classroom course more warning than an appointment", () => {
    // A 30-hour course needs a seat booked; a fit test is a half day.
    expect(CERTIFICATION_HORIZON_DAYS.OSHA_30).toBeGreaterThan(
      CERTIFICATION_HORIZON_DAYS.RESPIRATOR_FIT_TEST,
    );
  });
});

describe("certificationKey", () => {
  it("is the kind for everything but OTHER", () => {
    expect(certificationKey("OSHA_10", "ignored")).toBe("OSHA_10");
  });

  it("matches an OTHER label regardless of case and padding", () => {
    expect(certificationKey("OTHER", " Turner Site Orientation ")).toBe(
      certificationKey("OTHER", "turner site orientation"),
    );
  });

  it("keeps two different OTHER labels apart", () => {
    expect(certificationKey("OTHER", "badge")).not.toBe(certificationKey("OTHER", "orientation"));
  });
});

describe("certificationTitle", () => {
  it("falls back to the generic word when an OTHER row has no label", () => {
    expect(certificationTitle("OTHER", "  ")).toBe("Other");
  });

  it("uses the label when there is one", () => {
    expect(certificationTitle("OTHER", "Turner orientation")).toBe("Turner orientation");
  });
});

describe("governingCertification", () => {
  it("says MISSING when there is nothing at all", () => {
    const result = governingCertification([], TODAY);
    expect(result.standing).toBe("MISSING");
    expect(result.governing).toBeNull();
  });

  it("lets a renewal supersede the expired card it replaces", () => {
    const result = governingCertification(
      [
        card({ id: "old", expiresOn: "2026-01-01" }),
        card({ id: "new", expiresOn: "2027-06-01" }),
      ],
      TODAY,
    );
    expect(result.governing?.id).toBe("new");
    expect(result.standing).toBe("CURRENT");
  });

  it("picks the LATER of two current cards, so days-until is the real one", () => {
    const result = governingCertification(
      [
        card({ id: "sooner", expiresOn: "2026-12-01" }),
        card({ id: "later", expiresOn: "2027-12-01" }),
      ],
      TODAY,
    );
    expect(result.governing?.id).toBe("later");
  });

  it("reads an expired card next to an undated one as UNDATED, not EXPIRED", () => {
    // Two records, neither of which proves the man is lapsed: one says the
    // card ran out, the other says nobody wrote a date down. Claiming
    // EXPIRED asserts something nobody recorded; claiming CURRENT is worse.
    // "Go and look at the card" is the true answer.
    const result = governingCertification(
      [card({ id: "expired", expiresOn: "2026-01-01" }), card({ id: "undated" })],
      TODAY,
    );
    expect(result.standing).toBe("UNDATED");
    expect(result.governing?.id).toBe("undated");
  });

  it("never lets an undated card outrank a dated one that is still good", () => {
    const result = governingCertification(
      [card({ id: "undated" }), card({ id: "good", expiresOn: "2027-06-01" })],
      TODAY,
    );
    expect(result.standing).toBe("CURRENT");
    expect(result.governing?.id).toBe("good");
  });

  it("reports days until expiry off the governing record", () => {
    const result = governingCertification([card({ id: "a", expiresOn: "2026-09-13" })], TODAY);
    expect(result.daysUntil).toBe(10);
  });
});

const ALICE = { id: "u1", name: "Alice Reyes", email: "alice@example.test" };
const BEN = { id: "u2", name: null, email: "ben@example.test" };

describe("rosterStanding", () => {
  it("turns a requirement nobody has met into a named finding", () => {
    // The dangerous case: a worker with NO row looks identical to a worker
    // who does not need it. Without the requirement there is no row to
    // find, which is what makes this the point of the whole model.
    const roster = rosterStanding([ALICE], [], [requires("OSHA_10")], TODAY);
    expect(roster[0].problems).toHaveLength(1);
    expect(roster[0].problems[0].standing).toBe("MISSING");
    expect(roster[0].problems[0].title).toBe("OSHA 10");
    expect(roster[0].worst).toBe("MISSING");
  });

  it("does not invent findings for things nobody requires", () => {
    const roster = rosterStanding([ALICE], [], [], TODAY);
    expect(roster[0].problems).toHaveLength(0);
    expect(roster[0].worst).toBe("CURRENT");
  });

  it("keeps a current card out of the problem list but in the file", () => {
    const roster = rosterStanding(
      [ALICE],
      [held("u1", { id: "c1", expiresOn: "2027-06-01" })],
      [requires("OSHA_10")],
      TODAY,
    );
    expect(roster[0].problems).toHaveLength(0);
    expect(roster[0].holdings).toHaveLength(1);
    expect(roster[0].holdings[0].required).toBe(true);
  });

  it("reports a card that is held but NOT required, when it has lapsed", () => {
    // Nobody required a fit test, but one was entered and it has run out.
    // Silence here would be the app hiding a fact it was told.
    const roster = rosterStanding(
      [ALICE],
      [held("u1", { id: "c1", kind: "RESPIRATOR_FIT_TEST", expiresOn: "2026-01-01" })],
      [],
      TODAY,
    );
    expect(roster[0].problems).toHaveLength(1);
    expect(roster[0].problems[0].standing).toBe("EXPIRED");
    expect(roster[0].problems[0].required).toBe(false);
  });

  it("groups a renewal with the card it replaces instead of listing two problems", () => {
    const roster = rosterStanding(
      [ALICE],
      [
        held("u1", { id: "old", expiresOn: "2026-01-01" }),
        held("u1", { id: "new", expiresOn: "2027-01-01" }),
      ],
      [requires("OSHA_10")],
      TODAY,
    );
    expect(roster[0].holdings).toHaveLength(1);
    expect(roster[0].holdings[0].history).toHaveLength(2);
    expect(roster[0].holdings[0].governing?.id).toBe("new");
    expect(roster[0].problems).toHaveLength(0);
  });

  it("matches an OTHER card against an OTHER requirement across casing", () => {
    const roster = rosterStanding(
      [ALICE],
      [
        held("u1", {
          id: "c1",
          kind: "OTHER",
          otherLabel: "Turner Site Orientation",
          expiresOn: "2027-01-01",
        }),
      ],
      [requires("OTHER", "turner site orientation")],
      TODAY,
    );
    expect(roster[0].holdings).toHaveLength(1);
    expect(roster[0].problems).toHaveLength(0);
  });

  it("never attributes one person's card to another", () => {
    const roster = rosterStanding(
      [ALICE, BEN],
      [held("u1", { id: "c1", expiresOn: "2027-01-01" })],
      [requires("OSHA_10")],
      TODAY,
    );
    const ben = roster.find((row) => row.worker.id === "u2");
    expect(ben?.problems[0].standing).toBe("MISSING");
  });

  it("sorts the worst-off person first", () => {
    const roster = rosterStanding(
      [ALICE, BEN],
      [
        held("u1", { id: "c1", expiresOn: "2026-09-20" }), // expiring
        held("u2", { id: "c2", expiresOn: "2026-01-01" }), // expired
      ],
      [],
      TODAY,
    );
    expect(roster[0].worker.id).toBe("u2");
  });
});

describe("summarizeRoster", () => {
  it("counts PEOPLE with problems, not cards", () => {
    // Four lapsed cards on one man is one man to sort out. Counting cards
    // makes a single careless worker look like a company-wide failure.
    const roster = rosterStanding(
      [ALICE, BEN],
      [
        held("u1", { id: "a", kind: "OSHA_10", expiresOn: "2026-01-01" }),
        held("u1", { id: "b", kind: "AERIAL_LIFT", expiresOn: "2026-01-01" }),
        held("u1", { id: "c", kind: "FALL_PROTECTION", expiresOn: "2026-01-01" }),
      ],
      [],
      TODAY,
    );
    const summary = summarizeRoster(roster);
    expect(summary.expired).toBe(3);
    expect(summary.workersWithProblems).toBe(1);
    expect(summary.workers).toBe(2);
  });

  it("counts an undated card separately from an expired one", () => {
    const roster = rosterStanding(
      [ALICE],
      [held("u1", { id: "a", kind: "SILICA_AWARENESS" })],
      [],
      TODAY,
    );
    const summary = summarizeRoster(roster);
    expect(summary.undated).toBe(1);
    expect(summary.expired).toBe(0);
  });
});

describe("jobCrewStanding", () => {
  const roster = () =>
    rosterStanding(
      [ALICE, BEN],
      [held("u1", { id: "c1", expiresOn: "2027-01-01" })],
      [requires("OSHA_10")],
      TODAY,
    );

  it("names only the assigned crew who are short", () => {
    const crews = jobCrewStanding(
      [{ id: "j1", name: "Maple Street", crew: ["u1", "u2"] }],
      roster(),
    );
    expect(crews).toHaveLength(1);
    expect(crews[0].crewSize).toBe(2);
    expect(crews[0].short.map((row) => row.worker.id)).toEqual(["u2"]);
  });

  it("drops a job whose whole crew is clear", () => {
    const crews = jobCrewStanding([{ id: "j1", name: "Maple Street", crew: ["u1"] }], roster());
    expect(crews).toEqual([]);
  });

  it("drops a job with nobody assigned rather than calling it clear", () => {
    // An empty crew has no answer, not a good one. Rendering it as clear
    // would tell a PM the job is covered when nobody is on it.
    const crews = jobCrewStanding([{ id: "j1", name: "Unstaffed", crew: [] }], roster());
    expect(crews).toEqual([]);
  });

  it("ignores an assignment for somebody who is no longer on the roster", () => {
    const crews = jobCrewStanding(
      [{ id: "j1", name: "Maple Street", crew: ["u2", "ghost"] }],
      roster(),
    );
    expect(crews[0].short.map((row) => row.worker.id)).toEqual(["u2"]);
  });
});

describe("standingTiming", () => {
  const holding = (standing: CertificationStanding, days: number | null): Holding => ({
    key: "k",
    kind: "OSHA_10",
    otherLabel: null,
    title: "OSHA 10",
    standing,
    daysUntil: days,
    required: true,
    governing: null,
    history: [],
  });

  it("says nothing recorded for a gap, rather than a date", () => {
    expect(standingTiming(holding("MISSING", null))).toBe("nothing recorded");
  });

  it("says how long ago it lapsed", () => {
    expect(standingTiming(holding("EXPIRED", -1))).toBe("expired 1 day ago");
    expect(standingTiming(holding("EXPIRED", -9))).toBe("expired 9 days ago");
  });

  it("says today rather than 'in 0 days'", () => {
    expect(standingTiming(holding("EXPIRING", 0))).toBe("expires today");
  });

  it("names the blank for what it is", () => {
    expect(standingTiming(holding("UNDATED", null))).toBe("no expiry date recorded");
  });
});
