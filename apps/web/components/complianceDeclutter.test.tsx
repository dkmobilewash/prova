/**
 * /compliance after declutter round 3 (density audit #25): the EMR is one
 * status line with Record beside it, its explainer one click down; each
 * document is one line (type · status · expiry · party · job) opening to the
 * dates, notes, file and actions. Rendered, not grepped.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { emrStanding } from "@/lib/emr";

vi.mock("@/lib/actions", () => ({
  recordExperienceModRate: vi.fn(),
  updateExperienceModRate: vi.fn(),
  deleteExperienceModRate: vi.fn(),
  deleteComplianceDocument: vi.fn(),
  markComplianceDocumentReceived: vi.fn(),
  updateComplianceDocument: vi.fn(),
}));

const { ExperienceModRates } = await import("./ExperienceModRates");
const { ComplianceDocumentRow } = await import("./ComplianceDocumentRow");

describe("EMR section", () => {
  it("puts the status and Record on one line, and the explainer behind a closed disclosure", () => {
    const html = renderToStaticMarkup(<ExperienceModRates standing={emrStanding([], "2026-10-14")} canDelete />);
    const line = html.slice(html.indexOf("data-emr-status"), html.indexOf("<details"));
    expect(line).toContain("No mod rate on file");
    expect(line).toContain("Record a mod rate");
    const details = html.slice(html.indexOf("<details"));
    expect(details).toContain("This app never computes or estimates an EMR");
    expect(details).not.toMatch(/<details[^>]* open/);
  });
});

describe("ComplianceDocumentRow", () => {
  const doc = {
    id: "d1", type: "CERTIFICATE_OF_INSURANCE", partyName: "Acme Insurance", status: "PENDING", amount: "1200",
    periodStart: null, periodEnd: null, effectiveDate: new Date("2026-01-01T00:00:00Z"),
    expiresAt: new Date("2026-10-20T00:00:00Z"), notes: "Ask for the endorsement", fileUrl: "https://x/f.pdf",
    fileName: "coi.pdf", aiExtracted: false, jobName: "Oak Ave", coverageType: null, superseded: false,
  };

  it("is one closed line with type, status, expiry chip, party and job; the rest inside", () => {
    const html = renderToStaticMarkup(<ComplianceDocumentRow doc={doc} canDelete todayIso="2026-10-14" />);
    const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
    for (const text of ["Certificate of insurance", "Pending", "Acme Insurance", "Oak Ave"]) expect(summary).toContain(text);
    expect(summary).toMatch(/[Ee]xpires/);
    expect(summary).not.toContain("Edit");
    expect(summary).not.toContain("Ask for the endorsement");
    const body = html.slice(html.indexOf("</summary>"));
    for (const text of ["Ask for the endorsement", "coi.pdf", "Edit", "Mark received"]) expect(body).toContain(text);
    expect(html).not.toMatch(/<details[^>]* open/);
  });
});
