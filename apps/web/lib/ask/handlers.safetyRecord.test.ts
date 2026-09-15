import { describe, expect, it, vi } from "vitest";

/**
 * safety_record: the OSHA log for one year.
 *
 * Two things are pinned here rather than left to read correctly.
 *
 * RECORDABILITY IS DERIVED, never stored — `isRecordable` off the outcome,
 * the same call /safety makes — so the box and the 300 log cannot disagree
 * about which cases are on it. The fixture carries a FIRST_AID_ONLY case
 * precisely so a regression that counted every incident as recordable
 * changes the number.
 *
 * THE YEAR IS RESOLVED HERE, not by the model. An OSHA case number is
 * scoped to a calendar year and the model does not know what year it is
 * where the person is standing — the same rule every date in this registry
 * follows.
 */

const INCIDENTS = [
  {
    caseNumber: 2,
    caseYear: 2026,
    occurredAt: new Date("2026-03-04T00:00:00.000Z"),
    employeeName: "M. Alvarez",
    classification: "INJURY",
    outcome: "DAYS_AWAY",
    daysAway: 12,
    daysRestricted: null,
    job: { name: "Riverside Medical" },
  },
  {
    caseNumber: 1,
    caseYear: 2026,
    occurredAt: new Date("2026-02-01T00:00:00.000Z"),
    employeeName: "J. Okafor",
    classification: "INJURY",
    // NOT recordable. The case that makes the count mean something.
    outcome: "FIRST_AID_ONLY",
    daysAway: null,
    daysRestricted: null,
    job: null,
  },
];

const TALKS = [
  { topic: "Ladder safety", heldOn: new Date("2026-04-02T00:00:00.000Z"), job: { name: "Riverside Medical" } },
];

let lastIncidentWhere: Record<string, unknown> = {};

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma,
  prisma: {
    safetyIncident: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        lastIncidentWhere = where;
        return where.caseYear === 2026 ? INCIDENTS : [];
      },
    },
    // Honours the date window the handler passes, the way the real query
    // does. A mock that returned every talk regardless would hide a
    // handler that forgot to scope talks to the year at all — and the
    // year-scoping is half of what this tool claims.
    toolboxTalk: {
      findMany: async ({ where }: { where: { heldOn: { gte: Date; lt: Date } } }) =>
        TALKS.filter((talk) => talk.heldOn >= where.heldOn.gte && talk.heldOn < where.heldOn.lt),
    },
  },
}));

vi.mock("@/lib/serverToday", () => ({ serverToday: () => "2026-09-15" }));

async function ask(input: Record<string, string> = {}) {
  const { runTool } = await import("./handlers");
  return runTool({ companyId: "company-1", principal: { role: "OWNER", jobFunction: null } }, "safety_record", input);
}

describe("safety_record", () => {
  it("derives recordability from the outcome, so first aid is not on the 300 log", async () => {
    const result = await ask();
    expect(result.summary).toMatchObject({ cases: 2, recordableCases: 1, daysAwayTotal: 12 });

    const cases = (result.data as { cases: Array<Record<string, unknown>> }).cases;
    expect(cases.find((row) => row.person === "M. Alvarez")!.recordable).toBe(true);
    expect(cases.find((row) => row.person === "J. Okafor")!.recordable).toBe(false);
  });

  it("defaults to the current year, and uses a year the person named", async () => {
    await ask();
    expect(lastIncidentWhere.caseYear).toBe(2026);

    const older = await ask({ year: "2025" });
    expect(lastIncidentWhere.caseYear).toBe(2025);
    // Nothing that year in the fixture, and it says so naming the year
    // rather than returning an empty list.
    expect(older.unavailable).toBe("Nothing is recorded for 2025: no cases and no toolbox talks.");
  });

  it("falls back to the current year rather than querying a nonsense one", async () => {
    // The model is told to pass the person's own words. "last year",
    // "twenty twenty five" and an empty string all have to land somewhere
    // safe — a year of 0 or NaN would silently return an empty log that
    // reads as a clean safety record.
    for (const year of ["last year", "", "0", "not a year", "3999"]) {
      await ask({ year });
      expect(lastIncidentWhere.caseYear, year).toBe(2026);
    }
  });

  it("reports a toolbox talk without claiming anybody attended it", async () => {
    // The attendee roster is free text and the signature sheet is a photo,
    // so "who signed the safety talk" is a KNOWN_GAP. The tool must not
    // hand the model a field that invites the claim.
    const talks = (await ask()).data as { toolboxTalks: Array<Record<string, unknown>> };
    expect(talks.toolboxTalks).toEqual([
      { topic: "Ladder safety", heldOn: "2026-04-02", job: "Riverside Medical" },
    ]);
    const keys = Object.keys(talks.toolboxTalks[0]);
    for (const forbidden of ["attendees", "attendeeNames", "signedBy", "roster"]) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
  });

  it("scopes toolbox talks to the same year as the cases", async () => {
    // One calendar year, both halves. A talk held in 2026 must not appear
    // in the 2025 log beside 2025's cases.
    expect(((await ask()).data as { toolboxTalks: unknown[] }).toolboxTalks).toHaveLength(1);
    expect(((await ask({ year: "2025" })).data as { toolboxTalks: unknown[] }).toolboxTalks).toHaveLength(0);
  });

  it("names the case the way OSHA numbers it, year and sequence", async () => {
    const cases = (await ask()).data as { cases: Array<Record<string, unknown>> };
    expect(cases.cases.map((row) => row.case)).toEqual(["2026-2", "2026-1"]);
  });
});
