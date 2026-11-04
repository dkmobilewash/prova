import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { sheetStrokes } from "../sheetStrokes";
import { symbolsInBox } from "../symbolBox";
import { findSymbols, type Box } from "../symbolSignature";

/**
 * ── COUNT LIKE THIS, 30 BOXES PER SYMBOL, BEFORE AND AFTER ──
 *
 * Training sheets: Baker EL1.01 (R1 troffer, OS sensor, E2 fixture, X1 exit
 * sign) and M1.01 (CD-1 diffuser), with the hand keys in labels-symbols/. For
 * each symbol, 30 boxes an estimator might drag: 0.9 to 2.5 times the symbol's
 * size on each axis (a box drawn just inside a troffer's outline is still a box
 * round the troffer), shifted at random by up to the difference, 15 round each
 * of two keyed instances. "Before" boxes the way the app did; "after" first
 * takes the symbol's own tight bounds (`symbolsInBox`); where the box holds two
 * symbols it asks, and the estimator's answer is taken to be the one under the
 * key point. `key` is the count Count like this should give (EL1.01's legend
 * sheet excluded). SYMBOLS_ONLY=R1,X1 runs a subset.
 *
 *     REAL_PLAN_DIR="<folder holding 2025.07.08_Baker_EOC_BID.pdf>" OUT=<file> \
 *       pnpm exec vitest run --config vitest.eval.config.mts lib/takeoff/realplan/countBox.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const FILE = join(DIR, "2025.07.08_Baker_EOC_BID.pdf");
const SYMBOLS_ALL = [
  { name: "R1 troffer", page: 54, key: 21, probe: 0.009, at: [{ x: 0.2455, y: 0.3412 }, { x: 0.2038, y: 0.369 }] },
  { name: "OS sensor", page: 54, probe: 0.005, key: 16, at: [{ x: 0.3335, y: 0.4939 }, { x: 0.3318, y: 0.4453 }] },
  { name: "E2 fixture", page: 54, probe: 0.005, key: 7, at: [{ x: 0.3362, y: 0.5269 }, { x: 0.3688, y: 0.3259 }] },
  { name: "X1 exit sign", page: 54, probe: 0.005, key: 5, at: [{ x: 0.3542, y: 0.3411 }, { x: 0.1928, y: 0.4858 }] },
  { name: "CD-1 diffuser", page: 38, probe: 0.006, key: 17, at: [{ x: 0.3109, y: 0.3829 }, { x: 0.2246, y: 0.3134 }] },
];
const SYMBOLS = process.env.SYMBOLS_ONLY ? SYMBOLS_ALL.filter((x) => process.env.SYMBOLS_ONLY!.split(",").includes(x.name.split(" ")[0]!)) : SYMBOLS_ALL;

async function sheet(page: number) {
  const strokes = await sheetStrokes(Buffer.from(readFileSync(FILE)), page);
  const doc = await openPlanPdf(Buffer.from(readFileSync(FILE)));
  const t = await doc.pageText(page);
  await doc.close();
  const W = strokes.widthPt;
  return {
    segs: strokes.segments.map((s) => ({ ...s, x1: s.x1 / W, y1: s.y1 / W, x2: s.x2 / W, y2: s.y2 / W })),
    text: t.items.map((i) => ({ x: i.x / W, y: (i.y - i.height) / W, width: i.width / W, height: i.height / W, str: i.str })),
  };
}
const spread = (xs: (number | string)[]) => {
  const tally = new Map<string, number>();
  for (const x of xs) tally.set(String(x), (tally.get(String(x)) ?? 0) + 1);
  return [...tally].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(" ");
};

describe.skipIf(DIR === "" || !existsSync(FILE))("Count like this against the box", () => {
  it("counts the same for any reasonable box", { timeout: 1_800_000 }, async () => {
    const sheets = new Map<number, Awaited<ReturnType<typeof sheet>>>();
    for (const p of [...new Set(SYMBOLS.map((x) => x.page))]) sheets.set(p, await sheet(p));
    const first = [...sheets.values()][0]!;
    expect(first.segs.length, "the sheet read to no strokes").toBeGreaterThan(1000);
    let seed = 5;
    // The same 15 boxes per instance as the measurement in the PR body.
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const lines: string[] = [];
    const results: { name: string; key: number; first: (number | string)[] }[] = [];
    for (const sym of SYMBOLS) {
      const { segs, text } = sheets.get(sym.page)!;
      const before: number[][] = sym.at.map(() => []), after: (number | string)[][] = sym.at.map(() => []);
      let asked = 0;
      for (let i = 0; i < 30; i += 1) {
        const c = sym.at[i % sym.at.length]!;
        // The symbol's ink extent, from a probe box known to hold it whole (a 2x4
        // troffer needs more room than a sensor's circle).
        const r = sym.probe;
        const found = symbolsInBox(segs, text, { x1: c.x - r, y1: c.y - r, x2: c.x + r, y2: c.y + r });
        const ink: Box = found.kind === "one" ? found.box : { x1: c.x - 0.004, y1: c.y - 0.004, x2: c.x + 0.004, y2: c.y + 0.004 };
        const hw = (ink.x2 - ink.x1) / 2, hh = (ink.y2 - ink.y1) / 2, mx = (ink.x1 + ink.x2) / 2, my = (ink.y1 + ink.y2) / 2;
        const bw = hw * (0.9 + rand() * 1.6), bh = hh * (0.9 + rand() * 1.6);
        const ox = (rand() * 2 - 1) * Math.abs(bw - hw), oy = (rand() * 2 - 1) * Math.abs(bh - hh);
        const box = { x1: mx + ox - bw, y1: my + oy - bh, x2: mx + ox + bw, y2: my + oy + bh };
        const k = i % sym.at.length;
        before[k]!.push(findSymbols(segs as never, text, box).matches.length);
        const s = symbolsInBox(segs, text, box);
        if (s.kind === "several") asked += 1;
        // Asked, the estimator picks the symbol they meant: the candidate under the key point.
        const picked = s.kind === "one" ? s.box : s.kind === "several" ? (s.boxes.find((b) => c.x >= b.x1 && c.x <= b.x2 && c.y >= b.y1 && c.y <= b.y2) ?? null) : null;
        after[k]!.push(picked === null ? "none" : findSymbols(segs as never, text, picked).matches.length);
      }
      lines.push(`${sym.name}, key ${sym.key} (asked which symbol on ${asked} of 30)`);
      sym.at.forEach((c, k) => lines.push(`  instance ${k + 1} (${c.x}, ${c.y}): before ${spread(before[k]!)} | after ${spread(after[k]!)}`));
      results.push({ name: sym.name, key: sym.key, first: after[0]! });
    }
    const report = lines.join("\n");
    console.log(report);
    if (process.env.OUT) writeFileSync(process.env.OUT, report);
    expect(results.length).toBe(SYMBOLS.length);
    // The first instance of each is drawn the way most of its copies are, and every
    // box round it counts the key's number. The second instance is reported, not
    // held: three of them carry ink drawn touching the symbol (lettering, a
    // differently drawn outline) that becomes part of the template.
    for (const r of results) expect(r.first, `${r.name}: ${spread(r.first)}`).toEqual(r.first.map(() => r.key));
  });
});
