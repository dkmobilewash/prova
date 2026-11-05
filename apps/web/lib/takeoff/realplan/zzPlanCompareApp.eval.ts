import { Buffer } from "node:buffer";
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pageInventoryWork, type SheetProposalRow } from "../../plan-ingest/pageInventory";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import type { ScoredPairing } from "../demotedRuns";
import { runsHeldOffEstimate } from "../estimateHold";
import { excludedSheetReason, heldOutReason } from "../heldOutSets";
import { keyFromLabels, scoreSheet, type ScoredRun } from "../heldOutScore";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { priorPlanFor } from "../priorPlan";
import { autoPairs } from "../priorPlanLoad";
import { sheetStrokes } from "../sheetStrokes";
import { loadWallModel } from "../wallModelFile";
import type { WallCandidate } from "../wallVectors";

/**
 * ── PLAN COMPARISON AS THE APP RUNS IT ──
 *
 * The pairing the app makes — `autoPairs` over the sheet numbers and titles the
 * keyless inventory reads, no drawings — and `priorPlanFor` on the paired page,
 * on every labelled sheet: real and junk set aside, and posted vs key at the
 * shipped hold, off against on. Per building on training; `PCA_HELD=1` is
 * held-out, TOTALS ONLY. Needs TAKEOFF_WALL_MODEL.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const DIR2 = process.env.REAL_PLAN_DIR2 ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const OUT = process.env.PCA_OUT ?? "";
const HELD = process.env.PCA_HELD === "1";
const flat = (s: string) => s.replace(/\.pdf$/i, "").replace(/[^a-z0-9]+/gi, "").toUpperCase();
const findPdf = (dir: string) => {
  for (const root of [DIR, DIR2].filter((r) => r !== "")) for (const n of readdirSync(root)) if (n.toLowerCase().endsWith(".pdf") && flat(n) === flat(dir)) return join(root, n);
  return null;
};
type Saved = Parameters<typeof keyFromLabels>[0] & { page: number; feetPerUnit: number };
type Row = { set: string; sheet: string; renovation: boolean; paired: string; key: number; posted: number; postedOn: number; real: number; junk: number };

async function sheetsOf(pdf: string): Promise<{ pageNumber: number; sheetNumber: string | null; title: string | null }[]> {
  const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
  const proposals = new Map<number, SheetProposalRow>();
  const work = pageInventoryWork(
    { planId: "p", companyId: "c", ingestJobId: "i", jobId: "j", startedByUserId: null },
    {
      readPlanBytes: async () => ({ ok: true, bytes: Buffer.from("") }),
      openPdf: async () => doc,
      saveSheetText: async () => {},
      saveScaleReading: async () => {},
      saveSheetProposal: async (r) => void proposals.set(r.pageNumber, r),
      planTextReadOn: async () => true,
    },
  );
  for (let page = 1; page <= doc.pageCount; page += 1) {
    try {
      await work({ id: `t${page}`, pageNumber: page, stage: "PAGE_INVENTORY", attempts: 0 } as never);
    } catch {
      // an unreadable page is not paired
    }
  }
  await doc.close();
  return [...proposals.values()].map((p) => ({ pageNumber: p.pageNumber, sheetNumber: p.sheetNumber, title: p.title }));
}

describe.skipIf(DIR === "" || LABELS === "" || OUT === "" || process.env.TAKEOFF_WALL_MODEL === undefined)("plan comparison as the app runs it", () => {
  it("scores it on every labelled sheet", { timeout: 7_200_000 }, async () => {
    const config = loadWallModel();
    if (config === null) throw new Error("no wall model");
    const rows: Row[] = [];
    for (const dir of readdirSync(LABELS).sort()) {
      if (!existsSync(join(LABELS, dir)) || (heldOutReason(dir) !== null) !== HELD) continue;
      // One set per process when a big set's inventory would outlast one run.
      if (process.env.PCA_ONLY !== undefined && !dir.includes(process.env.PCA_ONLY)) continue;
      let names: string[] = [];
      try { names = readdirSync(join(LABELS, dir)).filter((n) => n.endsWith(".json")); } catch { continue; }
      const pdf = findPdf(dir);
      if (pdf === null || names.length === 0) continue;
      const auto = autoPairs(await sheetsOf(pdf));
      for (const name of names) {
        const sheet = name.slice(0, -5);
        if (excludedSheetReason(dir, sheet) !== null) continue;
        const saved = JSON.parse(readFileSync(join(LABELS, dir, name), "utf8")) as Saved;
        const { key } = keyFromLabels(saved);
        if (key.length === 0) continue;
        const strokes = await sheetStrokes(Buffer.from(readFileSync(pdf)), saved.page);
        if (strokes === null || strokes.segments.length < 50) continue;
        const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
        const text = await doc.pageText(saved.page);
        const W = strokes.widthPt, fpu = saved.feetPerUnit;
        const textItems = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
        const words = textItems.map((t) => t.str).join(" ");
        const renovation = /\(E\)/i.test(words) || (words.match(/\bEXIST/gi) ?? []).length >= 3 || /RENOVATION|REMODEL|TENANT IMPROVEMENT|\bDEMO/i.test(words);
        const scored: ScoredPairing[] = [];
        const d = detectForSheet({ segments: strokes.segments, textItems, pageSize: { widthPt: W, heightPt: strokes.heightPt }, feetPerUnit: fpu, onCandidate: (f, w) => { scored.push({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, thicknessFeet: w.thicknessFeet, features: [...f] }); } });
        const offer = (priorPlan?: { lines: NonNullable<ReturnType<typeof priorPlanFor>["lines"]>; sheet: string }) =>
          offeredCandidates({ walls: d.found.walls, segments: d.found.inUnits.map((u) => ({ ...u, x1: u.x1 * W, y1: u.y1 * W, x2: u.x2 * W, y2: u.y2 * W })), pageSegments: strokes.segments, widthPt: W, feetPerUnit: fpu, planBoxes: d.planBoxes, textItems, ...(priorPlan === undefined ? {} : { priorPlan }) }).offeredRuns;
        const off = offer();
        let on = off;
        let paired = "-";
        const pair = auto.get(saved.page);
        if (pair !== undefined) {
          const ds = await doc.pageStrokes(pair.demoPage);
          const dt = (await doc.pageText(pair.demoPage)).items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
          const prior = priorPlanFor({ demo: { segments: ds.segments, textItems: dt, widthPt: ds.widthPt, heightPt: ds.heightPt }, newPage: { segments: strokes.segments, widthPt: W }, newRuns: off, feetPerUnit: fpu });
          paired = `p${pair.demoPage} by ${pair.basis}${prior.lines === null ? " — not aligned" : `, ${prior.votes} votes`}`;
          if (prior.lines !== null) on = offer({ lines: prior.lines, sheet: `p${pair.demoPage}` });
        }
        await doc.close();
        const junkOf = (r: WallCandidate) => scoreSheet({ set: dir, sheet, key, proposed: [{ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, lengthFeet: r.lengthFeet, thicknessFeet: r.thicknessFeet } as ScoredRun], feetPerUnit: fpu }).extraFeet >= 0.5 * r.lengthFeet;
        const posted = (runs: WallCandidate[]) => {
          const held = new Set(runsHeldOffEstimate(config.model, runs, scored, fpu, false));
          return runs.reduce((n, r) => n + (held.has(r) ? 0 : r.lengthFeet), 0);
        };
        const kept = new Set(on.map((r) => `${r.x1.toFixed(5)},${r.y1.toFixed(5)},${r.x2.toFixed(5)},${r.y2.toFixed(5)}`));
        const aside = off.filter((r) => !kept.has(`${r.x1.toFixed(5)},${r.y1.toFixed(5)},${r.x2.toFixed(5)},${r.y2.toFixed(5)}`));
        let real = 0, junk = 0;
        for (const r of aside) { if (junkOf(r)) junk += r.lengthFeet; else real += r.lengthFeet; }
        rows.push({ set: dir, sheet, renovation, paired, key: scoreSheet({ set: dir, sheet, key, proposed: [], feetPerUnit: fpu }).keyFeet, posted: posted(off), postedOn: posted(on), real, junk });
      }
    }
    expect(rows.length, "no labelled sheet was read").toBeGreaterThan(0);
    if (process.env.PCA_ROWS !== undefined) for (const r of rows) appendFileSync(process.env.PCA_ROWS, JSON.stringify(r) + "\n");
    const f = (n: number) => n.toFixed(0);
    const pct = (p: number, k: number) => `${p >= k ? "+" : ""}${((100 * (p - k)) / k).toFixed(1)}%`;
    const lines: string[] = [];
    if (!HELD) {
      for (const r of rows.filter((x) => x.paired !== "-")) lines.push(`  PAIRED ${r.set.slice(0, 30).padEnd(30)} ${r.sheet.padEnd(8)} ${r.paired} · real ${f(r.real)} / junk ${f(r.junk)}`);
      lines.push("", "PER BUILDING (real lost / junk removed)");
      for (const set of [...new Set(rows.map((r) => r.set))]) {
        const rs = rows.filter((r) => r.set === set);
        const real = rs.reduce((n, r) => n + r.real, 0), junk = rs.reduce((n, r) => n + r.junk, 0);
        if (real + junk > 0) lines.push(`  ${set.slice(0, 40).padEnd(40)} ${f(real)}/${f(junk)}`);
      }
    }
    for (const group of ["renovation", "new build", "all"] as const) {
      const rs = rows.filter((r) => group === "all" || r.renovation === (group === "renovation"));
      if (rs.length === 0) continue;
      const key = rs.reduce((n, r) => n + r.key, 0), real = rs.reduce((n, r) => n + r.real, 0), junk = rs.reduce((n, r) => n + r.junk, 0);
      lines.push(`${HELD ? "HELD-OUT" : "TRAINING"} ${group}: sheets ${rs.length}, paired ${rs.filter((r) => r.paired !== "-").length}, key ${f(key)} · real lost ${f(real)} / junk removed ${f(junk)} (${real > 0 ? (junk / real).toFixed(1) : "∞"}:1) · posted ${pct(rs.reduce((n, r) => n + r.posted, 0), key)} → ${pct(rs.reduce((n, r) => n + r.postedOn, 0), key)}`);
    }
    writeFileSync(OUT, lines.join("\n") + "\n");
  });
});
