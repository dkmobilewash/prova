import { describe, expect, it } from "vitest";
import {
  REMITTANCE_BLOCKING_FIELD_REASON,
  employerAddressLines,
  remittanceBlockingFields,
  type RemittanceBlockingField,
  type RemittanceFilingCompany,
} from "./fringe-remittance-filing";
import { buildRemittanceReport, type RemittanceEntryInput } from "./fringe-remittance";
import type { FringeRateScheduleInput } from "./labor-cost";
import { payrollWorkerName } from "./worker-name";

const schedule = (over: Partial<FringeRateScheduleInput> = {}): FringeRateScheduleInput => ({
  baseWage: 45,
  pensionRate: 8,
  vacationRate: 3,
  healthWelfareRate: 11,
  trainingRate: 1,
  effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
  effectiveTo: null,
  ...over,
});

const entry = (over: Partial<RemittanceEntryInput> = {}): RemittanceEntryInput => ({
  date: new Date(Date.UTC(2026, 7, 17)),
  hours: 8,
  payType: "STRAIGHT",
  craftClassificationId: "craft_j",
  craftLabel: "Journeyman Drywall",
  unionLocalId: "local_1",
  unionLocalLabel: "Local 300",
  employeeUserId: "user_a",
  employeeFilingName: payrollWorkerName({ name: "A Worker", email: "a@example.com" }),
  employeeName: "A Worker",
  jobName: "Courthouse",
  ...over,
});

/** The single local a scenario produces. Throws rather than returning
 * undefined so a fixture that silently stopped producing a local fails
 * the test that uses it instead of asserting about nothing. */
const localFrom = (
  entries: RemittanceEntryInput[],
  schedules = new Map([["craft_j", [schedule()]]]),
) => {
  const report = buildRemittanceReport(entries, schedules, "2026-08-01", "2026-08-31");
  const local = report.locals[0];
  if (!local) throw new Error("the fixture produced no local at all");
  return local;
};

/** A company with every printable header field filled in — so a test
 * about ONE missing field is about that field and not about a fixture
 * that was empty all along. */
const completeCompany = (over: Partial<RemittanceFilingCompany> = {}): RemittanceFilingCompany => ({
  name: "Bayline Drywall Inc",
  dbaName: null,
  hqAddressLine1: "1400 Industrial Way",
  hqAddressLine2: "Suite 210",
  hqCity: "Oakland",
  hqState: "CA",
  hqZip: "94607",
  ein: "94-1234567",
  ...over,
});

describe("employerAddressLines", () => {
  it("prints the address when every part of it is recorded", () => {
    expect(employerAddressLines(completeCompany())).toEqual([
      "1400 Industrial Way",
      "Suite 210",
      "Oakland, CA 94607",
    ]);
  });

  it("treats a suite number as genuinely optional", () => {
    expect(employerAddressLines(completeCompany({ hqAddressLine2: null }))).toEqual([
      "1400 Industrial Way",
      "Oakland, CA 94607",
    ]);
  });

  it("refuses a PARTIAL address rather than printing half of one", () => {
    // The point of the whole function. "1400 Industrial Way" with no city
    // reads as a formatting bug and gets sent; a red sentence saying the
    // address is not recorded gets fixed.
    expect(employerAddressLines(completeCompany({ hqCity: null }))).toBeNull();
    expect(employerAddressLines(completeCompany({ hqState: null }))).toBeNull();
    expect(employerAddressLines(completeCompany({ hqZip: null }))).toBeNull();
    expect(employerAddressLines(completeCompany({ hqAddressLine1: null }))).toBeNull();
  });

  it("does not accept whitespace as a recorded value", () => {
    // A city of spaces would print as an empty cell, which is the version
    // nobody chases. Same call payrollWorkerName makes on a name.
    expect(employerAddressLines(completeCompany({ hqCity: "   " }))).toBeNull();
  });
});

