import { Buffer } from "node:buffer";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "@/lib/plan-ingest/planPdf";
import { mergeLegendReads } from "@/lib/takeoff/legendMerge";
import { readPartitionAssembly, type ProposedComponent } from "@/lib/takeoff/partitionAssembly";
import { pageLines } from "@/lib/takeoff/planTextRead";
import { componentRunQuantity } from "@/lib/wall-assemblies";
import { completeAssembly } from "./assemblyAccessories";
import { DEFAULT_ASSEMBLY_STANDARDS as STD } from "./assemblyStandards";
import { itemGeometry } from "./takeoff-item-lines";

/**
 * ── THE AUTOMATIC ESTIMATE AGAINST A HAND CALCULATION, ON REAL LEGEND TYPES ──
 *
 * Calls no model. Baker EOC's S6B, C8B and S6A come from the cached legend read (LEGEND_CACHE, kept
 * outside the repo with the plans), merged by the app's own `mergeLegendReads`; USU ASPIRE's PS2a from
 * its text layer under REAL_PLAN_DIR. USU is a HELD-OUT set: it is used here only as arithmetic
 * input, and no reading rule was changed for it. Each type is given a length and a height, run through
 * the same geometry and per-part arithmetic `syncDecidedItems` uses, and compared line by line with a
 * hand calculation written below — within 2%. AUTO_ESTIMATE_OUT gets the before/after table.
 *
 * The hand figures assume the company defaults: 16in studs when nothing says, waste 5% (10% board),
 * 1 screw/sf/layer (bought per thousand), 0.37 lf tape (in 500 ft rolls) and 0.14 lb compound per sf.
 */
const CACHE = process.env.LEGEND_CACHE ?? "";
const PLANS = process.env.REAL_PLAN_DIR ?? "";
const OUT = process.env.AUTO_ESTIMATE_OUT ?? "";

type Wall = { code: string; lf: number; heightFt: number; sides: 1 | 2; words: string[]; components: ProposedComponent[]; spacingIn: number | null };
type Hand = Record<string, [RegExp, number, string]>;

// By hand. S6B: 120 lf at 10 ft, both sides, one layer, no spacing printed (16in standard).
//   studs ceil(120/1.333)+1 = 91 x1.05 = 95.55 → 96 · track 240 x1.05 = 252 · board 2400sf/32 = 75 x1.10 = 82.5 → 83
//   screws 2400 x1.05 = 2520 = 2.52 M · tape 888 x1.05 = 932.4 ft = 1.86 rolls → 2 · compound 336 x1.05 = 352.8 → 353
// C8B: 80 lf at 12 ft, board ONE side over concrete (no framing), R-22 insulation.
//   board 960/32 = 30 x1.1 = 33 · insulation 960 x1.05 = 1008 · screws 1008 = 1.01 M · tape 355.2 x1.05 = 372.96 ft → 1 roll · compound 134.4 x1.05 = 141.12 → 142
// S6A: 60 lf at 14 ft, both sides, 2 layers each side, 24in o.c., continuous to the roof deck.
//   studs ceil(60/2)+1 = 31 x1.05 = 32.55 → 33 · bottom track 63 · deflection track 63 · board 3360/32 = 105 x1.1 = 115.5 → 116
//   screws 3360 x1.05 = 3528 = 3.53 M · tape 621.6 x1.05 = 652.68 ft → 2 rolls · compound 235.2 x1.05 = 246.96 → 247
// PS2a: 100 lf at 9 ft, both sides, one layer, 2-1/2in studs, no spacing printed (16in standard).
//   studs 76 x1.05 = 79.8 → 80 · track 210 · board 1800/32 = 56.25 x1.1 = 61.875 → 62 · screws 1890 = 1.89 M · tape 699.3 ft → 2 rolls · compound 264.6 → 265
const HAND: Record<string, Hand> = {
  S6B: { studs: [/metal stud/, 96, "EA"], track: [/track/, 252, "LF"], board: [/gypsum board/, 83, "SHT"], screws: [/screws/, 2.52, "M"], tape: [/tape/, 2, "RL"], compound: [/compound/, 353, "LB"] },
  C8B: { board: [/gypsum board/, 33, "SHT"], insulation: [/insulation/, 1008, "SF"], screws: [/screws/, 1.01, "M"], tape: [/tape/, 1, "RL"], compound: [/compound/, 142, "LB"] },
  S6A: { studs: [/metal stud/, 33, "EA"], bottom: [/track, bottom/, 63, "LF"], deflection: [/deflection track/, 63, "LF"], board: [/gypsum board/, 116, "SHT"], screws: [/screws/, 3.53, "M"], tape: [/tape/, 2, "RL"], compound: [/compound/, 247, "LB"] },
  PS2a: { studs: [/metal stud/, 80, "EA"], track: [/track/, 210, "LF"], board: [/gypsum board/, 62, "SHT"], screws: [/screws/, 1.89, "M"], tape: [/tape/, 2, "RL"], compound: [/compound/, 265, "LB"] },
};

