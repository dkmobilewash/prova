/**
 * DO THE REAL PLANS CARRY LAYER NAMES, AND WOULD THEY HELP?
 *
 * A layer test was proposed as the discriminator that might make a scored
 * pairing safe — tell a grid line from a wall face before reordering anything.
 * On the bench the answer was measured first and is zero: all 1,031 stranded
 * pairings came back `(none) + (none)`, because only two of its sixty variants
 * emit optional-content groups at all.
 *
 * That says nothing about real exports, which is what a classifier would
 * actually be fed. This counts, per sheet: how many strokes carry a layer,
 * what the layer names are, and what `layerVerdict` makes of them.
 *
 * Diagnostic only — `zz` keeps it out of the gating suite.
 */
import { Buffer } from "node:buffer";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { layerVerdict } from "../layerNames";
import { sheetStrokes } from "../sheetStrokes";

const DIR = process.env.REAL_PLAN_DIR ?? "";

describe.skipIf(DIR === "")("layer names on real plan sets", () => {
  it("counts them per sheet", async () => {
    const files = readdirSync(DIR).filter((f) => f.toLowerCase().endsWith(".pdf"));
    expect(files.length, `no PDFs under ${DIR} — this would report a clean nothing`).toBeGreaterThan(0);

    for (const file of files) {
      const bytes = Buffer.from(readFileSync(join(DIR, file)));
      let pages = 0;
      let withLayer = 0;
      let total = 0;
      const names = new Map<string, number>();
      const verdicts = new Map<string, number>();

      // A handful of pages is enough to say whether the export carries layers
      // at all; reading every page of a 200-page set is minutes for no more
      // information.
      for (const page of [1, 8, 9, 15, 117, 119]) {
        let read;
        try {
          read = await sheetStrokes(bytes, page);
        } catch {
          continue;
        }
        if (read === null) continue;
        pages += 1;
        for (const one of read.segments) {
          total += 1;
          if (one.layer !== undefined && one.layer !== "") {
            withLayer += 1;
            names.set(one.layer, (names.get(one.layer) ?? 0) + 1);
            const v = layerVerdict(one.layer);
            verdicts.set(v, (verdicts.get(v) ?? 0) + 1);
          }
        }
      }
      if (total === 0) continue;
      const share = (withLayer / total) * 100;
      console.log(`\n${file.slice(0, 54)}`);
      console.log(
        `  ${pages} pages read, ${total.toLocaleString()} strokes, ` +
          `${withLayer.toLocaleString()} with a layer (${share.toFixed(1)}%)`,
      );
      if (withLayer > 0) {
        const top = [...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
        console.log(`  layers: ${top.map(([n, c]) => `${n}(${c})`).join(", ")}`);
        console.log(
          `  verdicts: ${[...verdicts.entries()].map(([v, c]) => `${v} ${c}`).join(", ")}`,
        );
      }
    }
  }, 1800000);
});
