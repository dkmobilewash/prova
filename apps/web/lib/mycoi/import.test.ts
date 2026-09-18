import { describe, expect, it } from "vitest";
import { coiNotes, normaliseCoverage, planCoiImport, readCoiExport } from "./import";

/**
 * The myCOI export, read and planned. Pure functions — the same ones the
 * preview runs in the browser and the confirm runs on the server.
 */

const FILE = [
  "Insured Name,Coverage Type,Carrier,Policy #,Effective Date,Expiration Date,Compliance Status,Account Rep",
  "Acme Scaffold LLC,GL,Example Mutual,GL-1,2025-10-01,2026-10-01,Compliant,Pat",
  "Acme Scaffold LLC,Workers Comp,Example Mutual,WC-1,2025-10-01,3/15/2027,Compliant,Pat",
  "Ridge Drywall,Auto,Other Ins Co,AU-9,,2026-08-31,Non-Compliant,Pat",
  ",GL,Nobody,X,,2026-01-01,,",
  "No Date Inc,GL,Nobody,X,,,,",
  "Bad Date Co,GL,Nobody,X,,2026-02-30,,",
].join("\n");

const NOBODY = { vendors: [], subsAndSuppliers: [] };

describe("readCoiExport", () => {
  const parsed = readCoiExport(FILE);

  it("reads the good rows with their facts, dates as yyyy-mm-dd", () => {
    expect(parsed.records.map((r) => [r.vendorName, r.coverage, r.expiresOn, r.sourceStatus])).toEqual([
      ["Acme Scaffold LLC", "General liability", "2026-10-01", "Compliant"],
      ["Acme Scaffold LLC", "Workers' compensation", "2027-03-15", "Compliant"],
      ["Ridge Drywall", "Automobile liability", "2026-08-31", "Non-Compliant"],
    ]);
    expect(parsed.records[0]).toMatchObject({ carrier: "Example Mutual", policyNumber: "GL-1", effectiveDate: "2025-10-01" });
  });

  it("skips a row with no vendor, no expiry, or an impossible date — each with its line", () => {
    expect(parsed.problems.map((p) => p.line)).toEqual([5, 6, 7]);
    expect(parsed.problems[1].message).toContain("no expiration date");
    expect(parsed.problems[2].message).toContain("isn't a real date");
  });

  it("names the column it did not use", () => {
    expect(parsed.ignoredColumns).toEqual(["Account Rep"]);
    expect(parsed.noCoverageColumn).toBe(false);
  });

  it("refuses a file with no vendor or no expiry column, and says which", () => {
    const result = readCoiExport("Coverage,Carrier\nGL,X\n");
    expect(result.records).toEqual([]);
    expect(result.problems[0].message).toContain("no a vendor column");
    expect(result.problems[0].message).toContain("expiration column");
  });

  it("flags a file with no coverage column", () => {
    expect(readCoiExport("Vendor,Expires\nA,2027-01-01\n").noCoverageColumn).toBe(true);
  });
});

describe("normaliseCoverage", () => {
  it("maps the common words to one label and keeps anything else as written", () => {
    expect(normaliseCoverage("CGL")).toBe("General liability");
    expect(normaliseCoverage("Workers' Compensation")).toBe("Workers' compensation");
    expect(normaliseCoverage("umbrella")).toBe("Umbrella / excess");
    expect(normaliseCoverage("Pollution  Liability")).toBe("Pollution Liability");
    expect(normaliseCoverage("  ")).toBeNull();
  });
});

describe("planCoiImport", () => {
  it("splits new from already-here by party + line + expiry, ignoring case", () => {
    const plan = planCoiImport(
      readCoiExport(FILE),
      [{ partyName: "ACME scaffold llc", coverageType: "general LIABILITY", expiresOn: "2026-10-01" }],
      NOBODY,
    );
    expect(plan.existing.map((e) => e.line)).toEqual([2]);
    expect(plan.create.map((r) => r.line)).toEqual([3, 4]);
  });

  it("treats a renewal — same party and line, new date — as new", () => {
    const plan = planCoiImport(
      readCoiExport(FILE),
      [{ partyName: "Acme Scaffold LLC", coverageType: "General liability", expiresOn: "2025-10-01" }],
      NOBODY,
    );
    expect(plan.create.map((r) => r.line)).toContain(2);
  });

  it("adds a line repeated in the same file only once", () => {
    const text = "Vendor,Coverage,Expires\nA,GL,2027-01-01\na,gl,2027-01-01\n";
    const plan = planCoiImport(readCoiExport(text), [], NOBODY);
    expect(plan.create).toHaveLength(1);
    expect(plan.problems.map((p) => p.line)).toEqual([3]);
  });

  it("says which vendor or contact each row matches, without creating either", () => {
    const plan = planCoiImport(readCoiExport(FILE), [], {
      vendors: ["acme scaffold llc"],
      subsAndSuppliers: ["Ridge  Drywall"],
    });
    expect(plan.create.map((r) => r.match)).toEqual([
      { kind: "vendor", name: "acme scaffold llc" },
      { kind: "vendor", name: "acme scaffold llc" },
      { kind: "contact", name: "Ridge  Drywall" },
    ]);
    expect(planCoiImport(readCoiExport(FILE), [], NOBODY).create[0].match).toEqual({ kind: "none" });
  });
});

describe("coiNotes", () => {
  it("quotes myCOI's verdict as theirs and dates the import", () => {
    const [record] = readCoiExport(FILE).records;
    expect(coiNotes(record, "2026-09-18")).toBe(
      "Imported from a myCOI export on 2026-09-18. Carrier: Example Mutual. Policy: GL-1. myCOI status in the export: Compliant.",
    );
  });
});
