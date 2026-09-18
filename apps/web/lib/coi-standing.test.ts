import { describe, expect, it } from "vitest";
import { coiStandingFor, coiStandingLine, governingCois, supersededCoiIds, type CoiRow } from "./coi-standing";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const TODAY = "2026-09-18";

function coi(id: string, partyName: string, coverageType: string | null, expires: string | null, jobId: string | null = null): CoiRow {
  return { id, partyName, coverageType, jobId, expiresAt: expires ? day(expires) : null };
}

describe("supersededCoiIds — a renewal replaces only the same party, job and line", () => {
  it("the later GL row replaces the earlier one", () => {
    const rows = [coi("old", "Acme", "General liability", "2025-09-01"), coi("new", "ACME ", "general liability", "2026-09-01")];
    expect([...supersededCoiIds(rows)]).toEqual(["old"]);
  });

  it("a later AUTO row never hides an earlier GL row — each line lapses on its own", () => {
    const rows = [coi("gl", "Acme", "General liability", "2026-09-01"), coi("auto", "Acme", "Automobile liability", "2026-12-01")];
    expect(supersededCoiIds(rows).size).toBe(0);
  });

  it("a job-level certificate and a company-level one do not replace each other", () => {
    const rows = [coi("co", "Acme", "General liability", "2025-01-01"), coi("job", "Acme", "General liability", "2027-01-01", "job_1")];
    expect(supersededCoiIds(rows).size).toBe(0);
  });

  it("rows with no coverage line are never superseded — every existing COI behaves as before", () => {
    const rows = [coi("a", "Acme", null, "2025-01-01"), coi("b", "Acme", null, "2027-01-01")];
    expect(supersededCoiIds(rows).size).toBe(0);
  });

  it("an exact tie hides neither", () => {
    const rows = [coi("a", "Acme", "GL", "2027-01-01"), coi("b", "Acme", "GL", "2027-01-01")];
    expect(supersededCoiIds(rows).size).toBe(0);
  });
});

describe("coiStandingFor / coiStandingLine — derived from the date, never stored", () => {
  const rows = governingCois([
    coi("gl-old", "Acme Scaffold", "General liability", "2025-09-01"),
    coi("gl-new", "Acme Scaffold", "General liability", "2027-09-01"),
    coi("wc", "Acme Scaffold", "Workers' compensation", "2026-09-10"),
    coi("r", "Ridge Drywall", "Automobile liability", "2026-10-01"),
    coi("z", "Zed Rentals", null, "2027-06-01"),
  ]);

  it("the worst governing line decides, and the renewed old GL row does not count", () => {
    const standing = coiStandingFor("acme scaffold", rows, TODAY);
    expect(standing).toEqual({
      kind: "ON_FILE",
      urgency: "EXPIRED",
      soonest: "2026-09-10",
      soonestCoverage: "Workers' compensation",
      lines: 2,
    });
    expect(coiStandingLine(standing, TODAY)).toEqual({
      text: "COI expired 8 days ago (Workers' compensation) — don't put them on site under it",
      tone: "bad",
    });
  });

  it("due within 30 days warns; further out is current; nothing on file says so", () => {
    expect(coiStandingLine(coiStandingFor("Ridge Drywall", rows, TODAY), TODAY)).toEqual({
      text: "COI expires in 13 days (Automobile liability)",
      tone: "warn",
    });
    expect(coiStandingLine(coiStandingFor("Zed Rentals", rows, TODAY), TODAY).tone).toBe("ok");
    expect(coiStandingLine(coiStandingFor("Nobody Inc", rows, TODAY), TODAY)).toEqual({
      text: "No certificate of insurance on file",
      tone: "none",
    });
  });

  it("the same row flips from current to expired by the calendar alone", () => {
    const one = [coi("x", "Acme", "GL", "2026-10-01")];
    expect(coiStandingFor("Acme", one, "2026-09-18")).toMatchObject({ urgency: "DUE_SOON" });
    expect(coiStandingFor("Acme", one, "2026-10-01")).toMatchObject({ urgency: "DUE_SOON" });
    expect(coiStandingFor("Acme", one, "2026-10-02")).toMatchObject({ urgency: "EXPIRED" });
  });
});
