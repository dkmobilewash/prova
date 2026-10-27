import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { looksLikeTable, tableRowsFromPage } from "../../plan-ingest/scheduleTable";

/** Which training pages hold a room finish schedule with a CEILING column, through the second session's table reader. */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const PAGES = (process.env.CEILING_PAGES ?? "").split(",").map((s) => s.trim()).filter(Boolean);

describe.skipIf(DIR === "" || PAGES.length === 0)("ceiling schedule probe", () => {
  it("prints header rows that mention CEILING and a few data rows", { timeout: 1_800_000 }, async () => {
    for (const spec of PAGES) {
      const [set, p] = spec.split(":");
      const doc = await openPlanPdf(Buffer.from(readFileSync(join(DIR, set))));
      const page = await doc.pageText(Number(p));
      await doc.close();
      const rows = tableRowsFromPage(page);
      const headers = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.cells.some((c) => /CEILING|CLG/i.test(c)) && r.cells.length >= 4);
      console.log(`\n${set} p${p}: ${rows.length} rows, looksLikeTable ${looksLikeTable(rows)}, ${headers.length} rows with CEILING and 4+ cells`);
      for (const { r, i } of headers.slice(0, 4)) {
        console.log(`  row ${i} y=${(r.y / page.widthPt).toFixed(3)}: ${r.cells.join(" | ").slice(0, 200)}`);
        for (const n of rows.slice(i + 1, i + 4)) console.log(`     next: ${n.cells.join(" | ").slice(0, 160)}`);
      }
    }
    expect(PAGES.length).toBeGreaterThan(0);
  });
});
