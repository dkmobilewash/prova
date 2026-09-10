import { describe, expect, it, vi } from "vitest";
import type { RenewalSource } from "@/lib/compliance-expiry";

/**
 * Issue #103, finding 2: `renewalAlerts` drops every CURRENT source, so a
 * company that filed nothing at all produces the exact same empty array as
 * one whose filings are all in date — `renewalSourcesForCompany` returned
 * zero rows either way. The old handler checked only `alerts.length === 0`
 * and printed "every certificate, licence, policy and bond on file is
 * current" for both, so "is my GL still good?" from a company with zero
 * compliance rows on file was answered as reassurance about a fact nobody
 * had ever checked.
 *
 * The fix reuses `renewalCoverage`/`renewalCoverageMessage` — the same
 * functions `RenewalAlerts.tsx` renders through — so the tool and the
 * /compliance page can never tell two different stories about an empty
 * list.
 */

vi.mock("@/lib/renewals", () => ({
  renewalSourcesForCompany: vi.fn(),
}));

async function askComplianceStatus() {
  const { runTool } = await import("./handlers");
  return runTool(
    { companyId: "company-1", principal: { role: "OWNER", jobFunction: null } },
    "compliance_status",
    {},
  );
}

async function setSources(sources: RenewalSource[]) {
  const { renewalSourcesForCompany } = await import("@/lib/renewals");
  vi.mocked(renewalSourcesForCompany).mockResolvedValue(sources);
}

describe("compliance_status coverage", () => {
  it("says nothing is tracked, not that everything is current, when the company has filed nothing", async () => {
    await setSources([]);
    const result = await askComplianceStatus();
    expect(result.data).toEqual([]);
    expect(result.unavailable).toMatch(/nothing is being tracked/i);
    // The exact old-code failure: this reassurance must never be said about
    // an empty filing history.
    expect(result.unavailable).not.toMatch(/is current/i);
  });

  it("says everything on file is current when sources exist and none are expiring", async () => {
    await setSources([
      {
        id: "coi-1",
        kind: "COMPLIANCE_DOCUMENT",
        title: "Certificate of insurance",
        detail: "Acme GC",
        date: "2099-01-01",
        expectsDate: true,
        href: "/compliance",
      },
    ]);
    const result = await askComplianceStatus();
    expect(result.data).toEqual([]);
    expect(result.unavailable).toMatch(/current/i);
    expect(result.unavailable).toMatch(/1 tracked record is current/i);
    expect(result.unavailable).not.toMatch(/nothing is being tracked/i);
  });

  it("reports the rows and no unavailable message when something is actually expired", async () => {
    await setSources([
      {
        id: "coi-1",
        kind: "COMPLIANCE_DOCUMENT",
        title: "Certificate of insurance",
        detail: "Acme GC",
        date: "2020-01-01",
        expectsDate: true,
        href: "/compliance",
      },
    ]);
    const result = await askComplianceStatus();
    expect(result.unavailable).toBeUndefined();
    expect((result.data as unknown[]).length).toBe(1);
  });
});