describe("remittanceBlockingFields", () => {
  it("names the fund's own account number and address even when the company record is perfect", () => {
    // The structural half. cstream has never held a field for either, so
    // a sheet with nothing wrong with it is still not an envelope.
    const fields = remittanceBlockingFields(completeCompany(), localFrom([entry()]));
    expect(fields).toContain("fundEmployerNumber");
    expect(fields).toContain("fundRemitAddress");
  });

  it("names the member ID number, because a fund credits by number and not by name", () => {
    const fields = remittanceBlockingFields(completeCompany(), localFrom([entry()]));
    expect(fields).toContain("memberIdNumber");
  });

  it("names dues checkoff, because this sheet is employer contributions only", () => {
    const fields = remittanceBlockingFields(completeCompany(), localFrom([entry()]));
    expect(fields).toContain("duesCheckoff");
  });

  it("names the employer address only when it is not recorded", () => {
    expect(remittanceBlockingFields(completeCompany(), localFrom([entry()]))).not.toContain(
      "employerAddress",
    );
    expect(
      remittanceBlockingFields(completeCompany({ hqZip: null }), localFrom([entry()])),
    ).toContain("employerAddress");
  });

  it("names the EIN only when it is not recorded", () => {
    expect(remittanceBlockingFields(completeCompany(), localFrom([entry()]))).not.toContain(
      "employerEin",
    );
    expect(remittanceBlockingFields(completeCompany({ ein: null }), localFrom([entry()]))).toContain(
      "employerEin",
    );
    expect(remittanceBlockingFields(completeCompany({ ein: "  " }), localFrom([entry()]))).toContain(
      "employerEin",
    );
  });

  it("names a member with no name recorded, wherever on the sheet they are", () => {
    // Deliberately the SECOND classification, and deliberately not the
    // first member of it. A check that reads only the first craft row, or
    // only the first person on it, passes a fixture that puts the nameless
    // member first — so this fixture puts them last.
    const local = localFrom(
      [
        entry(),
        entry({
          craftClassificationId: "craft_x",
          craftLabel: "Zed Taper",
          employeeUserId: "user_named",
          employeeFilingName: payrollWorkerName({ name: "B Worker", email: "b@example.com" }),
          employeeName: "B Worker",
        }),
        entry({
          craftClassificationId: "craft_x",
          craftLabel: "Zed Taper",
          employeeUserId: "user_nameless",
          employeeFilingName: payrollWorkerName({ name: null, email: "c@example.com" }),
          employeeName: "c@example.com",
        }),
      ],
      new Map([
        ["craft_j", [schedule()]],
        ["craft_x", [schedule()]],
      ]),
    );

    expect(local.crafts.map((craft) => craft.craftLabel)).toEqual([
      "Journeyman Drywall",
      "Zed Taper",
    ]);
    expect(local.crafts[1].employees.at(-1)?.nameMissing).toBe(true);
    expect(remittanceBlockingFields(completeCompany(), local)).toContain("memberName");
  });

  it("does not name a member gap on a sheet where every account has a name", () => {
    expect(remittanceBlockingFields(completeCompany(), localFrom([entry()]))).not.toContain(
      "memberName",
    );
  });

  it("names unpriced hours, because the total below is short by whatever they are worth", () => {
    // No schedule effective on the entry's date, so the hours land on the
    // sheet carrying no money.
    const local = localFrom(
      [entry({ date: new Date(Date.UTC(2025, 5, 1)) })],
      new Map([["craft_j", [schedule()]]]),
    );
    expect(local.uncomputedHours).toBe(8);
    expect(remittanceBlockingFields(completeCompany(), local)).toContain("unpricedHours");
  });

  it("does not name unpriced hours on a sheet where every hour priced", () => {
    const local = localFrom([entry()]);
    expect(local.uncomputedHours).toBe(0);
    expect(remittanceBlockingFields(completeCompany(), local)).not.toContain("unpricedHours");
  });

  it("returns the fields in one declared order, so two prints of a month match", () => {
    const local = localFrom([
      entry({
        employeeUserId: "user_nameless",
        employeeFilingName: payrollWorkerName({ name: null, email: "c@example.com" }),
        employeeName: "c@example.com",
      }),
    ]);
    expect(
      remittanceBlockingFields(completeCompany({ ein: null, hqCity: null }), local),
    ).toEqual([
      "employerAddress",
      "employerEin",
      "fundEmployerNumber",
      "fundRemitAddress",
      "memberIdNumber",
      "memberName",
      "duesCheckoff",
    ]);
  });

  it("never reports a sheet as ready to file", () => {
    // Not a nice-to-have: a page rendering "nothing missing" on an empty
    // return would be rendering a state this function cannot produce.
    expect(remittanceBlockingFields(completeCompany(), localFrom([entry()])).length).toBeGreaterThan(
      0,
    );
  });
});

describe("the blocking-field enumeration", () => {
  it("has a sentence for every field, and every sentence names what to do or what breaks", () => {
    for (const [field, reason] of Object.entries(REMITTANCE_BLOCKING_FIELD_REASON)) {
      expect(reason.length, `${field} has no sentence`).toBeGreaterThan(40);
      // A sentence, not a label. Labels are what this replaced.
      expect(reason.trim().endsWith("."), `${field} is not a sentence`).toBe(true);
    }
  });

  it("can actually produce every field it declares", () => {
    // The "written, documented, and never called" shape CLAUDE.md names as
    // recurring here: a field can be declared, given a careful sentence,
    // rendered by a page that maps over the reason table, and never once be
    // returned — and every test above still passes, because none of them
    // asks about it. So each declared field must be REACHABLE from some
    // real input, and the scenarios below are the proof.
    const nameless = entry({
      employeeUserId: "user_nameless",
      employeeFilingName: payrollWorkerName({ name: null, email: "c@example.com" }),
      employeeName: "c@example.com",
    });

    const scenarios: { company: RemittanceFilingCompany; entries: RemittanceEntryInput[] }[] = [
      { company: completeCompany(), entries: [entry()] },
      { company: completeCompany({ hqAddressLine1: null }), entries: [entry()] },
      { company: completeCompany({ ein: null }), entries: [entry()] },
      { company: completeCompany(), entries: [nameless] },
      { company: completeCompany(), entries: [entry({ date: new Date(Date.UTC(2025, 5, 1)) })] },
    ];

    const produced = new Set<RemittanceBlockingField>();
    for (const scenario of scenarios) {
      for (const field of remittanceBlockingFields(scenario.company, localFrom(scenario.entries))) {
        produced.add(field);
      }
    }

    const declared = Object.keys(REMITTANCE_BLOCKING_FIELD_REASON) as RemittanceBlockingField[];
    const unreachable = declared.filter((field) => !produced.has(field));
    expect(
      unreachable,
      `Declared with a sentence, and no input produces them: ${unreachable.join(", ")}`,
    ).toEqual([]);
  });
});
