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

vi.mock("@/lib/actions", () => ({
  importClients: vi.fn(),
  importJobs: vi.fn(),
  importCrew: vi.fn(),
  importVcfContacts: vi.fn(),
  importPhaseCodes: vi.fn(),
  suggestImportColumnFields: vi.fn(),
}));

const { AnyFileImport, EstimateNotice } = await import("./SpreadsheetImport");

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

// "A person's own pick always wins" used to be pinned here as a spread order;
// it now lives in `resolveColumns` (lib/import-smart-map.ts) and is tested
// there as behaviour rather than as source text.

describe("the review screen writes nothing before Import", () => {
  // No DOM environment here (vitest runs "node"), so the review is rendered
  // statically from a file already chosen — which is the whole screen, with
  // its counts and preview — and every write path is a spy that must stay
  // untouched.
  const csv = "Job#,Job Name,Cust. Name,Open Balance\n1001,Tower,Acme Builders,$5\n1002,Harbor,Zenith GC,$0\n1003,,Acme Builders,";

  it("renders the per-column review, counts and preview from the file, calling no action", async () => {
    const actions = await import("@/lib/actions");
    const html = renderToStaticMarkup(
      createElement(AnyFileImport, {
        existingContactNames: ["Acme Builders"],
        existingPeople: [],
        existingJobs: [],
        existingCrew: [],
        existingPhaseCodeCodes: [],
        initialFile: { name: "sage-jobs.csv", text: csv },
      }),
    );
    // The kind was guessed, and said so.
    expect(html).toContain("Guessed from the column names in sage-jobs.csv");
    // Each column, with its confidence.
    expect(html).toContain("Exact name");
    expect(html).toContain("Similar name");
    expect(html).toContain("Skipped");
    // How many import, how many are skipped, and why.
    expect(html).toContain("2 will be added");
    expect(html).toContain("1 with problems — skipped");
    expect(html).toContain("No job name — skipped.");
    expect(html).toContain("Import 2 jobs");
    // The preview reads Job Name, not the job number.
    expect(html).toContain("Tower");
    expect(html).not.toMatch(/<td[^>]*>1001<\/td>/);
    for (const name of ["importClients", "importJobs", "importCrew", "importVcfContacts", "importPhaseCodes", "suggestImportColumnFields"] as const) {
      expect(actions[name], name).not.toHaveBeenCalled();
    }
  });

  it("asks for the kind when the headers don't say", () => {
    const html = renderToStaticMarkup(
      createElement(AnyFileImport, {
        existingContactNames: [],
        existingPeople: [],
        existingJobs: [],
        existingCrew: [],
        existingPhaseCodeCodes: [],
        initialFile: { name: "x.csv", text: "Open Balance,Attachments\n1,2" },
      }),
    );
    expect(html).toContain("Couldn&#x27;t tell from the column names in x.csv");
  });

  it("calls an import action in exactly one place, the Import button's handler", () => {
    const source = readFileSync(new URL("./SpreadsheetImport.tsx", import.meta.url), "utf8");
    expect(source.match(/await action\(formData\)/g)).toHaveLength(1);
    const confirm = source.slice(source.indexOf("function confirm()"), source.indexOf("if (!open)"));
    expect(confirm).toContain("await action(formData)");
  });
});
