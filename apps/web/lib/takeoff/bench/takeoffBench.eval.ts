import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { writeOverlays, writeReports } from "./report";
import { runBench, type Printer } from "./run";

/**
 * THE TAKEOFF ACCURACY BENCH.
 *
 *     TAKEOFF_BENCH=1 pnpm takeoff:bench
 *
 * Generates the Mesa Ridge bid set (fictional) in every export variant, runs the
 * product's own scale, wall, schedule and materials code on each PDF, grades it
 * against an answer key computed from the model, and writes
 * `reports/takeoff-bench/` at the repo root: SCORECARD.md, HOLDOUT.md,
 * walls.csv, overlays/*.png, and the fixtures (PDF, DXF, answer keys).
 *
 * ── WHY IT IS AN EVAL AND NOT A TEST ──
 *
 * It reports accuracy; it does not gate it. The product currently fails most of
 * the pass bar, and a red CI on every PR for a known, measured gap teaches people
 * to ignore red. What it DOES assert is that it measured something: cases ran,
 * walls were drawn, the reader read path operators on the vector sheets. A bench
 * that read nothing must never print a clean scorecard.
 *
 * It calls no model, so it needs no key — `lib/ask/eval/harness.test.ts` names
 * it as a keyless exemption and holds it to the same promise by other means.
 */

const RUN = Boolean(process.env.TAKEOFF_BENCH);

async function chromiumPrinter(): Promise<Printer | null> {
  try {
    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch();
    const page = await browser.newPage();
    return {
      pdfFromSvg: async (svg, widthIn, heightIn) => {
        await page.setContent(
          `<!doctype html><html><head><style>@page{size:${widthIn}in ${heightIn}in;margin:0}html,body{margin:0;padding:0}svg{display:block}</style></head><body>${svg}</body></html>`,
        );
        return Buffer.from(await page.pdf({ width: `${widthIn}in`, height: `${heightIn}in`, printBackground: true, margin: { top: "0", right: "0", bottom: "0", left: "0" }, preferCSSPageSize: true, pageRanges: "1" }));
      },
      close: () => browser.close(),
    };
  } catch {
    return null;
  }
}

describe.skipIf(!RUN)("takeoff accuracy bench", () => {
  it("runs every case and writes the scorecard", async () => {
    const outDir = resolve(process.cwd(), "../../reports/takeoff-bench");
    const printer = await chromiumPrinter();
    const run = await runBench(outDir, printer, (s) => console.log(s));
    await printer?.close();

    // It measured something, or it says nothing.
    expect(run.main.length).toBeGreaterThan(0);
    expect(run.holdout.length).toBeGreaterThan(0);
    const vector = run.main.filter((r) => r.key.variant !== "scan");
    expect(vector.every((r) => r.reader.pathOperators > 0)).toBe(true);
    expect(run.main.filter((r) => r.walls.counted > 0).length).toBeGreaterThan(0);

    writeReports(run, outDir, readFileSync(fileURLToPath(new URL("./HEURISTICS.md", import.meta.url)), "utf8"));
    const n = await writeOverlays(run.main, outDir, join(outDir, "fixtures", "pdf"));
    expect(n).toBeGreaterThan(0);
    console.log(`wrote ${outDir}/SCORECARD.md, ${n} overlays`);
  }, 3_600_000);
});
