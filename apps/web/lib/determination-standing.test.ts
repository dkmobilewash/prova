import { describe, expect, it } from "vitest";
import {
  addDays,
  determinationStanding,
  determinationStandingLine,
  dirIssueWindow,
  nextDirIssueAfter,
  type DeterminationFacts,
  type DeterminationMarker,
} from "./determination-standing";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const TODAY = "2026-09-22";

/** A DIR 2026-1 determination: issued 22 Feb 2026, effective 4 Mar 2026
 * (2026 is not a leap year), superseded by 2026-2 on 1 Sep 2026. */
function row(over: Partial<DeterminationFacts> = {}): DeterminationFacts {
  return { issuedOn: day("2026-02-22"), expiresOn: day("2026-06-30"), expirationMarker: "DOUBLE", ...over };
}
const job = (advertised: string | null) => ({ bidAdvertisedOn: advertised ? day(advertised) : null });

describe("the DIR calendar — twice a year, effective ten days after issue", () => {
  it("22 Feb takes effect 4 Mar in a non-leap year and 3 Mar in a leap year", () => {
    expect(addDays("2026-02-22", 10)).toBe("2026-03-04");
    expect(addDays("2028-02-22", 10)).toBe("2028-03-03");
  });

  it("22 Aug takes effect 1 Sep", () => {
    expect(addDays("2026-08-22", 10)).toBe("2026-09-01");
  });

  it("the next scheduled issue is strictly after the given date, rolling into the next year", () => {
    expect(nextDirIssueAfter("2026-02-22")).toBe("2026-08-22");
    expect(nextDirIssueAfter("2026-02-21")).toBe("2026-02-22");
    expect(nextDirIssueAfter("2026-08-22")).toBe("2027-02-22");
    expect(nextDirIssueAfter("2026-12-31")).toBe("2027-02-22");
    // Off-cycle: a special determination issued in May is superseded by August's.
    expect(nextDirIssueAfter("2026-05-10")).toBe("2026-08-22");
  });

  it("the in-force window runs from its own effective day up to the next issue's", () => {
    expect(dirIssueWindow("2026-02-22")).toEqual({ effectiveOn: "2026-03-04", supersededOn: "2026-09-01" });
    expect(dirIssueWindow("2026-08-22")).toEqual({ effectiveOn: "2026-09-01", supersededOn: "2027-03-04" });
  });
});

describe("determinationStanding — the plan's own example, and the trap it warns about", () => {
  it("Lincoln Middle School: advertised 10 Aug 2026 is governed by 2026-1, the OLDER issue", () => {
    const standing = determinationStanding(row(), job("2026-08-10"), "2026-06-01");
    expect(standing).toMatchObject({ kind: "in_force", advertisedOn: "2026-08-10", effectiveOn: "2026-03-04" });
  });

  it("the 2026-2 issue (22 Aug) is the WRONG issue for a job advertised 10 Aug, even though it is newer", () => {
    const newer = row({ issuedOn: day("2026-08-22") });
    const standing = determinationStanding(newer, job("2026-08-10"), TODAY);
    expect(standing.kind).toBe("wrong_issue");
    if (standing.kind !== "wrong_issue") throw new Error("unreachable");
    expect(standing.effectiveOn).toBe("2026-09-01");
    expect(standing.detail).toContain("took effect Sep 1, 2026, after the job was advertised");
  });

  it("click-list 8: move the ad date to 15 Sep 2026 and the 2026-1 row flips to wrong issue", () => {
    const standing = determinationStanding(row(), job("2026-09-15"), TODAY);
    expect(standing.kind).toBe("wrong_issue");
    if (standing.kind !== "wrong_issue") throw new Error("unreachable");
    expect(standing.supersededOn).toBe("2026-09-01");
    expect(standing.detail).toContain("the next issue took effect Sep 1, 2026, before the job was advertised");
    expect(determinationStandingLine(standing).text).toContain(
      "Not the determination in force on your bid-advertisement date (Sep 15, 2026)",
    );
  });
});

describe("the boundary days — each side of the ten-day lag, at both issues", () => {
  const cases: [advertised: string, expected: "in_force" | "wrong_issue"][] = [
    ["2026-03-03", "wrong_issue"], // the day before 2026-1 takes effect
    ["2026-03-04", "in_force"], // the effective day itself
    ["2026-08-22", "in_force"], // 2026-2's ISSUE day: 2026-1 still governs for ten more days
    ["2026-08-31", "in_force"], // the last day before 2026-2 takes effect
    ["2026-09-01", "wrong_issue"], // 2026-2's effective day
  ];
  for (const [advertised, expected] of cases) {
    it(`a 2026-1 row against a job advertised ${advertised} is ${expected}`, () => {
      expect(determinationStanding(row({ expiresOn: null, expirationMarker: null }), job(advertised), TODAY).kind).toBe(expected);
    });
  }
});

