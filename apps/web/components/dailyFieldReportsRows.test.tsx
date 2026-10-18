import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DailyFieldReports, type FieldReport } from "@/components/DailyFieldReports";

/**
 * The job's Field reports tab after the declutter pass (density audit #8):
 * every report was fully expanded and uncapped, and the delay log sat under
 * all of them. Now each report is a closed one-line row (the same
 * FieldReportFacts summary /field-reports uses) and the delays come first.
 */
const report = (n: number, extra: Partial<FieldReport> = {}): FieldReport => ({
  id: `r-${n}`,
  reportDate: `2026-10-0${n}T00:00:00.000Z`,
  crewPresent: null,
  workPerformed: `Hung board, day ${n}`,
  weather: null,
  delays: null,
  filedByName: "Dana",
  ...extra,
});

const html = renderToStaticMarkup(
  <DailyFieldReports
    jobId="job-1"
    canDelete
    reports={[report(2, { manpower: { headcount: 3, hours: 24 }, hasDelayEvent: true }), report(1, { lockedLabel: "Signed" })]}
    seeAll={<p>SEE-ALL-LINE</p>}
  >
    <div>DELAY-LOG</div>
  </DailyFieldReports>,
);

describe("DailyFieldReports rows", () => {
  it("puts the delay log ABOVE the reports, and the SeeAll line under them", () => {
    expect(html.indexOf("DELAY-LOG")).toBeGreaterThan(-1);
    expect(html.indexOf("DELAY-LOG")).toBeLessThan(html.indexOf("<details"));
    expect(html.indexOf("SEE-ALL-LINE")).toBeGreaterThan(html.lastIndexOf("</details>"));
  });

  it("renders each report as a closed row with its facts in the summary and its body under it", () => {
    const rows = [...html.matchAll(/<details([^>]*)>\s*<summary[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)];
    expect(rows).toHaveLength(2);
    for (const [, attrs] of rows) {
      expect(attrs).toContain('name="field-report"');
      expect(attrs).not.toMatch(/\sopen/);
    }
    const [, , summary, body] = rows[0]!;
    expect(summary).toContain("3 crew · 24h");
    expect(summary).toContain(">Delay<");
    expect(summary).toContain("filed by Dana");
    expect(summary).not.toContain("Hung board");
    expect(body).toContain("Hung board, day 2");
    // Edit and Remove live in the body, never the summary (a button in a
    // <summary> also toggles it).
    expect(body).toContain(">Edit<");
    expect(summary).not.toContain("<button");
    expect(rows[1]![2]).toContain("Signed · locked");
  });
});
