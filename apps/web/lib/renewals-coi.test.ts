import { describe, expect, it, vi } from "vitest";
import { renewalAlerts } from "./compliance-expiry";

/**
 * An imported COI reaches the SAME renewal alerts every COI does, and its
 * "expired" is derived from the date on each read — the row carries no
 * status saying so.
 *
 * The fake honours `where` by equality and holds two companies, so a read
 * that forgot `companyId` would surface company B's lapsed certificate here.
 */

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const DOCS = [
  // An imported row: exactly the columns importMyCoiExport writes.
  { id: "gl-old", companyId: "co_A", type: "CERTIFICATE_OF_INSURANCE", partyName: "Acme Scaffold", jobId: null, coverageType: "General liability", expiresAt: day("2025-10-01"), status: "RECEIVED" },
  { id: "gl-new", companyId: "co_A", type: "CERTIFICATE_OF_INSURANCE", partyName: "Acme Scaffold", jobId: null, coverageType: "General liability", expiresAt: day("2027-10-01"), status: "RECEIVED" },
  { id: "wc", companyId: "co_A", type: "CERTIFICATE_OF_INSURANCE", partyName: "Acme Scaffold", jobId: null, coverageType: "Workers' compensation", expiresAt: day("2026-10-01"), status: "RECEIVED" },
  // A legacy whole-certificate row, expired: still alerts, as it always did.
  { id: "legacy", companyId: "co_A", type: "CERTIFICATE_OF_INSURANCE", partyName: "Old Sub", jobId: null, coverageType: null, expiresAt: day("2026-01-01"), status: "RECEIVED" },
  { id: "theirs", companyId: "co_B", type: "CERTIFICATE_OF_INSURANCE", partyName: "Their Sub", jobId: null, coverageType: "Auto", expiresAt: day("2025-01-01"), status: "RECEIVED" },
];

function model(rows: Record<string, unknown>[]) {
  return {
    findMany: async ({ where = {} }: { where?: Record<string, unknown> } = {}) =>
      rows.filter((row) =>
        Object.entries(where).every(([key, value]) => (typeof value === "object" && value !== null) || row[key] === value),
      ),
  };
}

vi.mock("@prova/db", () => ({
  prisma: {
    complianceDocument: model(DOCS),
    companyLicense: model([]),
    companyInsurancePolicy: model([]),
    companyBond: model([]),
    contact: model([]),
  },
}));

const { renewalSourcesForCompany } = await import("./renewals");

describe("imported certificates in the renewal alerts", () => {
  it("drops the renewed GL row, keeps every other line, and reads only this company", async () => {
    const sources = await renewalSourcesForCompany("co_A");
    expect(sources.map((s) => s.id).sort()).toEqual(["gl-new", "legacy", "wc"]);
    expect(sources.find((s) => s.id === "wc")?.title).toBe("Certificate of insurance — Workers' compensation");
  });

  it("the alert is derived from the date: current today, expired the day after", async () => {
    const sources = await renewalSourcesForCompany("co_A");
    const wcOn = (today: string) => renewalAlerts(sources, today).find((alert) => alert.id === "wc")?.urgency;
    expect(wcOn("2026-08-01")).toBeUndefined(); // current: not an alert at all
    expect(wcOn("2026-09-18")).toBe("DUE_SOON");
    expect(wcOn("2026-10-02")).toBe("EXPIRED");
  });
});
