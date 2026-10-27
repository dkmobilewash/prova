import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { heldOutReason } from "../heldOutSets";
import { keyFromLabels, scoreSheet, type ScoredRun } from "../heldOutScore";
import { detectForSheet, offeredCandidates, type SheetDetectInput } from "../offeredCandidates";
import { sheetStrokes } from "../sheetStrokes";

/**
 * ── THREE ARMS OF THE SAME FINDER, SCORED AGAINST THE KEY ──
 *
 * The finder was found to answer differently (a) when an answer-key hook is
 * set and (b) when the strokes arrive in another order. Both are defects:
 * a hook must only observe, and a drawing is the same drawing in any order.
 * This scores each arm against every TRAINING sheet's accepted + traced key
 * so the fix can be measured before/after — real wall lost = missing feet
 * that rose, junk removed = extra feet that fell — and asserts, once fixed,
 * that the three arms are identical.
 *
 * Writes one JSON per run to FINDER_ARMS_OUT (outside the tree) so two runs
 * can be diffed. TRAINING SHEETS ONLY; nothing is decided from held-out.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const DIR2 = process.env.REAL_PLAN_DIR2 ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const OUT = process.env.FINDER_ARMS_OUT ?? "";
const TAG = process.env.FINDER_ARMS_TAG ?? "run";
const MUST_AGREE = process.env.FINDER_ARMS_MUST_AGREE === "1";

type Saved = { page: number; feetPerUnit: number; verdicts: { x1: number; y1: number; x2: number; y2: number; lengthFeet: number; thicknessFeet?: number; verdict: string }[] };
const flat = (t: string) => t.replace(/[^a-z0-9]+/gi, "").toUpperCase();
function findPdf(dir: string): string | null {
  for (const root of [DIR, DIR2].filter((r) => r !== "")) for (const name of readdirSync(root)) if (name.toLowerCase().endsWith(".pdf") && flat(name) === flat(dir)) return join(root, name);
  return null;
}
/** A seeded shuffle, so the arm is the same shuffle every run. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe.skipIf(DIR === "" || LABELS === "" || OUT === "")("the finder's arms against the key", () => {
  it("scores no-hook, hook, reversed and shuffled on every training sheet", { timeout: 7_200_000 }, async () => {
    const files: { dir: string; sheet: string }[] = [];
    for (const dir of readdirSync(LABELS)) {
      if (!existsSync(join(LABELS, dir)) || heldOutReason(dir) !== null) continue;
      for (const name of readdirSync(join(LABELS, dir))) if (name.endsWith(".json")) files.push({ dir, sheet: name.replace(/\.json$/, "") });
    }
    files.sort((a, b) => a.dir.localeCompare(b.dir) || a.sheet.localeCompare(b.sheet));
    const rows: Record<string, unknown>[] = [];
    let disagreements = 0;
    for (const file of files) {
      const pdf = findPdf(file.dir);
      if (pdf === null) continue;
      const saved = JSON.parse(readFileSync(join(LABELS, file.dir, `${file.sheet}.json`), "utf8")) as Saved;
      const strokes = await sheetStrokes(Buffer.from(readFileSync(pdf)), saved.page);
      const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
      const text = await doc.pageText(saved.page);
      await doc.close();
      const textItems = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
      const pageSize = { widthPt: strokes.widthPt, heightPt: strokes.heightPt };
      const { key } = keyFromLabels(saved);
      const arm = (segments: typeof strokes.segments, extra: Partial<SheetDetectInput>) => {
        const d = detectForSheet({ segments, textItems, pageSize, feetPerUnit: saved.feetPerUnit, ...extra });
        const offered = offeredCandidates({ walls: d.found.walls, segments: d.found.inUnits.map((one) => ({ ...one, x1: one.x1 * strokes.widthPt, y1: one.y1 * strokes.widthPt, x2: one.x2 * strokes.widthPt, y2: one.y2 * strokes.widthPt })), widthPt: strokes.widthPt, feetPerUnit: saved.feetPerUnit, planBoxes: d.planBoxes });
        const proposed: ScoredRun[] = offered.candidates.map((w) => ({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, lengthFeet: w.lengthFeet, thicknessFeet: w.thicknessIn === null ? undefined : w.thicknessIn / 12 }));
        const s = scoreSheet({ set: file.dir, sheet: file.sheet, key, proposed, feetPerUnit: saved.feetPerUnit });
        const digest = d.found.walls.map((w) => `${w.x1.toFixed(5)},${w.y1.toFixed(5)},${w.x2.toFixed(5)},${w.y2.toFixed(5)}`).sort().join("|");
        return { n: offered.candidates.length, walls: d.found.walls.length, missing: Math.round(s.missingFeet), extra: Math.round(s.extraFeet), keyFeet: Math.round(s.keyFeet), digest };
      };
      const noHook = arm(strokes.segments, {});
      const hook = arm(strokes.segments, { onCandidate: () => undefined });
      const reversed = arm([...strokes.segments].reverse(), {});
      const mixed = arm(shuffled(strokes.segments, 20261022), {});
      const agree = noHook.digest === hook.digest && noHook.digest === reversed.digest && noHook.digest === mixed.digest;
      if (!agree) disagreements += 1;
      const strip = (a: typeof noHook) => ({ n: a.n, walls: a.walls, missing: a.missing, extra: a.extra });
      rows.push({ set: file.dir, sheet: file.sheet, keyFeet: noHook.keyFeet, noHook: strip(noHook), hook: strip(hook), reversed: strip(reversed), shuffled: strip(mixed), agree });
      console.log(`  ${`${file.dir.slice(0, 26)}/${file.sheet}`.padEnd(34)} key ${String(noHook.keyFeet).padStart(5)} · no-hook ${noHook.walls}/${noHook.n} miss ${noHook.missing} extra ${noHook.extra} · hook ${hook.walls}/${hook.n} miss ${hook.missing} extra ${hook.extra} · reversed ${reversed.walls}/${reversed.n} miss ${reversed.missing} extra ${reversed.extra} · shuffled ${mixed.walls}/${mixed.n} miss ${mixed.missing} extra ${mixed.extra} ${agree ? "AGREE" : "DIFFER"}`);
    }
    expect(rows.length, "no training sheet was read").toBeGreaterThan(0);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `arms-${TAG}.json`), JSON.stringify(rows, null, 1));
    const tot = (k: "noHook" | "hook" | "reversed" | "shuffled") =>
      rows.reduce<{ missing: number; extra: number }>((acc, r) => { const a = r[k] as { missing: number; extra: number }; return { missing: acc.missing + a.missing, extra: acc.extra + a.extra }; }, { missing: 0, extra: 0 });
    console.log(`\n  TOTAL (${rows.length} sheets): no-hook miss ${tot("noHook").missing} extra ${tot("noHook").extra} · hook miss ${tot("hook").missing} extra ${tot("hook").extra} · reversed miss ${tot("reversed").missing} extra ${tot("reversed").extra} · shuffled miss ${tot("shuffled").missing} extra ${tot("shuffled").extra} · ${disagreements} sheet(s) where the arms differ`);
    if (MUST_AGREE) expect(disagreements, "a hook or the stroke order changed the walls found").toBe(0);
  });
});
