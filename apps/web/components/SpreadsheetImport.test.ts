import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { planJobImport } from "@/lib/spreadsheet-import";

/**
 * The jobs preview has to say, plainly and once, that a job the sheet marks
 * Contracted, In progress or Complete comes in as an ESTIMATE.
 *
 * Decided by Cyrus: imports never write any status but ESTIMATE (see the top
 * of lib/spreadsheet-import.ts — contracting is markJobContracted's
 * decision, behind its evidence gate). The per-row "sheet says Contracted"
 * note sits in a table that only shows 25 rows, so on a 300-job sheet it is
 * possible to confirm without ever seeing it. The notice is the sentence
 * above the table that cannot be scrolled past.
 */

vi.mock("@/lib/actions", () => ({ importClients: vi.fn(), importJobs: vi.fn(), importCrew: vi.fn() }));

const { EstimateNotice } = await import("./SpreadsheetImport");

function notice(csv: string): string {
  const plan = planJobImport(csv, [], []);
  return renderToStaticMarkup(createElement(EstimateNotice, { rows: plan.create }));
}

describe("EstimateNotice", () => {
  it("says every job the sheet marks past estimate still comes in as one, with the counts", () => {
    const html = notice(
      [
        "Job,Client,Status",
        "A,Acme,Contracted",
        "B,Acme,Awarded",
        "C,Acme,In progress",
        "D,Acme,Estimate",
        "E,Acme,",
      ].join("\n"),
    );
    expect(html).toContain("3 jobs will come in as an estimate");
    expect(html).toContain("2 Contracted");
    expect(html).toContain("1 In progress");
    expect(html).toContain("Every imported job starts as an estimate");
  });

  it("says nothing when the sheet only has estimates or no status column", () => {
    expect(notice("Job,Client,Status\nA,Acme,Estimate\nB,Acme,")).toBe("");
    expect(notice("Job,Client\nA,Acme")).toBe("");
  });

  it("is actually rendered by the jobs preview, for every row that will be created", () => {
    // The component opens on a click, so a static render cannot reach the
    // preview; this pins the call site instead, so the notice cannot become
    // written-and-never-called.
    const source = readFileSync(new URL("./SpreadsheetImport.tsx", import.meta.url), "utf8");
    expect(source).toContain('{plan.kind === "jobs" && <EstimateNotice rows={plan.create} />}');
  });
});
