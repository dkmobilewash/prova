import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { excludedSheetReason, heldOutReason } from "../heldOutSets";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { sheetStrokes } from "../sheetStrokes";

/**
 * Every run a named set-aside rule removed on the training sheets, with how much
 * of it the key calls wall or not-wall, so a rule is priced on what it costs.
 * ASIDE_KIND names the rule, PROBE_OUT the file. No model. Training only.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const DIR2 = process.env.REAL_PLAN_DIR2 ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const KIND = process.env.ASIDE_KIND ?? "";
const flat = (s: string) => s.replace(/[^a-z0-9]+/gi, "").toUpperCase();
const findPdf = (dir: string) => {
  for (const root of [DIR, DIR2].filter((r) => r !== "")) for (const n of readdirSync(root)) if (n.toLowerCase().endsWith(".pdf") && flat(n) === flat(dir)) return join(root, n);
  return null;
};
type G = { x1: number; y1: number; x2: number; y2: number };
const len = (g: G) => Math.hypot(g.x2 - g.x1, g.y2 - g.y1);
const off = (a: G, x: number, y: number) => Math.abs((a.x2 - a.x1) * (a.y1 - y) - (a.x1 - x) * (a.y2 - a.y1)) / len(a);
const covered = (a: G, keys: readonly G[], fpu: number) => {
  const l = len(a);
  const u = [(a.x2 - a.x1) / l, (a.y2 - a.y1) / l] as const;
  let feet = 0;
  for (const k of keys) {
    if (len(k) === 0 || Math.max(off(a, k.x1, k.y1), off(a, k.x2, k.y2)) * fpu > 2.5) continue;
    const t = [(k.x1 - a.x1) * u[0] + (k.y1 - a.y1) * u[1], (k.x2 - a.x1) * u[0] + (k.y2 - a.y1) * u[1]];
    feet += Math.max(0, Math.min(l, Math.max(...t)) - Math.max(0, Math.min(...t))) * fpu;
  }
  return Math.min(feet, l * fpu);
};

describe.skipIf(DIR === "" || LABELS === "" || KIND === "")("what a set-aside rule removed", () => {
  it("writes each run with its key coverage", { timeout: 3_600_000 }, async () => {
    const rows: unknown[] = [];
    const read: string[] = [];
    for (const dir of readdirSync(LABELS)) {
      if (!existsSync(join(LABELS, dir)) || heldOutReason(dir) !== null) continue;
      for (const name of readdirSync(join(LABELS, dir))) {
        const sheet = name.slice(0, -5);
        if (!name.endsWith(".json") || excludedSheetReason(dir, sheet) !== null) continue;
        const pdf = findPdf(dir);
        if (pdf === null) continue;
        const saved = JSON.parse(readFileSync(join(LABELS, dir, name), "utf8")) as { page: number; feetPerUnit: number; verdicts: (G & { verdict: string })[] };
        const strokes = await sheetStrokes(Buffer.from(readFileSync(pdf)), saved.page);
        if (strokes === null) continue;
        const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
        const textItems = (await doc.pageText(saved.page)).items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
        await doc.close();
        read.push(`${dir}/${sheet}`);
        const W = strokes.widthPt;
        const d = detectForSheet({ segments: strokes.segments, textItems, pageSize: { widthPt: W, heightPt: strokes.heightPt }, feetPerUnit: saved.feetPerUnit });
        const got = offeredCandidates({ walls: d.found.walls, segments: d.found.inUnits.map((u) => ({ ...u, x1: u.x1 * W, y1: u.y1 * W, x2: u.x2 * W, y2: u.y2 * W })), pageSegments: strokes.segments, widthPt: W, feetPerUnit: saved.feetPerUnit, planBoxes: d.planBoxes, textItems });
        const real = saved.verdicts.filter((v) => v.verdict === "wall" || v.verdict === "traced");
        const junk = saved.verdicts.filter((v) => v.verdict === "not-wall");
        for (const l of got.setAsideLines.filter((a) => a.kind === KIND)) {
          rows.push({ set: dir, sheet, feet: l.lengthFeet, why: l.why, real: covered(l, real, saved.feetPerUnit), junk: covered(l, junk, saved.feetPerUnit) });
        }
      }
    }
    writeFileSync(process.env.PROBE_OUT ?? "/dev/null", JSON.stringify(rows));
    expect(read.length, "no training sheet was read").toBeGreaterThan(0);
  });
});