function quantities(components: readonly ProposedComponent[], wall: Wall) {
  const geometry = itemGeometry({
    id: "i", name: wall.code, type: "LINEAR", heightFt: wall.heightFt, sides: wall.sides, wastePercent: null, depthIn: null, wallTypeId: "t",
    studSpacingIn: wall.spacingIn ?? STD.studSpacingIn,
    measurements: [{ id: "m", pageNumber: 1, kind: "LINEAR", xs: [0, wall.lf / 1000], ys: [0, 0], feetPerPageWidth: 1000 }],
  });
  return components.map((c) => {
    const raw = componentRunQuantity({ id: "c", description: c.description, unit: c.unit, basis: c.basis, factor: c.factor, wastePercent: c.wastePercent, roundUp: c.roundUp, productionRate: null }, geometry);
    return { description: c.description, unit: c.unit, quantity: c.roundUp ? Math.ceil(raw) : Math.round(raw * 100) / 100 };
  });
}

describe.skipIf(!CACHE || !PLANS)("automatic estimate vs hand calculation", () => {
  it("Baker S6B, C8B, S6A and USU PS2a match the hand calculation within 2%", async () => {
    const read = (f: string) => {
      const j = JSON.parse(readFileSync(join(CACHE, f), "utf8"));
      return j.read ?? j;
    };
    const text = read("2025_07_08_Baker_EOC_BID_pdf-p25-wall-legend.3.json") as { types: { code: string; lines: string[] }[] };
    const merged = mergeLegendReads({ text: text as never, sight: read("2025_07_08_Baker_EOC_BID_pdf-p25-wall-legend-sight.6.json"), where: "Baker A-legend" });
    expect(merged.length).toBeGreaterThan(0);
    const baker = (code: string, lf: number, heightFt: number, sides: 1 | 2): Wall => {
      const t = merged.find((m) => m.code === code)!;
      expect(t, code).toBeDefined();
      return { code, lf, heightFt, sides, words: text.types.find((x) => x.code === code)!.lines, components: t.assembly.components, spacingIn: t.assembly.read.studSpacingIn };
    };
    const pdf = join(PLANS, "new", "USU-ASPIRE-EVR-BID-DRAWINGS-20230307.pdf");
    expect(existsSync(pdf)).toBe(true);
    const page64 = (await pageLines(await openPlanPdf(Buffer.from(readFileSync(pdf))), 64)).join(" | ");
    // PS2a's column on A501: 2-1/2in metal stud framing, 5/8in gypsum board — both phrases must be on the page.
    const ps2aWords = ['2-1/2" METAL STUD FRAMING', '5/8" GYPSUM BOARD'];
    for (const w of ps2aWords) expect(page64).toContain(w);
    expect(page64).toContain("PS2a");
    const ps2a = readPartitionAssembly({ lines: ps2aWords, where: "USU A501" });

    const walls: Wall[] = [
      baker("S6B", 120, 10, 2),
      baker("C8B", 80, 12, 1),
      baker("S6A", 60, 14, 2),
      { code: "PS2a", lf: 100, heightFt: 9, sides: 2, words: ps2aWords, components: ps2a.components, spacingIn: ps2a.read.studSpacingIn },
    ];
    const report: string[] = ["| Type | Material | Before (today) | After | Hand | Diff |", "| --- | --- | --- | --- | --- | --- |"];
    let checked = 0;
    for (const wall of walls) {
      const before = quantities(wall.components, wall);
      const done = completeAssembly({ components: wall.components, lines: wall.words, says: [], standards: STD, spacingFromStandard: wall.spacingIn === null });
      const after = quantities(done.components, wall);
      for (const [name, [re, want, unit]] of Object.entries(HAND[wall.code])) {
        const got = after.find((l) => re.test(l.description));
        expect(got, `${wall.code} ${name}`).toBeDefined();
        expect(got!.unit).toBe(unit);
        const diff = Math.abs(got!.quantity - want) / want;
        expect(diff, `${wall.code} ${name}: ${got!.quantity} vs hand ${want}`).toBeLessThanOrEqual(0.02);
        const was = before.find((l) => re.test(l.description) && !(name === "deflection" || name === "bottom"));
        report.push(`| ${wall.code} | ${name} | ${was ? `${was.quantity} ${was.unit}` : "—"} | ${got!.quantity} ${got!.unit} | ${want} | ${(diff * 100).toFixed(1)}% |`);
        checked += 1;
      }
      // Height moves materials: one foot taller changes the board.
      const taller = quantities(done.components, { ...wall, heightFt: wall.heightFt + 1 });
      expect(taller.find((l) => /gypsum board/.test(l.description))!.quantity).toBeGreaterThan(after.find((l) => /gypsum board/.test(l.description))!.quantity);
      report.push(`| ${wall.code} | notes | ${done.conflicts.concat(done.needsPerson).join(" ") || "—"} | | | |`);
    }
    expect(checked).toBe(Object.values(HAND).reduce((n, h) => n + Object.keys(h).length, 0));
    if (OUT) writeFileSync(OUT, report.join("\n") + "\n");
  }, 120_000);
});
