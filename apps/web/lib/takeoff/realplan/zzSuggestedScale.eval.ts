import { Buffer } from "node:buffer";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { sheetStrokes } from "../sheetStrokes";
import { GRID_REFERENCE_SHEETS, feetPerInchOf, gridAxes, scaleVotes, suggestScale, type GridAxis } from "../suggestedScale";

/**
 * The shipped rule over one plan set, every source, with each sheet's own scale
 * hidden: it sees only the OTHER sheets' scales, as a viewer would. The sheet
 * list and any door schedule come from the env. No model, no database, no label.
 */
const PDF = process.env.SCALEDUMP_PDF ?? "";
const SHEETS = process.env.SCALEDUMP_PAGES ?? "";
const OUT = process.env.SCALEDUMP_OUT ?? "";
const ROWS = process.env.SCALEDUMP_ROWS ?? "";
type Sheet = { page: number; number: string | null; scale: string | null };

describe.skipIf(PDF === "" || OUT === "")("suggesting a scale with the printed one hidden", () => {
  it("writes each source's vote per sheet", { timeout: 3_600_000 }, async () => {
    const sheets = JSON.parse(readFileSync(SHEETS, "utf8")) as Sheet[];
    const doorRows = ROWS === "" ? [] : (JSON.parse(readFileSync(ROWS, "utf8")) as { mark: string; size?: string | null }[]);
    const bytes = readFileSync(PDF);
    const doc = await openPlanPdf(Buffer.from(bytes));
    const read = new Map<number, { st: Awaited<ReturnType<typeof sheetStrokes>>; text: { str: string; x: number; y: number; width: number; height: number }[]; axes: GridAxis[] }>();
    for (const { page } of sheets) {
      const st = await sheetStrokes(Buffer.from(bytes), page);
      if (st === null) continue;
      const text = (await doc.pageText(page)).items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
      read.set(page, { st, text, axes: gridAxes(st.segments, text) });
    }
    const rows: unknown[] = [];
    for (const sheet of sheets) {
      const here = read.get(sheet.page);
      if (here === undefined) continue;
      const scaled = sheets.filter((o) => o.page !== sheet.page && feetPerInchOf(o.scale) !== null);
      const gridReferences = [...scaled]
        .sort((a, b) => Math.abs(a.page - sheet.page) - Math.abs(b.page - sheet.page))
        .slice(0, GRID_REFERENCE_SHEETS)
        .map((o) => ({ feetPerInch: feetPerInchOf(o.scale)!, axes: read.get(o.page)?.axes ?? [] }));
      const evidence = {
        segmentsPt: here.st.segments,
        text: here.text,
        doorRows,
        sheetNumber: sheet.number,
        sameSet: scaled.map((o) => ({ sheetNumber: o.number, feetPerInch: feetPerInchOf(o.scale)! })),
        gridReferences,
      };
      const t0 = Date.now();
      const votes = scaleVotes(evidence);
      const offer = suggestScale(evidence);
      rows.push({ page: sheet.page, offer: offer?.feetPerInch ?? null, because: offer?.because ?? null, votes: Object.fromEntries(Object.entries(votes).map(([k, v]) => [k, v.feetPerInch])), ms: (Date.now() - t0) / 2 });
    }
    writeFileSync(OUT, JSON.stringify(rows));
    expect(sheets.length, "no sheets named").toBeGreaterThan(0);
  });
});
