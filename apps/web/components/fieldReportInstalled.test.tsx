import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions", () => ({}));
const { FieldReportFields } = await import("./DailyFieldReports");

const line = { id: "l1", description: "5/8 type X board", unit: "SF", quantity: 10000, installedToDate: 1200 };

describe("installed quantities on the field report form", () => {
  it("offers each line in its own unit, with the total to date", () => {
    const html = renderToStaticMarkup(<FieldReportFields lines={[line]} />);
    expect(html).toContain("Installed today (optional)");
    expect(html).toContain("5/8 type X board (SF)");
    expect(html).toContain('name="installed:l1"');
    expect(html).toContain("1,200 of 10,000 SF to date");
  });

  it("shows what this report already says when editing", () => {
    const report = { id: "r", reportDate: "2026-10-01", crewPresent: null, workPerformed: "w", weather: null, delays: null, filedByName: null, installed: { l1: 400 } };
    expect(renderToStaticMarkup(<FieldReportFields report={report} lines={[line]} />)).toContain('value="400"');
  });

  it("is not there with no line to put a quantity on, so such a save leaves quantities alone", () => {
    expect(renderToStaticMarkup(<FieldReportFields />)).not.toContain("Installed today");
  });

  it("does not make the report wait on it", () => {
    expect(renderToStaticMarkup(<FieldReportFields lines={[line]} />)).not.toMatch(/name="installed:l1"[^>]*required/);
  });
});
