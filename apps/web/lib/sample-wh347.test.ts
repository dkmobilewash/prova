import { describe, expect, it } from "vitest";
import { buildSampleWh347, SAMPLE_PROJECT_FALLBACK } from "./sample-wh347";

describe("the sample WH-347 a prospect is sent", () => {
  it("carries the prospect's name and project, the shared crew, and is never fileable", () => {
    const form = buildSampleWh347({
      contractorName: "Valley Interior Systems, Inc.",
      city: "Sacramento",
      projectName: "Mission Bay Block 9",
    });
    expect(form.header.contractorName).toBe("Valley Interior Systems, Inc.");
    expect(form.header.projectName).toBe("Mission Bay Block 9");
    expect(form.workers).toHaveLength(3);
    expect(form.totalHours).toBeGreaterThan(100);
    // A sample must never report itself ready to file: page 2 is deliberately absent.
    expect(form.fileable).toBe(false);
    expect(form.blocking.length).toBeGreaterThan(0);
  });

  it("names the fallback project when no listing gave one, and defaults a city to California", () => {
    const form = buildSampleWh347({ contractorName: "Baker Drywall", city: "Fresno", projectName: "  " });
    expect(form.header.projectName).toBe(SAMPLE_PROJECT_FALLBACK);
    expect(form.header.contractorAddress).toContain("Fresno");
    expect(form.header.contractorAddress).toContain("CA");
  });

  it("is the same crew the marketing panel shows, so the two cannot drift", () => {
    const a = buildSampleWh347({ contractorName: "A" });
    const b = buildSampleWh347({ contractorName: "B", payrollNumber: 14 });
    expect(a.workers.map((w) => w.name)).toEqual(b.workers.map((w) => w.name));
    expect(a.totalHours).toBe(b.totalHours);
    expect(b.header.payrollNumber).toBe(14);
  });
});
