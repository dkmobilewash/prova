import { Buffer } from "node:buffer";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sheetStrokes } from "../sheetStrokes";
import { suggestScaleFromDoors } from "../suggestedScale";

/**
 * The shipped rule over the named pages of one plan set, so the measurement is
 * of the code and not of a sketch of it. The sheet's scale is never given to it.
 * No model, no database, no label. One set per process.
 */
const PDF = process.env.SCALEDUMP_PDF ?? "";
const PAGES = process.env.SCALEDUMP_PAGES ?? "";
const OUT = process.env.SCALEDUMP_OUT ?? "";

describe.skipIf(PDF === "" || OUT === "")("suggesting a scale with the printed one hidden", () => {
  it("writes what it suggests per sheet", { timeout: 3_600_000 }, async () => {
    const pages = JSON.parse(readFileSync(PAGES, "utf8")) as number[];
    const bytes = Buffer.from(readFileSync(PDF));
    const rows: unknown[] = [];
    for (const page of pages) {
      const st = await sheetStrokes(bytes, page);
      if (st === null) continue;
      const t0 = Date.now();
      const s = suggestScaleFromDoors(st.segments);
      rows.push({ page, feetPerInch: s?.feetPerInch ?? null, doors: s?.doors ?? 0, segs: st.segments.length, ms: Date.now() - t0 });
    }
    writeFileSync(OUT, JSON.stringify(rows));
    expect(pages.length, "no pages named").toBeGreaterThan(0);
  });
});