describe("after the expiration date, the asterisk decides", () => {
  it("double asterisk, expiration passed: a predetermined increase is due", () => {
    const standing = determinationStanding(row(), job("2026-08-10"), TODAY);
    expect(standing).toEqual({ kind: "increase_due", advertisedOn: "2026-08-10", since: "2026-06-30" });
    expect(determinationStandingLine(standing)).toEqual({
      text: "Expiration Jun 30, 2026 has passed and this determination carries a predetermined increase (**) — the rate step is on DIR's increase sheet. Open it.",
      tone: "bad",
    });
  });

  it("single asterisk, expiration passed: holds for the life of the project", () => {
    const standing = determinationStanding(row({ expirationMarker: "SINGLE" }), job("2026-08-10"), TODAY);
    expect(standing).toEqual({ kind: "life_of_project", advertisedOn: "2026-08-10", since: "2026-06-30" });
    expect(determinationStandingLine(standing).tone).toBe("ok");
  });

  it("the expiration day itself is not yet past", () => {
    expect(determinationStanding(row(), job("2026-08-10"), "2026-06-30").kind).toBe("in_force");
    expect(determinationStanding(row(), job("2026-08-10"), "2026-07-01").kind).toBe("increase_due");
  });

  it("expiration passed with NO marker recorded is in force with a named gap, never a guess either way", () => {
    const standing = determinationStanding(row({ expirationMarker: null }), job("2026-08-10"), TODAY);
    expect(standing).toMatchObject({ kind: "in_force", expiryPassedUnmarked: true });
    const line = determinationStandingLine(standing);
    expect(line.tone).toBe("warn");
    expect(line.text).toContain("the asterisk after it wasn't recorded");
  });

  it("NONE is a fact somebody entered, not a gap", () => {
    const standing = determinationStanding(row({ expirationMarker: "NONE" }), job("2026-08-10"), TODAY);
    expect(standing).toMatchObject({ kind: "in_force", expiryPassedUnmarked: false });
    expect(determinationStandingLine(standing).tone).toBe("ok");
  });

  it("the wrong issue outranks an increase — the bigger problem is named first", () => {
    const standing = determinationStanding(row({ issuedOn: day("2026-08-22") }), job("2026-08-10"), TODAY);
    expect(standing.kind).toBe("wrong_issue");
  });
});

describe("unchecked — nothing to judge, and it says which date is missing", () => {
  it("no bid-advertisement date on the job", () => {
    const standing = determinationStanding(row(), job(null), TODAY);
    expect(standing.kind).toBe("unchecked");
    expect(determinationStandingLine(standing).text).toBe(
      "Unchecked — the job's bid-advertisement date hasn't been entered, and that date is what picks the determination in force.",
    );
  });

  it("no issue date on the determination — every row that predates these columns", () => {
    const standing = determinationStanding(row({ issuedOn: null }), job("2026-08-10"), TODAY);
    expect(standing).toEqual({ kind: "unchecked", reason: "this determination's issue date hasn't been entered." });
    expect(determinationStandingLine(standing).tone).toBe("none");
  });
});

describe("the in-force line names the expiration and what the mark means", () => {
  const cases: [marker: DeterminationMarker | null, fragment: string][] = [
    ["DOUBLE", "Expires Jun 30, 2027 (**) — a predetermined increase applies to work after that date."],
    ["SINGLE", "Expires Jun 30, 2027 (*) — holds for the life of the project after that."],
    ["NONE", "Expires Jun 30, 2027."],
    [null, "Expires Jun 30, 2027."],
  ];
  for (const [marker, fragment] of cases) {
    it(`marker ${marker}`, () => {
      const standing = determinationStanding(
        row({ expiresOn: day("2027-06-30"), expirationMarker: marker }),
        job("2026-08-10"),
        TODAY,
      );
      const line = determinationStandingLine(standing);
      expect(line.text).toBe(`In force on Aug 10, 2026, when the job was advertised. ${fragment}`);
      expect(line.tone).toBe("ok");
    });
  }

  it("no expiration entered: just the in-force sentence", () => {
    const standing = determinationStanding(row({ expiresOn: null }), job("2026-08-10"), TODAY);
    expect(determinationStandingLine(standing).text).toBe("In force on Aug 10, 2026, when the job was advertised.");
  });
});
