import { Buffer } from "node:buffer";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";

/**
 * Writes a bare page dump (no walls, no rooms) per requested page so
 * `roomCrops.swift` can render it for reading the RCP's own tags by eye.
 *   REAL_PLAN_DIR=… CEILING_PAGES="IFBREBID-Murray-Tower-Package.pdf:24,…" CEILING_PAGES_OUT=… 
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const OUT = process.env.CEILING_PAGES_OUT ?? "";
const PAGES = (process.env.CEILING_PAGES ?? "").split(",").map((s) => s.trim()).filter(Boolean);

describe.skipIf(DIR === "" || OUT === "" || PAGES.length === 0)("ceiling page dumps", () => {
  it("writes one bare dump per page", { timeout: 1_800_000 }, async () => {
    mkdirSync(OUT, { recursive: true });
    for (const spec of PAGES) {
      const [set, p] = spec.split(":");
      const page = Number(p);
      const pdf = join(DIR, set);
      const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
      const text = await doc.pageText(page);
      await doc.close();
      const name = `page__${set.replace(/\.pdf$/, "")}__p${page}`;
      writeFileSync(
        join(OUT, `${name}.json`),
        JSON.stringify({ pdf, set, sheet: `p${page}`, page, widthPt: text.widthPt, heightPt: text.heightPt, feetPerUnit: 1, walls: [], rooms: [], unplacedTags: [], mergedTags: [] }),
      );
      console.log(`${name}: ${text.widthPt}x${text.heightPt} pt, ${text.items.length} text items`);
    }
    expect(PAGES.length).toBeGreaterThan(0);
  });
});
